import { lookup } from 'node:dns/promises';

import { env } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';
import {
  MAX_REDIRECTS,
  assertContentTypeAllowed,
  assertUrlAllowed,
  htmlToText,
  isBlockedAddress,
} from './guards.js';
import type { OutboundFetchInput, OutboundFetchResult, OutboundHttpProvider } from './types.js';

/**
 * The real outbound fetcher.
 *
 * Order of defence: scheme + hostname allow rules -> resolve every address and refuse if any
 * of them is internal -> fetch with `redirect: 'manual'` and re-run the whole check on each
 * hop -> cap the response size while reading -> refuse content types we cannot read as text.
 * Redirects are never followed blindly and DNS rebinding is defeated by checking the resolved
 * addresses rather than the hostname.
 */
export class GuardedHttpProvider implements OutboundHttpProvider {
  readonly name = 'guarded';

  constructor(
    private readonly options: {
      timeoutMs: number;
      maxBytes: number;
      maxRedirects?: number;
      /** Test seam: replaces the DNS resolver. */
      resolveHost?: (hostname: string) => Promise<string[]>;
    },
  ) {}

  private async resolve(hostname: string): Promise<string[]> {
    if (this.options.resolveHost) return this.options.resolveHost(hostname);
    // `all: true` so a host with both a public and a private address is refused outright.
    return (await lookup(hostname, { all: true })).map((entry) => entry.address);
  }

  private async assertHostAllowed(url: URL): Promise<void> {
    const addresses = await this.resolve(url.hostname).catch(() => [] as string[]);
    if (addresses.length === 0) {
      throw AppError.upstream('Host tidak dapat diresolusi.', { hostname: url.hostname });
    }
    for (const address of addresses) {
      if (isBlockedAddress(address)) {
        throw AppError.validation(
          { hostname: url.hostname },
          'Host ini menuju jaringan internal dan tidak boleh diambil.',
        );
      }
    }
  }

  async get(input: OutboundFetchInput): Promise<OutboundFetchResult> {
    const maxRedirects = this.options.maxRedirects ?? MAX_REDIRECTS;
    let current = assertUrlAllowed(input.url);
    let redirects = 0;

    for (;;) {
      await this.assertHostAllowed(current);

      const timeout = AbortSignal.timeout(this.options.timeoutMs);
      const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;

      const response = await fetch(current, {
        redirect: 'manual',
        signal,
        headers: {
          accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,application/json;q=0.8',
        },
      }).catch((error: unknown) => {
        throw AppError.upstream('Halaman tidak dapat diambil.', {
          reason: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
        });
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        redirects += 1;
        if (!location || redirects > maxRedirects) {
          throw AppError.upstream('Terlalu banyak pengalihan saat mengambil halaman.', {
            redirects,
          });
        }
        // Every hop is re-validated, including the DNS step.
        current = assertUrlAllowed(new URL(location, current).toString());
        continue;
      }

      if (!response.ok) {
        throw AppError.upstream('Halaman mengembalikan status gagal.', { status: response.status });
      }

      assertContentTypeAllowed(response.headers.get('content-type'));

      const { text, bytes, truncated } = await this.readBounded(response, this.options.maxBytes);
      const plain = htmlToText(text);

      return {
        url: input.url,
        finalUrl: current.toString(),
        status: response.status,
        contentType: response.headers.get('content-type'),
        text: plain,
        bytes,
        truncated,
      };
    }
  }

  /** Reads at most `maxBytes`; anything beyond it is dropped rather than buffered. */
  private async readBounded(
    response: Response,
    maxBytes: number,
  ): Promise<{ text: string; bytes: number; truncated: boolean }> {
    const body = response.body;
    if (!body) return { text: '', bytes: 0, truncated: false };

    const chunks: Uint8Array[] = [];
    let bytes = 0;
    let truncated = false;
    const reader = body.getReader();

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      bytes += value.byteLength;
      if (bytes > maxBytes) {
        const remaining = Math.max(0, maxBytes - (bytes - value.byteLength));
        chunks.push(value.subarray(0, remaining));
        truncated = true;
        await reader.cancel().catch(() => undefined);
        break;
      }
      chunks.push(value);
    }

    return {
      text: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8'),
      bytes: Math.min(bytes, maxBytes),
      truncated,
    };
  }
}

export function createGuardedHttpProvider(): GuardedHttpProvider {
  return new GuardedHttpProvider({
    timeoutMs: env.EXTERNAL_FETCH_TIMEOUT_MS,
    maxBytes: env.EXTERNAL_FETCH_MAX_BYTES,
  });
}
