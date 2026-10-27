import { describe, expect, it } from 'vitest';

import { extractPdfEntriesFromZip, type ZipLimits } from '../src/utils/zip.js';
import { buildTextPdf } from './helpers/pdf.js';
import { buildZip } from './helpers/zip.js';

/**
 * ZIP hardening tests. Pure and offline: no database, no sockets.
 *
 * A screening ZIP is attacker-controlled input, so these pin the archive-level guards
 * (entry count, total size, compression ratio, corruption) that reject the whole upload,
 * and the per-entry rejections that preserve partial success.
 */

const PDF = buildTextPdf(['Kandidat Uji', 'Software Engineer dengan pengalaman lima tahun.']);

const LIMITS: ZipLimits = {
  maxEntries: 100,
  maxUncompressedBytes: 250 * 1024 * 1024,
  maxCompressionRatio: 120,
  maxEntryBytes: 5 * 1024 * 1024,
  maxPdfFiles: 50,
};

function limits(overrides: Partial<ZipLimits> = {}): ZipLimits {
  return { ...LIMITS, ...overrides };
}

describe('ZIP batch hardening', () => {
  it('extracts PDF entries in archive order with sanitised names', async () => {
    const archive = buildZip([
      { name: 'batch/andi-pratama.pdf', data: PDF },
      { name: 'batch/budi_santoso.CV.pdf', data: PDF },
    ]);

    const result = await extractPdfEntriesFromZip(archive, limits());

    expect(result.rejected).toEqual([]);
    expect(result.files.map((file) => file.fileName)).toEqual([
      'andi-pratama.pdf',
      'budi_santoso.CV.pdf',
    ]);
    expect(result.files[0]?.buffer.equals(PDF)).toBe(true);
    expect(result.files[0]?.sizeBytes).toBe(PDF.byteLength);
    // Entry paths are metadata only and must never keep a directory separator.
    expect(result.files.every((file) => !file.fileName.includes('/'))).toBe(true);
  });

  it('ignores directories and operating-system metadata entries', async () => {
    const archive = buildZip([
      { name: 'batch/' },
      { name: '__MACOSX/' },
      { name: '__MACOSX/batch/._andi.pdf', data: PDF },
      { name: 'batch/._andi.pdf', data: PDF },
      { name: '.DS_Store', data: 'junk' },
      { name: 'batch/andi.pdf', data: PDF },
    ]);

    const result = await extractPdfEntriesFromZip(archive, limits());

    expect(result.files.map((file) => file.fileName)).toEqual(['andi.pdf']);
    expect(result.rejected).toEqual([]);
  });

  it('reports non-PDF entries as rejected without failing the batch', async () => {
    const archive = buildZip([
      { name: 'batch/andi.pdf', data: PDF },
      { name: 'batch/catatan.txt', data: 'bukan CV' },
      { name: 'batch/rekap.xlsx', data: 'bukan CV' },
    ]);

    const result = await extractPdfEntriesFromZip(archive, limits());

    expect(result.files).toHaveLength(1);
    expect(result.rejected.map((entry) => entry.fileName)).toEqual(['catatan.txt', 'rekap.xlsx']);
    expect(result.rejected.every((entry) => entry.code === 'UNSUPPORTED_FILE')).toBe(true);
  });

  it('rejects the archive when it has too many entries', async () => {
    const archive = buildZip([
      { name: 'a.pdf', data: PDF },
      { name: 'b.pdf', data: PDF },
      { name: 'c.pdf', data: PDF },
      { name: 'd.pdf', data: PDF },
    ]);

    await expect(
      extractPdfEntriesFromZip(archive, limits({ maxEntries: 3 })),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE' });
  });

  it('rejects the archive when the total uncompressed size exceeds the limit', async () => {
    const archive = buildZip([
      { name: 'a.pdf', data: PDF },
      { name: 'b.pdf', data: PDF },
    ]);

    await expect(
      extractPdfEntriesFromZip(archive, limits({ maxUncompressedBytes: PDF.byteLength })),
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
  });

  it('rejects an archive whose compression ratio suggests a zip bomb', async () => {
    const archive = buildZip([
      { name: 'bomb.pdf', data: Buffer.alloc(400_000, 0x41), compress: true },
    ]);

    await expect(extractPdfEntriesFromZip(archive, limits())).rejects.toMatchObject({
      code: 'UNSUPPORTED_FILE',
    });
  });

  it('rejects a buffer that is not a ZIP at all', async () => {
    await expect(extractPdfEntriesFromZip(PDF, limits())).rejects.toMatchObject({
      code: 'UNSUPPORTED_FILE',
    });
  });

  it('rejects a truncated or corrupt archive', async () => {
    const truncated = buildZip([{ name: 'a.pdf', data: PDF }]).subarray(0, 24);

    await expect(extractPdfEntriesFromZip(truncated, limits())).rejects.toMatchObject({
      code: 'UNSUPPORTED_FILE',
    });
  });

  it('reports a single oversized PDF entry as rejected, not fatal', async () => {
    const archive = buildZip([
      { name: 'besar.pdf', data: Buffer.alloc(4_000, 0x42) },
      { name: 'kecil.pdf', data: PDF },
    ]);

    const result = await extractPdfEntriesFromZip(archive, limits({ maxEntryBytes: 2_000 }));

    expect(result.files.map((file) => file.fileName)).toEqual(['kecil.pdf']);
    expect(result.rejected).toEqual([
      expect.objectContaining({ fileName: 'besar.pdf', code: 'FILE_TOO_LARGE' }),
    ]);
  });

  it('enforces the maximum number of PDF entries in one archive', async () => {
    const archive = buildZip([
      { name: 'a.pdf', data: PDF },
      { name: 'b.pdf', data: PDF },
      { name: 'c.pdf', data: PDF },
    ]);

    await expect(
      extractPdfEntriesFromZip(archive, limits({ maxPdfFiles: 2 })),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
