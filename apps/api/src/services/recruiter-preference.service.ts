import {
  recruiterPreferencesSchema,
  type RecruiterPreferences,
  type RecruiterPreferenceSnapshot,
  type RecruiterPreferenceVersion,
} from '@aseb/shared';

import type { RecruiterPreference } from '../generated/prisma/client.js';
import { ScreeningRepository } from '../repositories/screening.repository.js';
import { AppError } from '../utils/errors.js';

/** Fresh defaults taken from the shared schema, so the two can never drift. */
function defaultPreferences() {
  return recruiterPreferencesSchema.parse({});
}

function toSnapshot(row: RecruiterPreference | null): RecruiterPreferenceSnapshot {
  if (!row) {
    // version 0 = never saved. Nothing is written on a read; the shared defaults are
    // immutable, so they need no snapshot.
    return { preferences: defaultPreferences(), version: 0, updatedAt: null };
  }

  const parsed = recruiterPreferencesSchema.safeParse(row.preferences);
  if (!parsed.success) {
    throw AppError.internal(
      new Error(`Stored recruiter preferences for ${row.userId} no longer match the contract.`),
    );
  }

  return {
    preferences: parsed.data,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Recruiter preferences are versioned, not overwritten.
 *
 * Every save increments the version counter and writes an immutable
 * `RecruiterPreferenceVersion` snapshot in the same transaction, so a screening job can
 * always name the exact preferences it was configured with.
 */
export class RecruiterPreferenceService {
  constructor(private readonly repository = new ScreeningRepository()) {}

  async get(userId: string): Promise<RecruiterPreferenceSnapshot> {
    return toSnapshot(await this.repository.findPreference(userId));
  }

  /**
   * The preferences exactly as they were when a job recorded `version`.
   *
   * Version 0 means "never saved": the immutable shared defaults were used and no snapshot
   * exists, which is why an unknown version is a consistency error rather than a silent
   * fallback to today's preferences (that would break reproducibility).
   */
  async getVersion(userId: string, version: number): Promise<RecruiterPreferences> {
    if (version <= 0) return defaultPreferences();

    const row = await this.repository.findPreferenceVersion({ userId, version });
    if (!row) {
      throw AppError.internal(
        new Error(`Preference snapshot v${version} for user ${userId} is missing.`),
      );
    }

    const parsed = recruiterPreferencesSchema.safeParse(row.preferences);
    if (!parsed.success) {
      throw AppError.internal(
        new Error(
          `Preference snapshot v${version} for user ${userId} no longer matches the contract.`,
        ),
      );
    }
    return parsed.data;
  }

  /** Validates with the shared contract, then persists a new version. */
  async save(userId: string, input: unknown): Promise<RecruiterPreferenceSnapshot> {
    const preferences = recruiterPreferencesSchema.parse(input);
    const { preference } = await this.repository.upsertPreferenceWithSnapshot({
      userId,
      preferences,
    });
    return toSnapshot(preference);
  }

  async listVersions(input: { userId: string; page: number; pageSize: number }): Promise<{
    items: RecruiterPreferenceVersion[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const { items, total } = await this.repository.listPreferenceVersions({
      userId: input.userId,
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    });

    return {
      items: items.map((row) => {
        const parsed = recruiterPreferencesSchema.safeParse(row.preferences);
        if (!parsed.success) {
          throw AppError.internal(
            new Error(`Preference snapshot ${row.id} no longer matches the contract.`),
          );
        }
        return {
          version: row.version,
          preferences: parsed.data,
          createdAt: row.createdAt.toISOString(),
        };
      }),
      total,
      page: input.page,
      pageSize: input.pageSize,
    };
  }
}

export const recruiterPreferenceService = new RecruiterPreferenceService();
export { defaultPreferences as defaultRecruiterPreferences };
