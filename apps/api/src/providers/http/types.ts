/**
 * The outbound-fetch boundary.
 *
 * Portfolio and GitHub verification needs the open web, which is exactly why it sits behind
 * an interface: the default test suite uses the offline provider, and the guarded provider
 * is the only place that is allowed to resolve a candidate-supplied hostname.
 */

export interface OutboundFetchInput {
  url: string;
  signal?: AbortSignal | undefined;
}

export interface OutboundFetchResult {
  /** The URL that was requested after `assertUrlAllowed`. */
  url: string;
  /** The final URL when redirects were followed (only ever to an allowed host). */
  finalUrl: string;
  status: number;
  contentType: string | null;
  /** Plain text, already stripped of markup and truncated to the byte cap. */
  text: string;
  bytes: number;
  truncated: boolean;
}

export interface OutboundHttpProvider {
  readonly name: string;
  /** Throws an `AppError` when the URL is not allowed or the page cannot be read. */
  get(input: OutboundFetchInput): Promise<OutboundFetchResult>;
}
