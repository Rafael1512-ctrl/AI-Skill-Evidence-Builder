import { PDFParse } from 'pdf-parse';

import { AppError } from '../utils/errors.js';
import { sanitizeText, truncate, wordCount } from '../utils/text.js';

export interface ExtractedPdf {
  text: string;
  pages: Array<{ page: number; text: string }>;
  pageCount: number;
  charCount: number;
  wordCount: number;
  truncated: boolean;
  isTextBased: boolean;
}

/** Below this, a PDF is treated as a scan/image rather than a text document. */
const MIN_MEANINGFUL_CHARS = 60;
const MIN_MEANINGFUL_WORDS = 12;
const MAX_CHARS = 400_000;

/**
 * Extracts text from a PDF buffer.
 *
 * Only text-based PDFs are supported in the MVP: OCR is explicitly out of scope, and a
 * scanned document produces a clear TEXT_EXTRACTION_FAILED state rather than a
 * meaningless analysis.
 */
export async function extractPdfText(buffer: Buffer): Promise<ExtractedPdf> {
  let parser: PDFParse | null = null;

  try {
    parser = new PDFParse({ data: new Uint8Array(buffer) });
    const result = await parser.getText();

    const pages = result.pages.map((page) => ({
      page: page.num,
      text: sanitizeText(page.text ?? ''),
    }));

    const joined = sanitizeText(pages.map((page) => page.text).join('\n\n'));
    const bounded = truncate(joined, MAX_CHARS);
    const words = wordCount(bounded.text);

    const isTextBased = bounded.text.length >= MIN_MEANINGFUL_CHARS && words >= MIN_MEANINGFUL_WORDS;

    return {
      text: bounded.text,
      pages,
      pageCount: result.total || pages.length,
      charCount: bounded.text.length,
      wordCount: words,
      truncated: bounded.truncated,
      isTextBased,
    };
  } catch (error) {
    throw AppError.textExtractionFailed({
      reason: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
    });
  } finally {
    if (parser) {
      await parser.destroy().catch(() => undefined);
    }
  }
}

/** Extracts text and rejects scanned documents with an actionable message. */
export async function extractPdfTextOrThrow(buffer: Buffer): Promise<ExtractedPdf> {
  const extracted = await extractPdfText(buffer);

  if (!extracted.isTextBased) {
    throw AppError.textExtractionFailed({
      charCount: extracted.charCount,
      wordCount: extracted.wordCount,
      pageCount: extracted.pageCount,
      hint: 'PDF hasil pindai (scan) belum didukung. Mohon unggah PDF berbasis teks.',
    });
  }

  return extracted;
}

/**
 * Maps a quote back to the page it came from, so evidence can carry a page number.
 */
export function findPageForQuote(pages: ReadonlyArray<{ page: number; text: string }>, quote: string): number | null {
  const needle = quote.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 120);
  if (needle.length < 8) return null;

  for (const page of pages) {
    if (page.text.toLowerCase().replace(/\s+/g, ' ').includes(needle)) {
      return page.page;
    }
  }
  return null;
}
