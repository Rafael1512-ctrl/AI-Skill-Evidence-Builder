import {
  candidateEvidenceEnvelopeSchema,
  type CandidateEvidenceEnvelope,
  type EligibilityStatus,
} from '@aseb/shared';

import type {
  ScreeningCandidate,
  ScreeningJob,
  ScreeningRequirement,
} from '../../generated/prisma/client.js';
import { ScreeningRepository } from '../../repositories/screening.repository.js';
import { logger } from '../../utils/logger.js';
import { scoreCandidate, type CandidateScore } from './engine.js';

export interface ScoreCandidateInput {
  job: ScreeningJob & { requirements: ScreeningRequirement[] };
  candidate: ScreeningCandidate;
  /**
   * Evidence produced by the current attempt but not persisted yet.
   *
   * The queue runner scores *before* it stores the candidate, because a candidate must never
   * be `COMPLETED` without its scores. The candidate row it holds was loaded before the
   * processor ran, so its `analysis_json` is still null; passing the fresh envelope here is
   * what makes the score reflect the work that just happened instead of producing an
   * unscored candidate (PROJECT_CONTEXT §8.52).
   */
  envelope?: unknown;
}

export interface ScoreCandidateOutcome {
  scored: boolean;
  score: number | null;
  eligibilityStatus: EligibilityStatus | null;
  /** Why nothing was scored, when `scored` is false. */
  reason: 'NO_EVIDENCE' | null;
}

/**
 * Deterministic scoring (Phase 14).
 *
 * Reads the grounded evidence Phase 13 stored on the candidate, runs the pure engine and
 * writes the result: one `ScreeningCriterionResult` per requirement (with its verified
 * `EvidenceItem` rows), plus the candidate's score, eligibility and the derived
 * strengths/gaps/uncertainties.
 *
 * A candidate with no stored evidence envelope is left unscored rather than given a
 * fabricated zero: `score`/`eligibility_status` stay NULL, which the results view can show
 * as "belum dinilai". The AI never contributes to the number.
 */
export class ScoringService {
  constructor(private readonly repository = new ScreeningRepository()) {}

  /** Pure pass over the stored envelope; exposed so callers can preview without writing. */
  compute(
    job: ScoreCandidateInput['job'],
    candidate: ScreeningCandidate,
    envelopeOverride?: unknown,
  ): CandidateScore | null {
    const envelope = this.readEnvelope(envelopeOverride ?? candidate.analysisJson);
    if (!envelope) return null;

    return scoreCandidate({
      requirements: job.requirements.map((requirement) => ({
        requirementId: requirement.id,
        text: requirement.text,
        category: requirement.category,
        requirementClass: requirement.requirementClass,
        weight: requirement.weight,
        hardRequirement: requirement.hardRequirement,
      })),
      evidence: envelope.evidence,
      categoryWeights: job.categoryWeights as Record<string, number> | null,
    });
  }

  async scoreAndStore(input: ScoreCandidateInput): Promise<ScoreCandidateOutcome> {
    const computed = this.compute(
      input.job,
      input.candidate,
      input.envelope === undefined ? undefined : input.envelope,
    );
    if (!computed) {
      logger.warn(
        { candidateId: input.candidate.id },
        'Candidate has no stored evidence envelope; leaving it unscored',
      );
      return { scored: false, score: null, eligibilityStatus: null, reason: 'NO_EVIDENCE' };
    }

    await this.repository.replaceCandidateScores({
      candidateId: input.candidate.id,
      score: computed.score,
      eligibilityStatus: computed.eligibilityStatus,
      strengths: computed.strengths,
      gaps: computed.gaps,
      uncertainties: computed.uncertainties,
      criteria: computed.criteria.map((criterion) => ({
        requirementId: criterion.requirementId,
        status: criterion.status,
        confidence: criterion.confidence,
        earnedScore: criterion.earnedScore,
        normalisedWeight: criterion.normalisedWeight,
        notes: criterion.notes.length > 0 ? criterion.notes : null,
        evidence: criterion.evidence.map((item) => ({
          quote: item.quote,
          source: item.source,
          page: item.page,
          url: item.url,
          note: item.note,
        })),
      })),
    });

    return {
      scored: true,
      score: computed.score,
      eligibilityStatus: computed.eligibilityStatus,
      reason: null,
    };
  }

  /**
   * The stored envelope is re-validated on read: a corrupt or older payload must fail
   * closed (leave the candidate unscored) instead of feeding the engine undefined values.
   */
  private readEnvelope(source: unknown): CandidateEvidenceEnvelope | null {
    const parsed = candidateEvidenceEnvelopeSchema.safeParse(source);
    if (!parsed.success) return null;
    return parsed.data;
  }
}

export const scoringService = new ScoringService();
