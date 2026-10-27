import type { Browser } from 'puppeteer';

import { AppError } from '../../utils/errors.js';
import type { PdfRenderInput, PdfRenderer, PdfRenderResult } from './types.js';

const RENDER_TIMEOUT_MS = 30_000;

/** Best-effort page count from a Chromium PDF: count page objects, never `/Pages`. */
export function countPdfPages(buffer: Buffer): number {
  const text = buffer.toString('latin1');
  const matches = text.match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : 0;
}

/**
 * Chromium renderer.
 *
 * Security posture: JavaScript is disabled, the HTML carries a strict CSP, and only
 * inline styles are allowed, so CV content can never fetch a remote resource or run a
 * script inside the rendering browser.
 *
 * Puppeteer is imported lazily so `PDF_RENDERER=mock` never loads it.
 */
export class PuppeteerPdfRenderer implements PdfRenderer {
  readonly name = 'puppeteer';

  constructor(private readonly executablePath?: string | undefined) {}

  async render(input: PdfRenderInput): Promise<PdfRenderResult> {
    const { default: puppeteer } = await import('puppeteer');

    let browser: Browser | undefined;
    try {
      browser = await puppeteer.launch({
        headless: true,
        ...(this.executablePath ? { executablePath: this.executablePath } : {}),
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      });

      const page = await browser.newPage();
      await page.setJavaScriptEnabled(false);
      await page.setContent(input.html, { waitUntil: 'load', timeout: RENDER_TIMEOUT_MS });

      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '14mm', right: '14mm', bottom: '14mm', left: '14mm' },
      });

      const buffer = Buffer.from(pdf);
      return { buffer, pageCount: countPdfPages(buffer) };
    } catch (cause) {
      throw AppError.upstream('Gagal membuat PDF dari template CV.', cause);
    } finally {
      await browser?.close().catch(() => undefined);
    }
  }
}
