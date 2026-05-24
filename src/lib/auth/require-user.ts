import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { isEmailAuthorized } from "./authorize";

/**
 * Server-side helper for API route handlers (App Router `route.ts`).
 *
 * Returns the authenticated user + a Supabase client bound to the request
 * cookies, OR throws a `Response` (401 / 403 / 503) that the caller MUST
 * re-throw or return directly.
 *
 * Usage:
 *
 *   export async function POST(req: NextRequest) {
 *     try {
 *       const { user, supabase } = await requireAuthorizedUser();
 *       // ... do work
 *     } catch (resp) {
 *       if (resp instanceof Response) return resp;
 *       throw resp;
 *     }
 *   }
 *
 * Middleware enforces the same check at the edge, so reaching one of the
 * error branches here means either (a) a direct hit to an API route by
 * something that bypassed the matcher, or (b) the session expired between
 * the middleware pass and the handler. Both are defensible.
 */
export async function requireAuthorizedUser(): Promise<{
  user: User;
  supabase: SupabaseClient;
}> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw jsonError(503, "auth_unavailable", "Supabase is not configured.");
  }

  const cookieStore = cookies();
  const supabase = createServerClient(url, anon, {
    auth: { flowType: "pkce" },
    cookies: {
      get(name) {
        return cookieStore.get(name)?.value;
      },
      // API route handlers can write cookies, but most callers won't need
      // to (they just read the session). Keep both for completeness.
      set(name, value, options) {
        try {
          cookieStore.set({ name, value, ...options });
        } catch {
          /* Server Component context — no-op */
        }
      },
      remove(name, options) {
        try {
          cookieStore.set({ name, value: "", ...options });
        } catch {
          /* no-op */
        }
      },
    },
  });

  // Use getUser() not getSession(): getSession() trusts the cookie, while
  // getUser() round-trips to Supabase Auth to verify the JWT signature.
  // For API/MCP endpoints we want the verified check.
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw jsonError(401, "unauthenticated", "Sign in required.");
  }

  if (!isEmailAuthorized(data.user.email)) {
    throw jsonError(403, "not_authorized", "This account is not on the allowlist.");
  }

  // BUG-A7: assert the identity is a Google identity with a verified email.
  // The allowlist is paranoid-by-default — adding any second OAuth provider
  // later must not silently widen who can sign in just because their email
  // collides with an allowlist entry. Today (Google-only) this is redundant;
  // tomorrow it's load-bearing.
  const provider = (data.user.app_metadata as { provider?: unknown } | null)?.provider;
  if (provider !== undefined && provider !== "google") {
    throw jsonError(403, "wrong_provider", "Only Google identities are accepted.");
  }
  // If the OAuth provider supplied identity records, require the matched one
  // to be email-verified. Falls back permissively if identities aren't
  // populated (some Supabase configs omit the array).
  const identities = (data.user.identities ?? []) as Array<{
    provider: string;
    identity_data?: { email_verified?: boolean; email?: string };
  }>;
  if (identities.length > 0) {
    const matched = identities.find(
      (i) => i.identity_data?.email?.toLowerCase() === data.user.email?.toLowerCase()
    );
    if (matched && matched.identity_data?.email_verified === false) {
      throw jsonError(403, "email_unverified", "Email not verified.");
    }
  }

  return { user: data.user, supabase };
}

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: code, message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
