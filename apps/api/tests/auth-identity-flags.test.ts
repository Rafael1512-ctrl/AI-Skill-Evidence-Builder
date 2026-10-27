import { describe, expect, it } from 'vitest';

import { mergeAuthFlags, type AuthFlagState } from '../src/repositories/user.repository.js';

/**
 * Account flags must be additive across sign-in methods.
 *
 * This is what makes `googleConnected` stick after an email/password sign-in and what
 * keeps `hasPassword` after a Google sign-in. Only the account owner, through an
 * explicit provider operation, can remove an identity.
 */
const PASSWORD_ACCOUNT: AuthFlagState = {
  emailVerified: true,
  googleConnected: false,
  hasPassword: true,
};

const GOOGLE_ACCOUNT: AuthFlagState = {
  emailVerified: true,
  googleConnected: true,
  hasPassword: false,
};

describe('mergeAuthFlags', () => {
  it('creates a Google account from a Google sign-in', () => {
    expect(mergeAuthFlags(null, { provider: 'GOOGLE' }, true)).toEqual({
      emailVerified: true,
      googleConnected: true,
      hasPassword: false,
    });
  });

  it('creates a password account from an email sign-in', () => {
    expect(mergeAuthFlags(null, { provider: 'PASSWORD' }, false)).toEqual({
      emailVerified: false,
      googleConnected: false,
      hasPassword: true,
    });
  });

  it('keeps an existing password when Google is linked to it', () => {
    expect(mergeAuthFlags(PASSWORD_ACCOUNT, { provider: 'GOOGLE' }, true)).toEqual({
      emailVerified: true,
      googleConnected: true,
      hasPassword: true,
    });
  });

  it('keeps Google connected when the account later signs in with a password', () => {
    expect(mergeAuthFlags(GOOGLE_ACCOUNT, { provider: 'PASSWORD' }, true)).toEqual({
      emailVerified: true,
      googleConnected: true,
      hasPassword: true,
    });
  });

  it('never un-verifies an email that was already confirmed', () => {
    const verified = mergeAuthFlags(
      { emailVerified: true, googleConnected: false, hasPassword: true },
      { provider: 'PASSWORD' },
      false,
    );

    expect(verified.emailVerified).toBe(true);
  });
});
