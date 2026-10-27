import { expect, test } from '@playwright/test';

import { buildTextPdf, CV_LINES } from './helpers/pdf.js';

/**
 * Guest audit: the only flow that needs no account at all.
 *
 * It is the cheapest end-to-end proof that upload -> extraction -> prompt -> structured result
 * works through the real UI, and it must stay free and anonymous.
 *
 * Written in Phase 20; not executed in the agent environment (Chromium is not installed there).
 */

test.describe('free CV audit', () => {
  test('runs for a guest and renders structured feedback', async ({ page }) => {
    await page.goto('/audit');

    await page.getByLabel(/berkas cv/i).setInputFiles({
      name: 'andi.pdf',
      mimeType: 'application/pdf',
      buffer: buildTextPdf(CV_LINES),
    });
    await page.getByRole('button', { name: 'Audit CV Gratis' }).click();

    // The API under test is pinned to the mock provider (see playwright.config.ts), so the
    // response is deterministic and no external service is called.
    await expect(page.getByRole('heading', { name: 'Hasil Audit CV' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText('/ 100')).toBeVisible();
  });
});
