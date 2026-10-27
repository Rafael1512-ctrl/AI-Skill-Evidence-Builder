import { expect, type APIRequestContext, type Page } from '@playwright/test';

import { TOPUP_PACKAGES } from '@aseb/shared';

/**
 * A signed-in browser session for the authenticated specs.
 *
 * The account is created through the development API and the token is seeded into
 * `localStorage` before the first navigation, which is what `AuthProvider` reads in offline mode.
 *
 * Driving the sign-up *form* here used to break the suite: the spec clicked submit and navigated
 * immediately, so the browser aborted the in-flight `POST /api/auth/dev/sign-up` (visible in the API
 * log as `request aborted`), no token was stored, and every protected page correctly rendered its
 * signed-out gate. The form itself stays covered end to end by `signin.spec.ts`; the batch specs
 * should not depend on it.
 */

const TOKEN_KEY = 'aseb.access-token';

export interface E2eSession {
  email: string;
  token: string;
}

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/**
 * Surfaces the app's own errors in the Playwright output instead of a bare timeout.
 *
 * `console.log` is the point here: Playwright prints whatever a spec logs, and these lines are
 * what makes a failing browser run explain itself (page errors, failed requests, 4xx/5xx).
 */
/* eslint-disable no-console -- a test diagnostic exists to be printed */
export function logPageDiagnostics(page: Page): void {
  page.on('pageerror', (error) => console.log(`[page error] ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') console.log(`[console error] ${message.text()}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      console.log(`[http ${response.status()}] ${response.request().method()} ${response.url()}`);
    }
  });
  page.on('requestfailed', (request) => {
    console.log(
      `[request failed] ${request.method()} ${request.url()} -> ${request.failure()?.errorText ?? 'unknown'}`,
    );
  });
}

export async function signUpViaApi(page: Page, request: APIRequestContext): Promise<E2eSession> {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1_000)}@example.com`;

  const response = await request.post('/api/auth/dev/sign-up', {
    data: { email, password: 'password-yang-kuat', fullName: 'Perekrut Uji' },
  });
  expect(response.status(), await response.text()).toBe(201);

  const body = (await response.json()) as { data: { accessToken: string } };
  const token = body.data.accessToken;
  expect(token).toBeTruthy();

  // Store the token through the real app origin (localStorage is origin-scoped) and reload, so
  // `AuthProvider` reads it on boot. This is checked immediately: if the session does not take,
  // the failure is reported here with the page's own errors instead of as a mysterious timeout
  // on whatever field the spec touches next.
  await page.goto('/');
  await page.evaluate(
    ([key, value]) => window.localStorage.setItem(key as string, value as string),
    [TOKEN_KEY, token] as const,
  );
  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: 'Profil' })).toBeVisible({ timeout: 20_000 });

  return { email, token };
}

/**
 * Credits the account through the real payment flow.
 *
 * A fresh account has no credits, so the first batch upload is answered with `402
 * INSUFFICIENT_CREDITS` (that is the product behaving correctly). Checkout plus the development
 * `simulate` endpoint drives the mock provider through the same signature-verified, idempotent
 * webhook path a real top-up uses, which also covers the payment flow end to end.
 *
 * The smallest package is used because a custom credit amount below the rupiah minimum is
 * rejected by design.
 */
export async function topUpViaApi(
  request: APIRequestContext,
  token: string,
  packageId: string = TOPUP_PACKAGES[0]?.id ?? 'credits-50',
): Promise<number> {
  const checkout = await request.post('/api/payments/checkout', {
    headers: authHeaders(token),
    data: { packageId },
  });
  expect(checkout.status(), await checkout.text()).toBe(201);

  const created = (await checkout.json()) as { data: { payment: { id: string; credits: number } } };
  const payment = created.data.payment;

  const simulated = await request.post(`/api/payments/${payment.id}/simulate`, {
    headers: authHeaders(token),
  });
  expect(simulated.status(), await simulated.text()).toBe(200);

  return payment.credits;
}
