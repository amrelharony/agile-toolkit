import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { OWNER_DENIAL_MESSAGES, authorizedEmailCount, isOwnerUser } from "./authorize";
import { jsonError } from "./json-error";

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
  // An empty allowlist is a deployment fault, not a verdict on the caller. A
  // 403 would tell the client "not the owner" — and the client answers that
  // by signing the session out — so report it like the missing env above.
  if (authorizedEmailCount() === 0) {
    throw jsonError(503, "auth_unavailable", "AUTHORIZED_EMAILS is not configured.");
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
  if (error?.name === "AuthRetryableFetchError") {
    // Same split as the middleware's probe: the auth backend did not answer
    // (DNS, abort, 5xx), which says nothing about who is calling. A 401 would
    // make the client drop the owner's session over an outage.
    throw jsonError(503, "auth_unreachable", "The auth backend is unreachable.", {
      "retry-after": "5",
    });
  }
  if (error || !data.user) {
    throw jsonError(401, "unauthenticated", "Sign in required.");
  }

  // Allowlist + Google provider + verified email (BUG-A7), shared with the
  // middleware, the OAuth callback and the MCP PAT check.
  const owner = isOwnerUser(data.user);
  if (!owner.ok) {
    throw jsonError(403, owner.code, OWNER_DENIAL_MESSAGES[owner.code]);
  }

  return { user: data.user, supabase };
}
