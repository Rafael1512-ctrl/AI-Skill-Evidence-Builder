import type {
  ScreeningCandidate,
  ScreeningJob,
  ScreeningRequirement,
} from '../generated/prisma/client.js';

/**
 * The per-candidate work unit behind the queue.
 *
 * Phase 12 owns the plumbing (state transitions, retries, progress, credit settlement,
 * idempotency); Phase 13 supplies the work itself as
 * `services/screening-evidence.service.ts`. A candidate is only ever marked `COMPLETED`
 * when a processor actually returned a result, so nothing is ever reported as screened
 * without evidence behind it.
 */

export interface CandidateProcessingContext {
  candidate: ScreeningCandidate;
  job: ScreeningJob & { requirements: ScreeningRequirement[] };
}

export interface CandidateProcessingResult {
  /** Set when the process read a better label from the document itself. */
  candidateName?: string | undefined;
  summary?: string | null;
  /** Structured output kept on the candidate row for auditability (serialised on write). */
  analysis?: unknown;
}

export interface CandidateProcessor {
  /** Recorded on the candidate's completion event, so a result names its producer. */
  readonly name: string;
  process(context: CandidateProcessingContext): Promise<CandidateProcessingResult>;
}

/**
 * Process-wide override.
 *
 * `null` means "use the runtime default", which is the real evidence-extraction processor
 * (`services/screening-evidence.service.ts`). Tests set a stub here; production never does.
 */
let override: CandidateProcessor | null = null;

export function getCandidateProcessorOverride(): CandidateProcessor | null {
  return override;
}

export function setCandidateProcessor(processor: CandidateProcessor | null): void {
  override = processor;
}
