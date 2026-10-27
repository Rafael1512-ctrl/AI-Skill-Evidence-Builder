import { env } from '../../config/env.js';
import { MidtransPaymentProvider } from './midtrans.provider.js';
import { MockPaymentProvider } from './mock.provider.js';
import type { PaymentProvider } from './types.js';

let cached: PaymentProvider | null = null;

/**
 * Provider selection.
 *
 * `PAYMENT_PROVIDER=mock` is the default everywhere, so development and the automated
 * test suite stay offline and no real money can move. Choosing `midtrans` is an
 * explicit operator opt-in; the adapter additionally refuses to run without a server
 * key rather than silently degrading.
 */
export function getPaymentProvider(): PaymentProvider {
  if (cached) return cached;

  cached =
    env.PAYMENT_PROVIDER === 'midtrans'
      ? new MidtransPaymentProvider({
          serverKey: env.MIDTRANS_SERVER_KEY,
          clientKey: env.MIDTRANS_CLIENT_KEY,
          isProduction: env.MIDTRANS_IS_PRODUCTION,
          timeoutMs: env.EXTERNAL_FETCH_TIMEOUT_MS,
          finishUrl: `${env.FRONTEND_URL}/credits`,
        })
      : new MockPaymentProvider();

  return cached;
}

/** Test hook: replace the provider (e.g. to inject a failing gateway). */
export function setPaymentProviderForTests(provider: PaymentProvider | null): void {
  cached = provider;
}

export function getMockPaymentProvider(): MockPaymentProvider {
  const provider = getPaymentProvider();
  if (!(provider instanceof MockPaymentProvider)) {
    throw new Error('The active payment provider is not the mock provider.');
  }
  return provider;
}

export type {
  CreatedPayment,
  CreatePaymentInput,
  PaymentCustomer,
  PaymentProvider,
  PaymentProviderName,
  VerifiedWebhook,
  WebhookRequest,
} from './types.js';
export {
  MOCK_WEBHOOK_SIGNATURE_HEADER,
  MockPaymentProvider,
  mockWebhookSigningString,
  signMockWebhook,
} from './mock.provider.js';
export {
  MidtransPaymentProvider,
  mapMidtransStatus,
  midtransSignature,
} from './midtrans.provider.js';
