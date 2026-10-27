import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { Redis } from 'ioredis';

import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * Fixed-window rate limiting with a pluggable store (Phase 19).
 *
 * The counter lives behind `RateLimitStore` so a single API container can use memory while a
 * multi-instance deployment shares counters through Redis; without that, each replica would
 * allow the full quota and the limit would multiply with the replica count.
 *
 * A store outage fails **open** (the request proceeds, with a warning): availability of the
 * product beats perfect abuse accounting, and the failure is visible in the logs. That is a
 * deliberate, documented trade-off (`docs/SECURITY.md`).
 */

export interface RateLimitHit {
  /** Requests seen in the current window, including this one. */
  count: number;
  /** Epoch milliseconds when the window resets. */
  resetAt: number;
}

export interface RateLimitStore {
  readonly kind: 'memory' | 'redis';
  hit(key: string, windowMs: number, now: number): RateLimitHit | Promise<RateLimitHit>;
  reset(): void | Promise<void>;
}

const KEY_PREFIX = 'rl:';

interface Bucket {
  count: number;
  resetAt: number;
}

/** Per-process store: correct for one container and for development. */
export class InMemoryRateLimitStore implements RateLimitStore {
  readonly kind = 'memory' as const;

  private readonly buckets = new Map<string, Bucket>();
  private lastSweep = Date.now();

  private sweep(now: number): void {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }

  hit(key: string, windowMs: number, now: number): RateLimitHit {
    this.sweep(now);

    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + windowMs };
      this.buckets.set(key, fresh);
      return { ...fresh };
    }

    bucket.count += 1;
    return { ...bucket };
  }

  reset(): void {
    this.buckets.clear();
  }

  get size(): number {
    return this.buckets.size;
  }
}

/**
 * Shared store for multi-instance deployments.
 *
 * The increment and the first-expiry are one Lua script, so two replicas hitting the same key
 * cannot both start the window or lose a count.
 */
export class RedisRateLimitStore implements RateLimitStore {
  readonly kind = 'redis' as const;

  private readonly redis: Redis;

  constructor(url: string) {
    this.redis = new Redis(url, { maxRetriesPerRequest: 2 });
    // Without a listener, an ioredis connection error would surface as an unhandled 'error'
    // event and crash the process. The limiter already fails open per request.
    this.redis.on('error', (error: Error) => {
      logger.warn({ err: error }, 'Rate limit Redis connection error');
    });
    this.redis.defineCommand('rateLimitHit', {
      numberOfKeys: 1,
      lua: [
        "local count = redis.call('INCR', KEYS[1])",
        "if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end",
        "local ttl = redis.call('PTTL', KEYS[1])",
        'return {count, ttl}',
      ].join('\n'),
    });
  }

  async hit(key: string, windowMs: number, now: number): Promise<RateLimitHit> {
    const client = this.redis as Redis & {
      rateLimitHit(key: string, windowMs: number): Promise<[number, number]>;
    };
    const [count, ttl] = await client.rateLimitHit(`${KEY_PREFIX}${key}`, windowMs);

    return { count, resetAt: now + Math.max(ttl, 0) };
  }

  /** Removes only this limiter's keys, so a shared Redis is not flushed by a test run. */
  async reset(): Promise<void> {
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', `${KEY_PREFIX}*`, 'COUNT', 100);
      cursor = next;
      if (keys.length > 0) await this.redis.del(...keys);
    } while (cursor !== '0');
  }

  async close(): Promise<void> {
    this.redis.disconnect();
  }
}

let store: RateLimitStore | null = null;

export function getRateLimitStore(): RateLimitStore {
  store ??= env.REDIS_URL ? new RedisRateLimitStore(env.REDIS_URL) : new InMemoryRateLimitStore();
  return store;
}

/** Test seam: inject a store, or pass `null` to fall back to configuration. */
export function setRateLimitStoreForTests(next: RateLimitStore | null): void {
  store = next;
}

export interface RateLimitOptions {
  /**
   * Counter namespace. Every limiter shares one store, so two unscoped limiters increment the *same*
   * bucket for an address and the strictest limit then applies to unrelated traffic: the eleventh
   * request of any kind from an IP answered `RATE_LIMITED` on `POST /api/auth/dev/sign-up`, which is
   * what broke the browser suite in CI (`PROJECT_CONTEXT.md` §8.62). The scope carries the
   * namespace; `keyGenerator` only carries the identity within it.
   */
  scope: string;
  windowMs: number;
  max: number;
  /** Defaults to the client IP; override to fingerprint differently (e.g. per user). */
  keyGenerator?: (req: Request) => string;
  message?: string;
}

export function clientIp(req: Request): string {
  const forwarded = req.header('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

export function rateLimit(options: RateLimitOptions): RequestHandler {
  const keyGenerator = options.keyGenerator ?? ((req: Request) => clientIp(req));

  return async (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = `${options.scope}:${keyGenerator(req)}`;

    let hit: RateLimitHit;
    try {
      hit = await getRateLimitStore().hit(key, options.windowMs, now);
    } catch (error) {
      // Fail open: see the module comment.
      logger.warn({ err: error, key }, 'Rate limit store unavailable; allowing the request');
      next();
      return;
    }

    res.setHeader('x-ratelimit-limit', String(options.max));
    res.setHeader('x-ratelimit-remaining', String(Math.max(0, options.max - hit.count)));

    if (hit.count > options.max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((hit.resetAt - now) / 1000));
      res.setHeader('retry-after', String(retryAfterSeconds));
      next(
        AppError.rateLimited(
          options.message ??
            `Terlalu banyak permintaan. Coba lagi dalam ${Math.ceil(retryAfterSeconds / 60)} menit.`,
          { retryAfterSeconds },
        ),
      );
      return;
    }

    next();
  };
}

/** Test helper: clears all counters in the active store. */
export function resetRateLimits(): Promise<void> {
  return Promise.resolve(getRateLimitStore().reset());
}
