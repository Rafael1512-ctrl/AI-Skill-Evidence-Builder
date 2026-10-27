import { createHash } from 'node:crypto';

import type { PdfRenderInput, PdfRenderer, PdfRenderResult } from './types.js';

/** Minimal, dependency-free single-page PDF writer (same technique as the test fixtures). */
function buildSimplePdf(lines: readonly string[]): Buffer {
  const escape = (text: string) => text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const contentLines = [
    'BT',
    '/F1 12 Tf',
    '16 TL',
    '72 760 Td',
    ...lines.flatMap((line) => [`(${escape(line)}) Tj`, 'T*']),
    'ET',
  ];
  const content = contentLines.join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  const header = '%PDF-1.4\n';
  let body = '';
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(header.length + body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }

  const xrefStart = header.length + body.length;
  const xref = [
    'xref',
    `0 ${objects.length + 1}`,
    '0000000000 65535 f ',
    ...offsets.map((offset) => `${offset.toString().padStart(10, '0')} 00000 n `),
    'trailer',
    `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    'startxref',
    String(xrefStart),
    '%%EOF',
    '',
  ].join('\n');

  return Buffer.from(header + body + xref, 'latin1');
}

/**
 * Deterministic offline renderer.
 *
 * It produces a real, parseable single-page PDF whose text records a fingerprint of the
 * HTML it received, so tests can prove the chosen template reached the renderer without
 * installing or launching Chromium.
 */
export class MockPdfRenderer implements PdfRenderer {
  readonly name = 'mock';

  async render(input: PdfRenderInput): Promise<PdfRenderResult> {
    const digest = createHash('sha256').update(input.html).digest('hex').slice(0, 16);
    const buffer = buildSimplePdf([
      'MOCK PDF EXPORT',
      `title=${input.title ?? 'cv'}`,
      `htmlBytes=${Buffer.byteLength(input.html, 'utf8')}`,
      `htmlSha256=${digest}`,
    ]);
    return { buffer, pageCount: 1 };
  }
}
