import { expect, test } from '@playwright/test';

import { logPageDiagnostics } from './helpers/session.js';

/**
 * The sign-up form itself, end to end.
 *
 * This is the one spec that drives the form, and it waits for the flow to finish: the earlier
 * version of the screening specs clicked submit and navigated immediately, which aborted the
 * in-flight `POST /api/auth/dev/sign-up` and left the browser signed out (see helpers/session.ts).
 * Here the assertion is on the outcome - the stored token and the redirect to the account surface -
 * so the request is never cut short.
 */

test.describe('sign-in form', () => {
  test('creates an account in development and lands on the profile', async ({ page }) => {
    logPageDiagnostics(page);

    const email = `e2e-form-${Date.now()}@example.com`;

    await page.goto('/signin');
    await page.getByRole('tab', { name: 'Daftar' }).click();
    await page.getByLabel('Nama lengkap').fill('Perekrut Uji');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Kata sandi').fill('password-yang-kuat');

    // The tab and the submit button share the label "Daftar", so target the form's own button.
    await page.locator('button[type="submit"]').click();

    // The page redirects itself once the session is established; waiting on the URL is what keeps
    // the sign-up request alive.
    await expect(page).toHaveURL(/\/profile$/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'Profil' })).toBeVisible();

    const token = await page.evaluate(() => window.localStorage.getItem('aseb.access-token'));
    expect(token).toBeTruthy();
  });
});
