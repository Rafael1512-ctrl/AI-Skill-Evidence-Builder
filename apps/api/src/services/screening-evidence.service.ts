import { LIMITS, type CandidateEvidenceEnvelope } from '@aseb/shared';

import { getAiProvider, type AIProvider } from '../providers/ai/index.js';
import {
  HRD_EVIDENCE_EXTRACTION_PROMPT_VERSION,
  buildHrdEvidenceExtractionPrompt,
} from '../prompts/hrd/evidenceExtractionPrompt.js';
import { AppError } from '../utils/errors.js';
import { groundScreeningEvidence } from '../utils/evidence.js';
import type {
  CandidateProcessingContext,
  CandidateProcessingResult,
  CandidateProcessor,
} from '../workers/screening.processor.js';
import { recordAiUsage } from './ai-usage.service.js';
import {
  recruiterPreferenceService,
  type RecruiterPreferenceService,
} from './recruiter-preference.service.js';

/** Bounded so a single candidate's stored audit trail stays small. */
const MAX_SUMMARY_CHARS = 1_500;

export interface ScreeningEvidenceServiceDeps {
  provider?: () => AIProvider;
  preferences?: RecruiterPreferenceService;
  usage?: typeof recordAiUsage;
}

/**
 * Evidence extraction for one screening candidate (Phase 13).
 *
 * Flow: prompt/context builder -> provider -> Zod-validated response -> grounding ->
 * business logic. The model reports evidence only; it never scores, ranks or decides, and
 * a quote it cannot support is dropped before anything is stored
 * (docs/AI_PROMPTS.md §9-§11).
 *
 * The result is returned to the queue runner, which owns the candidate's state and writes
 * `summary`/`gaps`/`uncertainties`/`analysis_json` in the same transaction as COMPLETED.
 * Per-criterion score rows (`ScreeningCriterionResult`) belong to Phase 14: they require
 * `earnedScore` and `normalisedWeight`, which only the deterministic engine may compute.
 */
export class ScreeningEvidenceService {
  constructor(private readonly deps: ScreeningEvidenceServiceDeps = {}) {}

  private get provider(): AIProvider {
    return (this.deps.provider ?? getAiProvider)();
  }

  private get preferences(): RecruiterPreferenceService {
    return this.deps.preferences ?? recruiterPreferenceService;
  }

  private get usage(): typeof recordAiUsage {
    return this.deps.usage ?? recordAiUsage;
  }

  async extract(context: CandidateProcessingContext): Promise<CandidateProcessingResult> {
    const { candidate, job } = context;
    const cvText = candidate.cvText ?? '';
    if (cvText.trim().length === 0) {
      throw AppError.textExtractionFailed({
        candidateId: candidate.id,
        reason: 'Teks CV tidak tersedia untuk diekstrak.',
      });
    }

    // The job froze a preference version; the snapshot is what makes the result reproducible.
    const preferences = await this.preferences.getVersion(job.userId, job.preferenceVersion);

    const prompt = buildHrdEvidenceExtractionPrompt({
      jobTitle: job.title,
      jobDescription: job.description,
      requirements: job.requirements.map((requirement) => ({
        requirementId: requirement.id,
        text: requirement.text,
        category: requirement.category,
        requirementClass: requirement.requirementClass,
        weight: requirement.weight,
        hardRequirement: requirement.hardRequirement,
      })),
      preferenceVersion: job.preferenceVersion,
      preferences,
      scoringConfigurationVersion: job.scoringConfigurationVersion,
      categoryWeights: job.categoryWeights as Record<string, number> | null,
      cvText,
    });

    const response = await this.provider.extractScreeningEvidence({ prompt });

    // Grounding happens before anything is persisted, so an unsupported quote can never
    // reach a stored result.
    const grounded = groundScreeningEvidence(response.data, [{ source: 'CV', text: cvText }]);

    const envelope: CandidateEvidenceEnvelope = {
      promptVersion: HRD_EVIDENCE_EXTRACTION_PROMPT_VERSION,
      preferenceVersion: job.preferenceVersion,
      scoringConfigurationVersion: job.scoringConfigurationVersion,
      requirementVersion: job.requirementVersion,
      provider: response.provider,
      model: response.model,
      processedAt: new Date().toISOString(),
      grounding: grounded.summary,
      evidence: grounded.data,
    };

    // Provider-cost accounting only; the batch's credits are settled by the queue runner.
    await this.usage({
      userId: job.userId,
      feature: 'HRD_SCREEN_PER_CV',
      result: response,
      screeningJobId: job.id,
      screeningCandidateId: candidate.id,
    });

    const extractedName = grounded.data.candidateName?.trim() ?? '';

    return {
      candidateName:
        extractedName.length > 0 && extractedName.length <= 200 ? extractedName : undefined,
      summary: (grounded.data.summary || '').slice(0, MAX_SUMMARY_CHARS),
      analysis: envelope,
    };
  }
}

export const screeningEvidenceService = new ScreeningEvidenceService();

/** The `CandidateProcessor` the runtime uses unless a test overrides it. */
export const screeningEvidenceProcessor: CandidateProcessor = {
  name: HRD_EVIDENCE_EXTRACTION_PROMPT_VERSION,
  process: (context) => screeningEvidenceService.extract(context),
};

/** Re-exported so callers can assert the quote budget the prompt and schema agree on. */
export const MAX_EVIDENCE_QUOTE_CHARS = LIMITS.MAX_EVIDENCE_QUOTE_CHARS;
