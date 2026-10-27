/// <reference types="vite/client" />

/**
 * Environment variables this app reads.
 *
 * Only `VITE_`-prefixed values reach the browser, so nothing secret may live here.
 */
interface ImportMetaEnv {
  /** Overrides the API origin; empty in development where Vite proxies `/api`. */
  readonly VITE_API_BASE_URL?: string;
  /** Supabase project URL, used only for Google identity linking. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anonymous key - a public value, safe for the browser. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}
