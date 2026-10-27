import type {
  CvAuditAnalysis,
  CvEnhancementDocument,
  ScreeningEvidenceResponse,
} from '@aseb/shared';

import type { PromptPayload, PromptVersionId } from '../../prompts/types.js';

/** Token accounting for one provider call. */
export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  requestCount: number;
  /** Null when the provider did not report usage. */
  estimatedCostUsd: number | null;
  targetRevenueUsd: number | null;
  pricingKnown: boolean;
}

export interface AiCallResult<T> {
  data: T;
  usage: AiUsage;
  provider: string;
  model: string;
  /** Which runtime prompt produced this result, for auditability. */
  promptVersion: PromptVersionId;
  latencyMs: number;
}

/**
 * The audit is fully composed by the prompt layer before it reaches a provider.
 *
 * Providers transport `PromptPayload`; they never build prompts, so swapping DeepSeek
 * for another vendor cannot change a single feature prompt.
 */
export interface CvAuditInput {
  prompt: PromptPayload;
  signal?: AbortSignal;
}

export interface CvEnhancementInput {
  /**
   * The paid enhancement is composed by `prompts/jobSeeker/enhancePrompt.ts`, exactly
   * like the audit; the provider only transports the payload.
   */
  prompt: PromptPayload;
  signal?: AbortSignal;
}

/**
 * Screening evidence extraction.
 *
 * The call is composed by `prompts/hrd/evidenceExtractionPrompt.ts`; like the audit and
 * the enhancement, the provider only transports the payload.
 */
export interface ScreeningEvidenceInput {
  prompt: PromptPayload;
  signal?: AbortSignal;
}

export interface PortfolioSummary {
  reachable: boolean;
  title: string | null;
  summary: string;
  apparentSkills: string[];
  projectHints: string[];
  /** True when the content could not be interpreted at all. */
  inconclusive: boolean;
}

/**
 * Portfolio verification.
 *
 * Composed by `prompts/hrd/portfolioVerificationPrompt.ts`; the provider only transports it,
 * exactly like the audit, the enhancement and the screening call.
 */
export interface PortfolioAnalysisInput {
  prompt: PromptPayload;
  signal?: AbortSignal;
}

/**
 * The boundary between the product and any model vendor.
 *
 * Every implementation validates its own output against the shared Zod schemas before
 * returning, so business logic never receives unvalidated model JSON.
 */
export interface AIProvider {
  readonly name: string;
  readonly model: string;
  analyzeCv(input: CvAuditInput): Promise<AiCallResult<CvAuditAnalysis>>;
  enhanceCv(input: CvEnhancementInput): Promise<AiCallResult<CvEnhancementDocument>>;
  extractScreeningEvidence(
    input: ScreeningEvidenceInput,
  ): Promise<AiCallResult<ScreeningEvidenceResponse>>;
  analyzePortfolio(input: PortfolioAnalysisInput): Promise<AiCallResult<PortfolioSummary>>;
}
