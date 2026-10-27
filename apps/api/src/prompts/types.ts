/**
 * Runtime prompt contracts.
 *
 * Kept separate from `promptBuilder.ts` so the AI provider can depend on the shapes
 * without importing any feature prompt. Changing a prompt's meaning means bumping its
 * version; cosmetic reflow does not.
 */
export const PROMPT_VERSIONS = [
  'JOB_SEEKER_AUDIT_V1',
  'JOB_SEEKER_ENHANCE_V1',
  'JOB_SEEKER_EVIDENCE_V1',
  'HRD_EVIDENCE_EXTRACTION_V1',
  'HRD_SCREENING_V1',
  'HRD_PORTFOLIO_VERIFICATION_V1',
] as const;

export type PromptVersionId = (typeof PROMPT_VERSIONS)[number];

export interface PromptMessage {
  readonly role: 'system' | 'user';
  readonly content: string;
}

/**
 * A fully composed request.
 *
 * `messages` is already layered (global policy and feature instructions in the system
 * role; context, task parameters and untrusted documents in the user role, in that
 * order). Providers transport it; they never compose it.
 */
export interface PromptPayload {
  readonly version: PromptVersionId;
  readonly messages: readonly PromptMessage[];
  readonly temperature: number;
}
