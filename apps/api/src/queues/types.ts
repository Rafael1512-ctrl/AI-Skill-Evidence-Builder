/**
 * Queue boundary for screening work.
 *
 * The API never talks to BullMQ (or to any driver) directly: it enqueues candidate ids and
 * a worker attaches the handler. That keeps Redis optional - `REDIS_URL` unset selects the
 * in-process driver, so development and the test suite never need a broker - and it keeps
 * the handler itself driver-agnostic and therefore unit-testable.
 */

export interface ScreeningCandidateJobData {
  candidateId: string;
  jobId: string;
  /** 1-based attempt number for this delivery. */
  attempt: number;
  /** True on the last allowed attempt: the handler must stop asking for a retry. */
  isFinalAttempt: boolean;
}

/** Runs one attempt for one candidate. Throwing asks the driver for a retry. */
export type ScreeningJobHandler = (data: ScreeningCandidateJobData) => Promise<void>;

export type QueueDriverName = 'bullmq' | 'in-process';

export interface ScreeningQueue {
  readonly driver: QueueDriverName;

  /** Adds one job per candidate. Re-enqueueing a finished candidate is a no-op handler-side. */
  enqueueCandidates(input: { jobId: string; candidateIds: readonly string[] }): Promise<void>;

  /** Attaches the handler. A queue without a handler only accumulates jobs. */
  start(handler: ScreeningJobHandler): Promise<void>;

  stop(): Promise<void>;

  /**
   * Resolves when no job is waiting, running or scheduled for a retry.
   *
   * Exact for the in-process driver. The BullMQ driver can only poll Redis, so it is
   * best-effort and bounded by a timeout.
   */
  waitForIdle(timeoutMs?: number): Promise<void>;
}

/** Pure driver choice, so the selection rule is testable without constructing a client. */
export function selectQueueDriver(redisUrl: string | undefined): QueueDriverName {
  return redisUrl && redisUrl.trim().length > 0 ? 'bullmq' : 'in-process';
}
