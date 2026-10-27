import { describe, expect, it } from 'vitest';

import { enhanceCvUploadBodySchema } from '@aseb/shared';

/**
 * Multipart `options` contract for `POST /api/cv/enhance` (Phase 23).
 *
 * The browser sends the options object itself as a JSON string field
 * (`fields: { options: JSON.stringify(options) }`). The schema used to validate that string
 * against the *wrapper* shape `{ options: {...} }`, which silently succeeded and replaced every
 * field with its default - so target role, links and `useProfileContext` never reached the prompt
 * (the enhancement suite caught it as `headline: null` and a consent flag stuck on `false`).
 *
 * Pure and offline: one schema, no database, no HTTP.
 */

describe('enhance multipart options', () => {
  it('keeps every option the client sent', () => {
    const parsed = enhanceCvUploadBodySchema.parse(
      {
        options: JSON.stringify({
          targetPosition: 'Backend Engineer',
          targetCareer: 'Teknologi',
          linkedinUrl: 'https://linkedin.com/in/budi',
          additionalNotes: 'Tolong tonjolkan pengalaman Node.js.',
          useProfileContext: true,
        }),
      },
    );

    expect(parsed.options).toMatchObject({
      targetPosition: 'Backend Engineer',
      targetCareer: 'Teknologi',
      linkedinUrl: 'https://linkedin.com/in/budi',
      additionalNotes: 'Tolong tonjolkan pengalaman Node.js.',
      useProfileContext: true,
    });
  });

  it('fills the documented defaults when the field is absent or empty', () => {
    for (const body of [{}, { options: '' }]) {
      const parsed = enhanceCvUploadBodySchema.parse(body);
      expect(parsed.options).toMatchObject({ useProfileContext: false });
      expect(parsed.options.targetPosition).toBeUndefined();
    }
  });

  it('still refuses malformed JSON and unknown field values', () => {
    expect(enhanceCvUploadBodySchema.safeParse({ options: '{not-json' }).success).toBe(false);
    expect(
      enhanceCvUploadBodySchema.safeParse({ options: JSON.stringify({ linkedinUrl: 'bukan-url' }) })
        .success,
    ).toBe(false);
  });

  it('defaults the consent flag to off when the client omits it', () => {
    const parsed = enhanceCvUploadBodySchema.parse({
      options: JSON.stringify({ targetPosition: 'Data Analyst' }),
    });

    expect(parsed.options.useProfileContext).toBe(false);
    expect(parsed.options.targetPosition).toBe('Data Analyst');
  });
});
