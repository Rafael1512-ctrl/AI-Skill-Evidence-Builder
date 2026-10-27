import { buildHrdPrompt, type BuildHrdScreeningPromptInput } from './evidenceExtractionPrompt.js';
import type { PromptPayload, PromptVersionId } from '../types.js';

export type {
  BuildHrdScreeningPromptInput,
  HrdExternalEvidenceContext,
  HrdScreeningRequirementContext,
} from './evidenceExtractionPrompt.js';

/**
 * `HRD_SCREENING_V1` - the screening *context* composition.
 *
 * This id records which context composed a screening job (requirements + frozen recruiter
 * preferences + scoring configuration) and is persisted on `ScreeningJob.promptVersion`,
 * so the job stays reproducible even after the recruiter edits their preferences.
 *
 * The prompt that actually produces a screening call is `HRD_EVIDENCE_EXTRACTION_V1` in
 * `hrd/evidenceExtractionPrompt.ts`; both share one composition so they cannot drift.
 * See docs/AI_PROMPTS.md §14.1.
 */
export const HRD_SCREENING_PROMPT_VERSION = 'HRD_SCREENING_V1' satisfies PromptVersionId;

/** Composition used when a job's screening context has to be reproduced. */
export function buildHrdScreeningPrompt(input: BuildHrdScreeningPromptInput): PromptPayload {
  return buildHrdPrompt(input, { version: HRD_SCREENING_PROMPT_VERSION, temperature: 0.1 });
}
