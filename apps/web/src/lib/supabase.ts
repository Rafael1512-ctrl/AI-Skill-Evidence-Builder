import type { SupabaseClient, SupabaseClientOptions } from '@supabase/supabase-js';

/**
 * Browser-side Supabase client.
 *
 * Supabase owns credentials: email/password sign-in, sign-up, Google OAuth, session
 * persistence and token refresh all happen here. The Express API only ever sees the
 * resulting access token as a bearer token and verifies it against the project JWKS.
 *
 * The SDK is code-split so it never lands in the main bundle, but its download starts as
 * soon as this module is evaluated and the client is built on the first request.
 * `detectSessionInUrl` is evaluated when the client is constructed, so building it early
 * is what turns the `#access_token=…` fragment left by an OAuth redirect into a stored
 * session instead of letting it be discarded with the URL.
 *
 * Google OAuth client credentials are configured in the Supabase dashboard; they must
 * never appear as `VITE_` variables because everything with that prefix is public.
 */

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

/** Only the part of the SDK this app uses; the module is structurally cast at use. */
interface SupabaseSdk {
  createClient(
    url: string,
    anonKey: string,
    options?: SupabaseClientOptions<'public'>,
  ): SupabaseClient;
}

/** Pre-warmed when the deployment is configured; otherwise loaded on first use. */
let sdkModule: Promise<unknown> | null = readSupabaseConfig()
  ? import('@supabase/supabase-js')
  : null;

let cached: SupabaseClient | null = null;

function loadSdkModule(): Promise<unknown> {
  sdkModule ??= import('@supabase/supabase-js');
  return sdkModule;
}

/** Reads the public Supabase configuration, or `null` when the app runs offline. */
export function readSupabaseConfig(): SupabaseConfig | null {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

/** True when the browser has the public Supabase configuration Supabase auth needs. */
export function isSupabaseAuthConfigured(): boolean {
  return readSupabaseConfig() !== null;
}

/**
 * Returns the shared client, constructing it on first use.
 *
 * `null` means the deployment is running the offline `AUTH_DEV_MODE` strategy, and the
 * caller must fall back to the API's development endpoints. Concurrent callers share one
 * client.
 */
export async function loadSupabaseClient(): Promise<SupabaseClient | null> {
  const config = readSupabaseConfig();
  if (!config) return null;

  const sdk = (await loadSdkModule()) as SupabaseSdk;
  cached ??= sdk.createClient(config.url, config.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return cached;
}

/** Where Supabase returns the browser after an OAuth round trip. */
export function profileRedirectUrl(): string {
  return `${window.location.origin}/profile`;
}

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  'Invalid login credentials': 'Email atau kata sandi salah.',
  'Email not confirmed': 'Email belum dikonfirmasi. Buka tautan konfirmasi di kotak masuk Anda.',
  'User already registered': 'Email ini sudah terdaftar. Silakan masuk.',
  'Signups not allowed for this instance': 'Pendaftaran akun baru sedang dinonaktifkan.',
  'Email rate limit exceeded': 'Terlalu banyak percobaan. Coba lagi beberapa saat lagi.',
};

/** Maps the few Supabase messages users actually hit onto the app's Indonesian copy. */
export function translateAuthError(message: string): string {
  return AUTH_ERROR_MESSAGES[message] ?? message;
}

/**
 * Reads the provider error Supabase appends to the URL when an OAuth round trip fails.
 *
 * The SDK clears the fragment after a successful exchange, so anything left here is a
 * genuine failure (for example a redirect URL missing from the project allow list).
 */
export function readOAuthRedirectError(): string | null {
  const hash = window.location.hash.replace(/^#/, '');
  const params = new URLSearchParams(hash.length > 0 ? hash : window.location.search);
  const description = params.get('error_description') ?? params.get('error');
  if (!description || description.length === 0) return null;

  // One-shot: leaving the provider error in the URL would resurface it on every reload
  // and after the user has already seen it.
  if (hash.length > 0) {
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${window.location.search}`,
    );
  }
  return description;
}

async function requireClient(): Promise<SupabaseClient> {
  const client = await loadSupabaseClient();
  if (!client) {
    throw new Error(
      'Autentikasi Supabase belum dikonfigurasi (VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY).',
    );
  }
  return client;
}

/** Starts the Google OAuth round trip. The browser leaves this page immediately. */
export async function signInWithGoogle(redirectTo: string = profileRedirectUrl()): Promise<void> {
  const client = await requireClient();
  const { error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo },
  });
  if (error) throw new Error(translateAuthError(error.message));
}

/**
 * Attaches a Google identity to the account that is already signed in.
 *
 * Requires a real Supabase session: the SDK sends the current access token so GoTrue
 * knows which account the provider is being linked to. The API decides whether linking
 * is permitted and to which URL the provider returns.
 */
export async function linkGoogleIdentity(redirectTo: string): Promise<void> {
  const client = await requireClient();
  const { error } = await client.auth.linkIdentity({
    provider: 'google',
    options: { redirectTo },
  });
  if (error) throw new Error(translateAuthError(error.message));
}
