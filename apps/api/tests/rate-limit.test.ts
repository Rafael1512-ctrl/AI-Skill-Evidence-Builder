import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  InMemoryRateLimitStore,
  getRateLimitStore,
  rateLimit,
  resetRateLimits,
  setRateLimitStoreForTests,
  type RateLimitStore,
} from '../src/middleware/rate-limit.js';
import { withEnv } from './helpers/env.js';

/**
 * Rate limiting (Phase 19).
 *
 * Pure and offline: the store is only ever the in-memory one, except where the factory's
 * configuration choice is asserted (no request is made against Redis). The behaviours that
 * matter are the window semantics, that a blocked request is a typed 429 with a `retry-after`
 * the client can act on, and that a store outage fails open instead of taking the API down.
 */

function request(overrides: { ip?: string; userId?: string } = {}): Request {
  return {
    header: () => undefined,
    ip: overrides.ip ?? '203.0.113.7',
    socket: { remoteAddress: overrides.ip ?? '203.0.113.7' },
    auth: overrides.userId ? { userId: overrides.userId } : undefined,
  } as unknown as Request;
}

function responseStub() {
  const headers: Record<string, string> = {};
  const response = {
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
  } as unknown as Response;
  return { response, headers };
}

async function call(
  handler: ReturnType<typeof rateLimit>,
  req: Request,
): Promise<{ headers: Record<string, string>; error: unknown }> {
  const { response, headers } = responseStub();
  let error: unknown;
  const next: NextFunction = (value?: unknown) => {
    error = value;
  };
  await handler(req, response, next);
  return { headers, error };
}

describe('in-memory rate limit store', () => {
  it('counts inside a window and starts over after it', () => {
    const store = new InMemoryRateLimitStore();
    const start = 1_000_000;

    expect(store.hit('ip:1', 1_000, start)).toEqual({ count: 1, resetAt: start + 1_000 });
    expect(store.hit('ip:1', 1_000, start + 100)).toEqual({ count: 2, resetAt: start + 1_000 });
    expect(store.hit('ip:1', 1_000, start + 200).count).toBe(3);

    // A new window starts once the old one expired.
    expect(store.hit('ip:1', 1_000, start + 1_000)).toEqual({
      count: 1,
      resetAt: start + 2_000,
    });
  });

  it('keeps keys independent and can be cleared', () => {
    const store = new InMemoryRateLimitStore();

    store.hit('ip:1', 1_000, 0);
    store.hit('ip:1', 1_000, 0);
    expect(store.hit('ip:2', 1_000, 0).count).toBe(1);
    expect(store.size).toBe(2);

    store.reset();
    expect(store.size).toBe(0);
    expect(store.hit('ip:1', 1_000, 0).count).toBe(1);
  });
});

describe('rateLimit middleware', () => {
  afterEach(async () => {
    setRateLimitStoreForTests(null);
    await resetRateLimits();
  });

  it('allows exactly max requests and then answers 429 with retry-after', async () => {
    const handler = rateLimit({ scope: 'test', windowMs: 60_000, max: 2 });

    const first = await call(handler, request());
    expect(first.error).toBeUndefined();
    expect(first.headers['x-ratelimit-remaining']).toBe('1');

    const second = await call(handler, request());
    expect(second.error).toBeUndefined();
    expect(second.headers['x-ratelimit-remaining']).toBe('0');

    const third = await call(handler, request());
    expect(third.error).toMatchObject({ code: 'RATE_LIMITED', status: 429 });
    expect(Number(third.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('uses the caller-supplied key so a per-user cap does not affect other users', async () => {
    const handler = rateLimit({
      scope: 'testimonial-submit',
      windowMs: 60_000,
      max: 1,
      keyGenerator: (req) => `testimonial:${req.auth?.userId ?? 'anonymous'}`,
    });

    expect((await call(handler, request({ userId: 'user-1' }))).error).toBeUndefined();
    // A second review from the same account is refused...
    expect((await call(handler, request({ userId: 'user-1' }))).error).toMatchObject({
      code: 'RATE_LIMITED',
    });
    // ...while another account is unaffected.
    expect((await call(handler, request({ userId: 'user-2' }))).error).toBeUndefined();
  });

  it('fails open when the store is unavailable', async () => {
    const failing: RateLimitStore = {
      kind: 'memory',
      hit: () => {
        throw new Error('store down');
      },
      reset: () => undefined,
    };
    setRateLimitStoreForTests(failing);

    const result = await call(rateLimit({ scope: 'test', windowMs: 1_000, max: 1 }), request());

    // Availability first: the request proceeds even though nothing was counted.
    expect(result.error).toBeUndefined();
  });

  it('keeps each limiter in its own counter, so unrelated traffic cannot exhaust a quota', async () => {
    const general = rateLimit({ scope: 'api', windowMs: 60_000, max: 100 });
    const signUp = rateLimit({ scope: 'auth-sign-up', windowMs: 60_000, max: 2 });

    // Three ordinary API calls from the same address...
    await call(general, request());
    await call(general, request());
    await call(general, request());

    // ...must not consume the credential quota of a different limiter.
    expect((await call(signUp, request())).error).toBeUndefined();
    expect((await call(signUp, request())).error).toBeUndefined();
    expect((await call(signUp, request())).error).toMatchObject({ code: 'RATE_LIMITED' });
  });
});

describe('store selection', () => {
  afterEach(async () => {
    setRateLimitStoreForTests(null);
    await resetRateLimits();
  });

  it('uses memory when no Redis URL is configured', () => {
    setRateLimitStoreForTests(null);
    expect(getRateLimitStore().kind).toBe('memory');
  });

  it('uses Redis when REDIS_URL is set', async () => {
    await withEnv({ REDIS_URL: 'redis://127.0.0.1:6379' }, async () => {
      setRateLimitStoreForTests(null);
      const store = getRateLimitStore();

      expect(store.kind).toBe('redis');
      // Close the client so the test process has nothing left to keep alive.
      await (store as unknown as { close: () => Promise<void> }).close();
    });
  });
});

describe('client fingerprint', () => {
  it('prefers the first forwarded address and falls back to the socket', async () => {
    const { clientIp } = await import('../src/middleware/rate-limit.js');

    const forwarded = {
      header: (name: string) => (name === 'x-forwarded-for' ? '198.51.100.9, 10.0.0.1' : undefined),
      ip: '10.0.0.1',
      socket: { remoteAddress: '10.0.0.1' },
    } as unknown as Request;
    expect(clientIp(forwarded)).toBe('198.51.100.9');

    const direct = request({ ip: '203.0.113.5' });
    expect(clientIp(direct)).toBe('203.0.113.5');
  });
});

describe('middleware wiring', () => {
  it('is attached to testimonial submission', async () => {
    vi.resetModules();
    const { testimonialRouter } = await import('../src/routes/testimonial.routes.js');

    // The POST route carries the per-account limiter in front of validation.
    const layers = (
      testimonialRouter as unknown as {
        stack: Array<{
          route?: { path: string; methods: Record<string, boolean>; stack: unknown[] };
        }>;
      }
    ).stack;
    const post = layers.find((layer) => layer.route?.path === '/' && layer.route.methods.post);

    expect(post).toBeDefined();
    expect(post?.route?.stack.length).toBeGreaterThanOrEqual(4);
  });
});
