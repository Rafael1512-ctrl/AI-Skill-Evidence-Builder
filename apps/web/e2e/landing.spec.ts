import { expect, test } from '@playwright/test';

test.describe('landing shell', () => {
  test('renders the product promise and both workflows', async ({ page }) => {
    await page.goto('/');

    await expect(
      page.getByRole('heading', { name: /bangun karier dengan cv yang diperkuat ai/i }),
    ).toBeVisible();
    // `exact` because the subtitle above also contains these words.
    await expect(page.getByText('Pencari Kerja', { exact: true })).toBeVisible();
    await expect(page.getByText('HRD / Rekruter', { exact: true })).toBeVisible();
  });
});
