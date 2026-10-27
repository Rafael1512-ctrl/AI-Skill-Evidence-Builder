import { env } from '../../config/env.js';
import { MockPdfRenderer } from './mock.provider.js';
import { PuppeteerPdfRenderer } from './puppeteer.provider.js';
import type { PdfRenderer } from './types.js';

let cached: PdfRenderer | null = null;

/**
 * Renderer selection.
 *
 * `PDF_RENDERER=mock` is the default so development and the automated test suite stay
 * offline; production sets `puppeteer` to render real PDFs with the bundled Chromium.
 */
export function getPdfRenderer(): PdfRenderer {
  if (cached) return cached;

  cached =
    env.PDF_RENDERER === 'puppeteer'
      ? new PuppeteerPdfRenderer(env.PUPPETEER_EXECUTABLE_PATH)
      : new MockPdfRenderer();

  return cached;
}

/** Test hook: replace the renderer (e.g. to inject a failing one). */
export function setPdfRendererForTests(renderer: PdfRenderer | null): void {
  cached = renderer;
}

export type { PdfRenderer, PdfRenderInput, PdfRenderResult } from './types.js';
export { MockPdfRenderer } from './mock.provider.js';
export { PuppeteerPdfRenderer, countPdfPages } from './puppeteer.provider.js';
