import { createHash } from 'node:crypto';

import {
  SCREENING_METHODOLOGY_NOTE,
  type CandidateResult,
  type CriterionResult,
  type EvidenceItem as EvidenceItemDto,
  type ReportFormat,
  type ScreeningReportList,
  type ScreeningReportResult,
  type ScreeningResultPayload,
} from '@aseb/shared';
import { stringify } from 'csv-stringify/sync';

import type {
  EvidenceItem,
  GeneratedReport,
  ScreeningCandidate,
  ScreeningCriterionResult,
  ScreeningJob,
  ScreeningRequirement,
} from '../generated/prisma/client.js';
import { getPdfRenderer } from '../providers/pdf/index.js';
import { ScreeningRepository } from '../repositories/screening.repository.js';
import {
  renderScreeningReportHtml,
  screeningReportCsvRows,
  screeningReportFileName,
  type ScreeningReportInput,
} from '../templates/report/screeningReport.js';
import { AppError } from '../utils/errors.js';
import { toIso, toNumber } from '../utils/values.js';
import { screeningService, type ScreeningService } from './screening.service.js';

type CriterionRow = ScreeningCriterionResult & { requirement: ScreeningRequirement };

/**
 * Screening results and reports (Phase 15).
 *
 * The read side of the pipeline: it reassembles what the queue, the extraction and the
 * deterministic engine stored into one auditable payload per candidate, and renders that
 * same payload as CSV or PDF. It never recomputes a score - the stored numbers are the
 * source of truth.
 *
 * Reports are **not** billed separately: the pricing catalogue has no report feature key,
 * because the per-CV screening price already covers producing the result a report renders.
 * Adding a paid report means adding a feature key to `packages/shared` and the pricing
 * table, not a literal here.
 */
export class ScreeningReportService {
  constructor(
    private readonly repository = new ScreeningRepository(),
    private readonly jobs: ScreeningService = screeningService,
  ) {}

  private toEvidenceDto(row: EvidenceItem): EvidenceItemDto {
    return {
      quote: row.quote,
      source: row.source,
      page: row.page,
      url: row.url,
      note: row.note,
    };
  }

  private toCriterionDto(row: CriterionRow): CriterionResult {
    return {
      requirementId: row.requirementId,
      criterion: row.requirement.text,
      category: row.requirement.category,
      requirementClass: row.requirement.requirementClass,
      weight: row.requirement.weight,
      normalisedWeight: toNumber(row.normalisedWeight),
      hardRequirement: row.requirement.hardRequirement,
      status: row.status,
      verificationStatus: row.verificationStatus,
      confidence: toNumber(row.confidence),
      earnedScore: toNumber(row.earnedScore),
      evidence: [],
      notes: row.notes ?? '',
    };
  }

  /**
   * Assembles one candidate's result.
   *
   * Ranking is applied by the caller: unscored candidates must not be ordered ahead of
   * scored ones (`ORDER BY score DESC` would put NULLs first in PostgreSQL), so the sort
   * happens here in code where the rule is explicit.
   */
  private toCandidateResult(
    job: ScreeningJob,
    candidate: ScreeningCandidate,
    criteria: readonly CriterionRow[],
    evidence: readonly EvidenceItem[],
  ): CandidateResult {
    const evidenceByCriterion = new Map<string, EvidenceItemDto[]>();
    const ownEvidence: EvidenceItemDto[] = [];

    for (const row of evidence) {
      const dto = this.toEvidenceDto(row);
      ownEvidence.push(dto);
      if (!row.criterionResultId) continue;
      const list = evidenceByCriterion.get(row.criterionResultId) ?? [];
      list.push(dto);
      evidenceByCriterion.set(row.criterionResultId, list);
    }

    const criteriaResults = criteria.map((row) => ({
      ...this.toCriterionDto(row),
      evidence: evidenceByCriterion.get(row.id) ?? [],
    }));

    const byClass = (requirementClass: CriterionResult['requirementClass']) =>
      criteriaResults.filter((criterion) => criterion.requirementClass === requirementClass);

    return {
      candidateId: candidate.id,
      candidateName: candidate.candidateName,
      fileName: candidate.fileName,
      processingStatus: candidate.state,
      score: candidate.score,
      eligibilityStatus: candidate.eligibilityStatus,
      criteriaResults,
      requiredCriteria: byClass('REQUIRED'),
      preferredCriteria: byClass('PREFERRED'),
      bonusCriteria: byClass('BONUS'),
      evidence: ownEvidence,
      strengths: (candidate.strengths as string[] | null) ?? [],
      gaps: (candidate.gaps as string[] | null) ?? [],
      uncertainties: (candidate.uncertainties as string[] | null) ?? [],
      // Derived from the criterion rows, so it stays true even if the derived lists change.
      unmetHardRequirements: criteriaResults
        .filter((criterion) => criterion.hardRequirement && criterion.status !== 'FOUND')
        .map((criterion) => criterion.criterion),
      portfolioEvidence: ownEvidence.filter((item) => item.source === 'PORTFOLIO'),
      githubEvidence: ownEvidence.filter((item) => item.source === 'GITHUB'),
      verificationStatus: candidate.verificationStatus,
      summary: candidate.summary ?? '',
      generatedAt:
        toIso(candidate.completedAt) ?? toIso(candidate.updatedAt) ?? new Date().toISOString(),
      scoringConfigurationVersion: job.scoringConfigurationVersion,
      preferenceVersion: job.preferenceVersion,
      failureReason: candidate.failureReason,
    };
  }

  private async buildResults(userId: string, jobId: string): Promise<ScreeningResultPayload> {
    const job = await this.requireJob(jobId, userId);
    const { candidates, criteria, evidence } = await this.repository.findResultsForJob(jobId);

    const criteriaByCandidate = new Map<string, CriterionRow[]>();
    for (const row of criteria) {
      const list = criteriaByCandidate.get(row.candidateId) ?? [];
      list.push(row);
      criteriaByCandidate.set(row.candidateId, list);
    }

    const evidenceByCandidate = new Map<string, EvidenceItem[]>();
    for (const row of evidence) {
      const list = evidenceByCandidate.get(row.candidateId) ?? [];
      list.push(row);
      evidenceByCandidate.set(row.candidateId, list);
    }

    const ranked = [...candidates].sort((left, right) => {
      const scoreDelta = (right.score ?? -1) - (left.score ?? -1);
      if (scoreDelta !== 0) return scoreDelta;
      return left.candidateName.localeCompare(right.candidateName);
    });

    const summary = await this.jobs.jobSummary(userId, jobId);

    return {
      job: summary,
      methodologyNote: SCREENING_METHODOLOGY_NOTE,
      candidates: ranked.map((candidate) =>
        this.toCandidateResult(
          job,
          candidate,
          criteriaByCandidate.get(candidate.id) ?? [],
          evidenceByCandidate.get(candidate.id) ?? [],
        ),
      ),
    };
  }

  async getResults(userId: string, jobId: string): Promise<ScreeningResultPayload> {
    return this.buildResults(userId, jobId);
  }

  async listReports(input: {
    userId: string;
    jobId: string;
    page: number;
    pageSize: number;
  }): Promise<ScreeningReportList> {
    await this.requireJob(input.jobId, input.userId);

    const { items, total } = await this.repository.listReports({
      jobId: input.jobId,
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    });

    return {
      items: items.map((report) => this.toReportMetadata(report)),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }

  /**
   * Renders a snapshot of the current results.
   *
   * A batch that is still running can be exported on purpose: the report states the state
   * and counters it was generated from, so a partial snapshot is honest rather than
   * misleading. A job with no candidates at all is refused as "nothing to report".
   */
  async exportReport(input: {
    userId: string;
    jobId: string;
    format: ReportFormat;
  }): Promise<ScreeningReportResult> {
    const results = await this.buildResults(input.userId, input.jobId);
    if (results.candidates.length === 0) {
      throw AppError.conflict(
        'Belum ada kandidat pada batch ini, jadi belum ada yang bisa dilaporkan.',
      );
    }

    const generatedAt = new Date().toISOString();
    const reportInput: ScreeningReportInput = {
      job: results.job,
      methodologyNote: results.methodologyNote,
      candidates: results.candidates,
      generatedAt,
    };

    const fileName = screeningReportFileName({
      jobTitle: results.job.title,
      format: input.format,
      generatedAt,
    });

    let bytes: Buffer;
    let mimeType: string;

    if (input.format === 'CSV') {
      const { columns, rows } = screeningReportCsvRows(reportInput);
      // A BOM keeps Excel from mangling the Indonesian text.
      bytes = Buffer.from(`\uFEFF${stringify(rows, { header: true, columns })}`, 'utf8');
      mimeType = 'text/csv; charset=utf-8';
    } else {
      const html = renderScreeningReportHtml(reportInput);
      const rendered = await getPdfRenderer().render({
        html,
        title: `Laporan Screening: ${results.job.title}`,
      });
      bytes = rendered.buffer;
      mimeType = 'application/pdf';
    }

    const stored = await this.repository.createReport({
      jobId: input.jobId,
      createdByUserId: input.userId,
      format: input.format,
      fileName,
      mimeType,
      sizeBytes: bytes.byteLength,
      contentHash: createHash('sha256').update(bytes).digest('hex'),
    });

    return {
      ...this.toReportMetadata(stored),
      contentBase64: bytes.toString('base64'),
      // Included in the per-CV screening price; there is no report feature key to bill.
      creditsCharged: 0,
    };
  }

  private toReportMetadata(report: GeneratedReport) {
    return {
      id: report.id,
      jobId: report.screeningJobId,
      format: report.format,
      fileName: report.fileName,
      mimeType: report.mimeType,
      sizeBytes: report.sizeBytes,
      contentHash: report.contentHash,
      createdAt: report.createdAt.toISOString(),
    };
  }

  /** Owner-scoped: another recruiter's job is indistinguishable from a missing one. */
  private async requireJob(
    jobId: string,
    userId: string,
  ): Promise<ScreeningJob & { requirements: ScreeningRequirement[] }> {
    const job = await this.repository.findJobById(jobId);
    if (!job || job.userId !== userId) {
      throw AppError.notFound('Sesi screening tidak ditemukan.');
    }
    return job;
  }
}

export const screeningReportService = new ScreeningReportService();
