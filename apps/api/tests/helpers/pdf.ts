/**
 * Minimal, dependency-free PDF writer for tests.
 *
 * Real PDFs are binary artifacts that no one should hand-edit; building them from a
 * short text here keeps the fixtures readable and keeps the suite offline.
 */

function escapePdfText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** Builds a text-based PDF whose extractable text is `lines`, in order. */
export function buildTextPdf(lines: readonly string[]): Buffer {
  const contentLines = [
    'BT',
    '/F1 12 Tf',
    '14 TL',
    '72 760 Td',
    ...lines.flatMap((line) => [`(${escapePdfText(line)}) Tj`, 'T*']),
    'ET',
  ];
  const content = contentLines.join('\n');

  const objects: string[] = [
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

/** A PDF with a page but no text at all: stands in for a scanned/image document. */
export function buildEmptyPdf(): Buffer {
  return buildTextPdf([]);
}
