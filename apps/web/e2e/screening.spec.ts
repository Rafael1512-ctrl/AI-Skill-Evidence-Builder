import { expect, test } from '@playwright/test';

import { buildTextPdf, CV_LINES } from './helpers/pdf.js';
import { logPageDiagnostics, signUpViaApi, topUpViaApi } from './helpers/session.js';

/**
 * Recruiter happy path, end to end.
 *
 * Requires the stack running with the offline providers (`AI_PROVIDER=mock`,
 * `OUTBOUND_HTTP_PROVIDER=mock`) and `AUTH_DEV_MODE=true` - which `playwright.config.ts` pins for
 * the servers it starts. The flow is the product's core promise: create a job, upload a batch, get
 * evidence per criterion, and export a report.
 */

const JOB_DESCRIPTION =
  'Kami mencari backend engineer berpengalaman dengan Node.js dan PostgreSQL untuk tim kecil.';

test.describe('screening batch', () => {
  test.beforeEach(async ({ page, request }) => {
    logPageDiagnostics(page);
    // Creates the account through the API and seeds the session before any navigation; see
    // helpers/session.ts for why the sign-up form is not driven from these specs.
    const session = await signUpViaApi(page, request);
    // A batch reserves HRD_SCREEN_PER_CV per accepted CV, so the account needs credits first.
    // The top-up goes through the real checkout + webhook path, which the product uses too.
    await topUpViaApi(request, session.token);
  });

  test('creates a job, screens one CV and exports a report', async ({ page }) => {
    await page.goto('/screening');
    await page.getByLabel('Posisi').fill('Backend Engineer');
    await page.getByLabel('Deskripsi pekerjaan').fill(JOB_DESCRIPTION);
    await page.getByLabel(/Kriteria/).fill('Pengalaman Node.js');
    await page.getByRole('button', { name: 'Buat sesi' }).click();

    // The job page opens on the new session.
    await expect(page.getByRole('heading', { name: 'Backend Engineer' })).toBeVisible();

    await page.getByLabel('Berkas CV').setInputFiles({
      name: 'andi.pdf',
      mimeType: 'application/pdf',
      buffer: buildTextPdf(CV_LINES),
    });
    await page.getByRole('button', { name: /Unggah/ }).click();

    // The mock provider reports the requirement as found, so the result is scored. The candidate
    // label is derived from the uploaded file name (`andi.pdf`), hence lowercase.
    await expect(page.getByText('#1 andi')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('100/100')).toBeVisible();
    await expect(page.getByText('Sesuai')).toBeVisible();

    await page.getByText(/Lihat bukti per kriteria/).click();
    await expect(page.getByText(/lima tahun/)).toBeVisible();

    // Report export: the CSV arrives as a download with the expected name.
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Ekspor CSV' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^laporan-screening-.*\.csv$/);
  });

  test('keeps a candidate with no supporting evidence visible instead of hiding it', async ({
    page,
  }) => {
    await page.goto('/screening');
    await page.getByLabel('Posisi').fill('Backend Engineer');
    await page.getByLabel('Deskripsi pekerjaan').fill(JOB_DESCRIPTION);
    await page.getByLabel(/Kriteria/).fill('Wajib punya SIM A');
    await page.getByRole('button', { name: 'Buat sesi' }).click();
    await expect(page.getByRole('heading', { name: 'Backend Engineer' })).toBeVisible();

    await page.getByLabel('Berkas CV').setInputFiles({
      name: 'andi.pdf',
      mimeType: 'application/pdf',
      buffer: buildTextPdf(CV_LINES),
    });
    await page.getByRole('button', { name: /Unggah/ }).click();

    // Nothing in the CV mentions a driving licence, so the single criterion is NOT_FOUND: the
    // candidate scores 0 and stays in the results with the reason, never hidden.
    await expect(page.getByText('#1 andi')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('0/100')).toBeVisible();
    await expect(page.getByText('Kurang sesuai')).toBeVisible();

    await page.getByText(/Lihat bukti per kriteria/).click();
    await expect(page.getByText('Bukti tidak ditemukan')).toBeVisible();
  });
});
