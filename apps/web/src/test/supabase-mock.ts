import { vi } from 'vitest';

/**
 * Controllable stand-in for `@supabase/supabase-js`.
 *
 * The package is mocked at the module boundary so the auth provider, the sign-in page
 * and the profile page are exercised through the same code paths they use in
 * production - the SDK is the only thing replaced. A single instance is shared across
 * the tests in a file because `lib/supabase.ts` memoises the client; `resetSupabaseMock`
 * returns it to a known state between tests.
 */

export interface MockSession {
  access_token: string;
}

export type AuthListener = (event: string, session: MockSession | null) => void;

interface SessionResult {
  data: { session: MockSession | null };
  error: { message: string } | null;
}

interface ProviderResult {
  data: { provider: string; url: string | null };
  error: { message: string } | null;
}

interface PasswordResult {
  data: { session: MockSession | null; user: null };
  error: { message: string } | null;
}

interface SignOutResult {
  error: { message: string } | null;
}

const listeners = new Set<AuthListener>();
let currentSession: MockSession | null = null;

function registerListener(listener: AuthListener) {
  listeners.add(listener);
  return {
    data: {
      subscription: {
        unsubscribe: () => {
          listeners.delete(listener);
        },
      },
    },
  };
}

export const supabaseAuth = {
  getSession: vi.fn<() => Promise<SessionResult>>(),
  onAuthStateChange:
    vi.fn<(listener: AuthListener) => { data: { subscription: { unsubscribe: () => void } } }>(),
  signInWithOAuth:
    vi.fn<
      (input: { provider: string; options?: { redirectTo?: string } }) => Promise<ProviderResult>
    >(),
  signInWithPassword:
    vi.fn<(input: { email: string; password: string }) => Promise<PasswordResult>>(),
  signUp:
    vi.fn<
      (input: {
        email: string;
        password: string;
        options?: { data?: Record<string, unknown> };
      }) => Promise<PasswordResult>
    >(),
  signOut: vi.fn<() => Promise<SignOutResult>>(),
  linkIdentity:
    vi.fn<
      (input: { provider: string; options?: { redirectTo?: string } }) => Promise<ProviderResult>
    >(),
};

export const supabaseClientMock = { auth: supabaseAuth };

export const createClientMock = vi.fn(() => supabaseClientMock);

/** Stubs the public Supabase configuration the browser SDK needs. */
export function configureSupabaseEnv(): void {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
}

export function removeSupabaseEnv(): void {
  vi.stubEnv('VITE_SUPABASE_URL', '');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
}

export function setSupabaseSession(session: MockSession | null): void {
  currentSession = session;
}

/** Emits an SDK auth event to every subscribed listener, as the real client does. */
export function emitSupabaseAuthEvent(event: string, session: MockSession | null): void {
  currentSession = session;
  for (const listener of [...listeners]) listener(event, session);
}

/** Clears call history, listeners and any per-test implementation overrides. */
export function resetSupabaseMock(): void {
  listeners.clear();
  currentSession = null;

  supabaseAuth.getSession
    .mockReset()
    .mockImplementation(async () => ({ data: { session: currentSession }, error: null }));
  supabaseAuth.onAuthStateChange.mockReset().mockImplementation(registerListener);
  supabaseAuth.signInWithOAuth.mockReset().mockImplementation(async () => ({
    data: { provider: 'google', url: 'https://accounts.google.com/o/oauth2/v2/auth' },
    error: null,
  }));
  supabaseAuth.signInWithPassword
    .mockReset()
    .mockImplementation(async () => ({ data: { session: null, user: null }, error: null }));
  supabaseAuth.signUp
    .mockReset()
    .mockImplementation(async () => ({ data: { session: null, user: null }, error: null }));
  supabaseAuth.signOut.mockReset().mockImplementation(async () => ({ error: null }));
  supabaseAuth.linkIdentity
    .mockReset()
    .mockImplementation(async () => ({ data: { provider: 'google', url: null }, error: null }));
}
