import { afterEach, describe, expect, it } from 'vitest';

import { readOAuthRedirectError, translateAuthError } from './supabase.js';

describe('readOAuthRedirectError', () => {
  afterEach(() => {
    window.location.hash = '';
  });

  it('reads the provider error and clears it from the URL', () => {
    window.location.hash = '#error=access_denied&error_description=Sesi+ditolak';

    expect(readOAuthRedirectError()).toBe('Sesi ditolak');
    expect(window.location.hash).toBe('');
  });

  it('ignores a successful redirect that only carries tokens', () => {
    window.location.hash = '#access_token=token&refresh_token=refresh&token_type=bearer';

    expect(readOAuthRedirectError()).toBeNull();
    expect(window.location.hash).toContain('access_token');
  });

  it('falls back to the error code when no description is present', () => {
    window.location.hash = '#error=server_error';

    expect(readOAuthRedirectError()).toBe('server_error');
  });

  it('returns nothing for a clean URL', () => {
    expect(readOAuthRedirectError()).toBeNull();
  });
});

describe('translateAuthError', () => {
  it('maps the common Supabase messages into the app copy', () => {
    expect(translateAuthError('Invalid login credentials')).toBe('Email atau kata sandi salah.');
    expect(translateAuthError('Email not confirmed')).toMatch(/konfirmasi/);
  });

  it('passes unknown messages through unchanged', () => {
    expect(translateAuthError('Something new from GoTrue')).toBe('Something new from GoTrue');
  });
});
