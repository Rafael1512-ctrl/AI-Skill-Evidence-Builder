import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  devAuthResponseSchema,
  profileResponseSchema,
  type GoogleLinkState,
  type UserProfile,
} from '@aseb/shared';

import { ApiError, apiRequest } from './api.js';
import {
  isSupabaseAuthConfigured,
  loadSupabaseClient,
  readOAuthRedirectError,
  signInWithGoogle as startGoogleSignIn,
  translateAuthError,
} from './supabase.js';

const TOKEN_STORAGE_KEY = 'aseb.access-token';

function readStoredToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredToken(token: string | null): void {
  try {
    if (token === null) window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    else window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // Storage can be unavailable (private mode). The session then lives in memory only.
  }
}

export type AuthStatus = 'loading' | 'signed-in' | 'signed-out' | 'error';

/**
 * Which credential authority this deployment uses.
 *
 * `supabase` - the browser holds a real Supabase session and its access token is the
 *              bearer token for the API.
 * `dev`      - `VITE_SUPABASE_*` is absent, so the offline `AUTH_DEV_MODE` strategy
 *              (local email/password endpoints plus `aseb.access-token`) is used.
 */
export type AuthMode = 'supabase' | 'dev';

export interface SignUpInput {
  email: string;
  password: string;
  fullName: string;
}

export interface SignUpOutcome {
  /** True when Supabase requires the user to confirm their email before signing in. */
  needsEmailConfirmation: boolean;
}

export interface AuthValue {
  status: AuthStatus;
  mode: AuthMode;
  token: string | null;
  profile: UserProfile | null;
  googleLink: GoogleLinkState | null;
  /** A provider or session error worth showing on the sign-in page. */
  authError: string | null;
  signIn(email: string, password: string): Promise<void>;
  signUp(input: SignUpInput): Promise<SignUpOutcome>;
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
  reload(): void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function profileQueryKey(token: string | null) {
  return ['profile', token] as const;
}

/**
 * Session state for the web app.
 *
 * The access token is the only persisted state; everything else is derived from
 * `GET /api/profile`, so the UI can never show a stale role after the server-side role
 * changes. A 401 clears the session instead of leaving a half-signed-in shell.
 *
 * With Supabase configured, Supabase owns the session: `getSession()` restores it on
 * startup (including one created by an OAuth redirect) and `onAuthStateChange()` keeps
 * the bearer token in sync through sign-in, token refresh and sign-out. Without it, the
 * provider falls back to the local `AUTH_DEV_MODE` token so offline development and the
 * automated test suite keep working unchanged.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const mode: AuthMode = isSupabaseAuthConfigured() ? 'supabase' : 'dev';

  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [devToken, setDevToken] = useState<string | null>(() => readStoredToken());
  const [supabaseToken, setSupabaseToken] = useState<string | null>(null);
  // Offline deployments have no session to restore, so they are ready immediately.
  const [sessionReady, setSessionReady] = useState(!isSupabaseAuthConfigured());
  const [authError, setAuthError] = useState<string | null>(null);

  // The SDK is code-split; resolving it on mount is what gets it to process a redirect
  // left in the URL by the provider, before anything rewrites that URL.
  useEffect(() => {
    let active = true;
    void loadSupabaseClient().then((client) => {
      if (!active) return;
      setSupabase(client);
      if (client === null) setSessionReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let active = true;

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      setSupabaseToken(session?.access_token ?? null);
      setSessionReady(true);
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') setAuthError(null);
    });

    void supabase.auth.getSession().then(({ data: sessionData }) => {
      if (!active) return;
      setSupabaseToken(sessionData.session?.access_token ?? null);
      setAuthError(readOAuthRedirectError());
      setSessionReady(true);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [supabase]);

  // The strategy is decided by configuration, not by how far the SDK download got, so a
  // stale development token can never leak into a Supabase deployment.
  const token = mode === 'supabase' ? supabaseToken : devToken;

  const profileQuery = useQuery({
    queryKey: profileQueryKey(token),
    enabled: token !== null && sessionReady,
    retry: false,
    queryFn: () => apiRequest('/api/profile', { token, schema: profileResponseSchema }),
  });

  const queryError = profileQuery.error;

  useEffect(() => {
    if (!(queryError instanceof ApiError) || !queryError.isUnauthorized) return;

    // The API refused this token: drop it locally too, so the app cannot loop on a
    // session it will never be allowed to use.
    writeStoredToken(null);
    setDevToken(null);
    queryClient.removeQueries({ queryKey: ['profile'] });
    setSupabaseToken(null);

    void loadSupabaseClient().then((client) => {
      if (!client) return;
      setAuthError('Sesi Anda tidak lagi diterima oleh server. Silakan masuk kembali.');
      return client.auth.signOut().catch(() => undefined);
    });
  }, [queryError, queryClient]);

  const signIn = useCallback(async (email: string, password: string) => {
    setAuthError(null);
    const client = await loadSupabaseClient();

    if (client) {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw new Error(translateAuthError(error.message));
      setSupabaseToken(data.session?.access_token ?? null);
      return;
    }

    const session = await apiRequest('/api/auth/dev/sign-in', {
      method: 'POST',
      body: { email, password },
      schema: devAuthResponseSchema,
    });
    writeStoredToken(session.accessToken);
    setDevToken(session.accessToken);
  }, []);

  const signUp = useCallback(
    async ({ email, password, fullName }: SignUpInput): Promise<SignUpOutcome> => {
      setAuthError(null);
      const client = await loadSupabaseClient();

      if (client) {
        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        });
        if (error) throw new Error(translateAuthError(error.message));
        setSupabaseToken(data.session?.access_token ?? null);
        return { needsEmailConfirmation: data.session === null };
      }

      const session = await apiRequest('/api/auth/dev/sign-up', {
        method: 'POST',
        body: { email, password, fullName },
        schema: devAuthResponseSchema,
      });
      writeStoredToken(session.accessToken);
      setDevToken(session.accessToken);
      return { needsEmailConfirmation: false };
    },
    [],
  );

  const signInWithGoogle = useCallback(async () => {
    setAuthError(null);
    await startGoogleSignIn();
  }, []);

  const signOut = useCallback(async () => {
    writeStoredToken(null);
    setDevToken(null);
    setSupabaseToken(null);
    setAuthError(null);
    queryClient.removeQueries({ queryKey: ['profile'] });

    // Clearing the local session is what matters; a failed server-side revoke must not
    // leave the user stuck in a half-signed-in shell.
    const client = await loadSupabaseClient();
    await client?.auth.signOut().catch(() => undefined);
  }, [queryClient]);

  const reload = useCallback(() => {
    void profileQuery.refetch();
  }, [profileQuery]);

  const value = useMemo<AuthValue>(() => {
    let status: AuthStatus;
    if (!sessionReady) status = 'loading';
    else if (token === null) status = 'signed-out';
    else if (profileQuery.isSuccess) status = 'signed-in';
    else if (
      profileQuery.isError &&
      !(queryError instanceof ApiError && queryError.isUnauthorized)
    ) {
      status = 'error';
    } else status = 'loading';

    return {
      status,
      mode,
      token,
      profile: profileQuery.data?.profile ?? null,
      googleLink: profileQuery.data?.googleLink ?? null,
      authError,
      signIn,
      signUp,
      signInWithGoogle,
      signOut,
      reload,
    };
  }, [
    sessionReady,
    token,
    mode,
    profileQuery.isSuccess,
    profileQuery.isError,
    profileQuery.data,
    queryError,
    authError,
    signIn,
    signUp,
    signInWithGoogle,
    signOut,
    reload,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth harus dipakai di dalam <AuthProvider>.');
  return value;
}
