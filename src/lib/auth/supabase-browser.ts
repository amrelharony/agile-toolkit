"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

/**
 * Browser-side Supabase client used for auth + cloud history sync.
 *
 * Kept SEPARATE from `src/lib/realtime/supabase-client.ts` (which the
 * gamification feature owns) so the two concerns can evolve independently.
 *
 * Returns null when Supabase env vars are not set — the toolkit falls back
 * to anonymous-only mode without erroring.
 */
export function getAuthBrowserClient(): SupabaseClient | null {
  if (typeof window === "undefined") return null;
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;

  // SECURITY: pin the OAuth flow to PKCE. Supabase JS defaults to pkce
  // on browser clients in current versions, but newer / older
  // @supabase/ssr revisions have shipped with `implicit` as the
  // fallback in some build matrices. Implicit flow puts the access
  // token in the URL fragment (visible in browser history, leaked
  // via Referer to embedded resources, susceptible to fragment-
  // hijacking via third-party redirects), so the explicit pin is
  // worth the one extra line.
  //
  // SECURITY: never adopt a session from the page URL. OAuth codes are
  // exchanged only by the /auth/callback route, which enforces the owner
  // allowlist before it sets any cookie. With URL detection on, a public
  // page opened with `?code=…` (while this browser holds a PKCE code
  // verifier) would exchange the code client-side and skip that check.
  //
  // @supabase/ssr's createBrowserClient hard-codes `detectSessionInUrl`
  // to true in the browser AFTER spreading our `auth` options, so the
  // option alone is ignored. We also clear the flag on the GoTrue client
  // right after construction: auth-js reads it on the `?code=` path only
  // after awaiting the code-verifier lookup, so this lands in time
  // (implicit `#access_token=` URLs are already refused by the pkce flow
  // type). test/auth/supabase-url-session.test.ts pins this behaviour
  // against the installed versions.
  const client = createBrowserClient(url, anon, {
    auth: { flowType: "pkce", detectSessionInUrl: false },
  });
  (client.auth as unknown as { detectSessionInUrl: boolean }).detectSessionInUrl = false;
  cached = client;
  return cached;
}

export function isAuthAvailable(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
