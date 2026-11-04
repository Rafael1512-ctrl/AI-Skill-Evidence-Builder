import { expect, test } from '@playwright/test';

import { buildTextPdf, CV_LINES } from './helpers/pdf.js';
import { signUpViaApi } from './helpers/session.js';

/**
 * Signed-in audit flow.
 *
 * It is the cheapest end-to-end proof that upload -> extraction -> prompt -> structured result
 * works through the real UI, including the account's five-audit daily allowance.
 *
 * Written in Phase 20; not executed in the agent environment (Chromium is not installed there).
 */

test.describe('CV audit', () => {
  test('runs for a signed-in account and renders structured feedback', async ({
    page,
    request,
  }) => {
    await signUpViaApi(page, request);
    await page.goto('/audit');

    await expect(page.getByText(/5 audit gratis tersisa hari ini/i)).toBeVisible();
    await page.getByLabel(/berkas cv/i).setInputFiles({
      name: 'andi.pdf',
      mimeType: 'application/pdf',
      buffer: buildTextPdf(CV_LINES),
    });
    await page.getByRole('button', { name: 'Audit CV', exact: true }).click();

    // The API under test is pinned to the mock provider (see playwright.config.ts), so the
    // response is deterministic and no external service is called.
    await expect(page.getByRole('heading', { name: 'Hasil Audit CV' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText('/ 100')).toBeVisible();
  });
});
