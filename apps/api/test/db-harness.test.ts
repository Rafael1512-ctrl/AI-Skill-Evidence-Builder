import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { stopTestDatabase, useTestDatabase } from './helpers/db.js';

/**
 * Proves the integration harness itself works: a real PostgreSQL-compatible engine,
 * the real migration SQL, and Prisma talking to it over the wire protocol.
 */
describe('database harness', () => {
  let ctx: Awaited<ReturnType<typeof useTestDatabase>>;

  beforeAll(async () => {
    ctx = await useTestDatabase();
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  it('applies the initial migration', async () => {
    const result = await ctx.db.pglite.query<{ count: string }>(
      `select count(*)::text as count from pg_tables where schemaname = 'public'`,
    );
    expect(Number(result.rows[0]?.count ?? '0')).toBeGreaterThanOrEqual(20);
  });

  it('creates and reads rows through Prisma', async () => {
    const created = await ctx.prisma.user.create({
      data: { email: 'harness@example.com', fullName: 'Harness User' },
    });

    expect(created.id).toBeTruthy();
    expect(created.role).toBe('USER');
    expect(created.emailVerified).toBe(false);

    const found = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'harness@example.com' } });
    expect(found.fullName).toBe('Harness User');
  });

  it('enforces unique constraints', async () => {
    await expect(
      ctx.prisma.user.create({ data: { email: 'harness@example.com' } }),
    ).rejects.toThrow();
  });

  it('rolls back a failing transaction', async () => {
    const before = await ctx.prisma.user.count();

    await expect(
      ctx.prisma.$transaction(async (tx) => {
        await tx.user.create({ data: { email: 'rollback@example.com' } });
        throw new Error('force rollback');
      }),
    ).rejects.toThrow('force rollback');

    const after = await ctx.prisma.user.count();
    expect(after).toBe(before);
    expect(await ctx.prisma.user.findUnique({ where: { email: 'rollback@example.com' } })).toBeNull();
  });

  it('stores and reads enum values', async () => {
    const job = await ctx.prisma.screeningJob.create({
      data: {
        userId: (await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'harness@example.com' } })).id,
        title: 'Backend Engineer',
        description: 'Screening job used by the harness smoke test.',
        scoringConfigurationVersion: 'test',
        preferenceVersion: 1,
      },
    });

    expect(job.state).toBe('CREATED');
  });
});
