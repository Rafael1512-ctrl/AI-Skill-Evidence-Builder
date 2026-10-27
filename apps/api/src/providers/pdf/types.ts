/**
 * The PDF rendering boundary.
 *
 * Templates produce HTML; a renderer turns it into bytes. Keeping this behind an
 * interface means the default test suite never launches Chromium, and a future
 * containerised renderer can be swapped in without touching a template or a service.
 */
export interface PdfRenderInput {
  html: string;
  /** Suggested document title for PDF metadata. */
  title?: string | undefined;
}

export interface PdfRenderResult {
  buffer: Buffer;
  /** Best-effort page count; 0 when the renderer cannot determine it. */
  pageCount: number;
}

export interface PdfRenderer {
  readonly name: string;
  render(input: PdfRenderInput): Promise<PdfRenderResult>;
}
