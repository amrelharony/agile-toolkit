import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client. Used only by the OAuth callback route handler
 * to exchange the code → session and write the session cookie.
 *
 * Returns null when env vars are missing.
 */
export function getAuthServerClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;

  const cookieStore = cookies();

  return createServerClient(url, anon, {
    // SECURITY: match the browser client's pkce flow. The verifier
    // cookie written by the browser must be consumed by a server
    // client that also expects pkce — a flow-type mismatch would
    // make `exchangeCodeForSession` fall back to implicit semantics
    // and bypass the PKCE proof-of-possession check.
    auth: { flowType: "pkce" },
    cookies: {
      get(name) {
        return cookieStore.get(name)?.value;
      },
      set(name, value, options) {
        try {
          cookieStore.set({ name, value, ...options });
        } catch {
          // Server Component context — Next forbids set; safe to ignore,
          // the route handler is the only writer.
        }
      },
      remove(name, options) {
        try {
          cookieStore.set({ name, value: "", ...options });
        } catch {
          // Same as above.
        }
      },
    },
  });
}
