import { assertUrlAllowed, classifyLinkHost } from './guards.js';
import type { OutboundFetchInput, OutboundFetchResult, OutboundHttpProvider } from './types.js';

/**
 * Offline outbound fetcher.
 *
 * The default in development and the only one the test suite uses, so no test ever touches
 * the network. It still runs the real URL guards, and it derives its answer from the URL, so
 * a test can ask for a reachable page, an empty one, or a blocked host deterministically.
 */
export class MockHttpProvider implements OutboundHttpProvider {
  readonly name = 'mock';

  constructor(private readonly pages: Readonly<Record<string, string>> = {}) {}

  async get(input: OutboundFetchInput): Promise<OutboundFetchResult> {
    const url = assertUrlAllowed(input.url);
    const kind = classifyLinkHost(url.hostname);
    const override = this.pages[url.toString()];

    const path = url.pathname
      .replace(/^\/+/, '')
      .replace(/[-_/]+/g, ' ')
      .trim();
    const body =
      override ??
      (kind === 'GITHUB'
        ? `<html><head><title>${url.hostname}${url.pathname}</title></head><body>Profil GitHub publik. Repository: ${path || 'utama'}.</body></html>`
        : `<html><head><title>${path || 'Portofolio'}</title></head><body>Halaman portofolio publik. Proyek: ${path || 'umum'}.</body></html>`);

    // `?empty=1` stands in for a page with no readable text; tests use it instead of a stub.
    const text = url.searchParams.get('empty') === '1' ? '' : body;

    return {
      url: input.url,
      finalUrl: url.toString(),
      status: 200,
      contentType: 'text/html; charset=utf-8',
      text,
      bytes: Buffer.byteLength(text, 'utf8'),
      truncated: false,
    };
  }
}
