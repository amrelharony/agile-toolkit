import { NextResponse, type NextRequest } from "next/server";
import { getAuthServerClient } from "@/lib/auth/supabase-server";
import { isEmailAuthorized } from "@/lib/auth/authorize";

/**
 * OAuth callback handler.
 *
 * Google → Supabase → here. We exchange the `code` query param for a
 * session, which Supabase persists via cookies, then bounce the user
 * back to wherever they came from (or `/`).
 */

/**
 * Sanitise the `next` query param. Allow only same-origin paths starting
 * with a single `/`. Reject:
 *   - Protocol-relative URLs ("//evil.com" → could land on a foreign origin
 *     after browser normalisation in some legacy contexts)
 *   - Backslash-prefixed paths ("/\evil.com") that some browsers normalise
 *     differently
 *   - Anything containing control characters (newlines, null bytes, tab)
 *     which can confuse header parsers
 *   - Pseudo-protocols like "javascript:" — they cannot satisfy the
 *     leading-slash check, but we re-check by parsing.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

function safeNext(raw: string | null): string {
  if (!raw) return "/";
  if (raw.length > 2048) return "/";
  if (CONTROL_CHARS.test(raw)) return "/";
  if (!raw.startsWith("/")) return "/";
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  // Belt-and-braces: parse against a dummy origin and require pathname-only.
  try {
    const u = new URL(raw, "http://dummy.local");
    if (u.origin !== "http://dummy.local") return "/";
    return u.pathname + u.search + u.hash;
  } catch {
    return "/";
  }
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  // BUG-A8: reject cross-site fetches that aren't a top-level document
  // navigation. The legitimate flow is Google → 30x → our origin as a
  // document navigation, so Sec-Fetch-Dest === "document". An attacker who
  // tricks the victim's browser into fetching this URL via fetch()/img/etc
  // would carry Sec-Fetch-Site === "cross-site" with a non-document dest.
  // Browsers that don't send these headers fall through (we can't reject
  // cleanly).
  const fetchSite = request.headers.get("sec-fetch-site");
  const fetchDest = request.headers.get("sec-fetch-dest");
  if (fetchSite === "cross-site" && fetchDest && fetchDest !== "document") {
    return new Response("Forbidden", { status: 403 });
  }

  if (!code) {
    return NextResponse.redirect(`${origin}${next}?auth_error=missing_code`);
  }

  const supabase = getAuthServerClient();
  if (!supabase) {
    return NextResponse.redirect(`${origin}${next}?auth_error=auth_disabled`);
  }

  // PKCE state verification: Supabase's `exchangeCodeForSession` requires
  // the `sb-pkce-verifier` cookie set when `signInWithOAuth` ran in this
  // browser. The exchange call fails if the verifier is missing or doesn't
  // match the code's challenge, which transitively prevents the
  // login-CSRF / session-fixation attacks the `state` param classically
  // guards against. We therefore do NOT separately check
  // `searchParams.get("state")` — adding a second nonce here would only
  // help if Supabase ever weakened PKCE binding, in which case the right
  // fix is upstream. Documented assumption per audit 2025-05-25-10.
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    // Don't reflect verbose Supabase error messages into the URL — they
    // leak internal details and the consuming page would need to escape
    // them on render. Map to a small allowlist of short slugs that the
    // UI can localise; log the verbose message server-side for debugging.
    // eslint-disable-next-line no-console
    console.error("[auth/callback] exchangeCodeForSession failed:", error.message);
    const slug = mapAuthErrorToSlug(error.message);
    return NextResponse.redirect(`${origin}/auth/sign-in?auth_error=${slug}`);
  }

  // Single-user allowlist: even though the code exchange succeeded, the
  // identity behind that code may not be on the allowlist. Sign out
  // immediately so we don't leave a stale cookie that middleware would
  // bounce on every subsequent request, then send the user to the denied
  // page. Privacy: the rejected email is intentionally not echoed in any
  // URL or response body.
  const email = data.session?.user?.email ?? null;
  if (!isEmailAuthorized(email)) {
    await supabase.auth.signOut().catch(() => {
      /* best-effort; cookie is gone either way after redirect */
    });
    return NextResponse.redirect(`${origin}/not-authorized`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}

function mapAuthErrorToSlug(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("expired")) return "expired";
  if (m.includes("invalid")) return "invalid";
  if (m.includes("network") || m.includes("fetch")) return "network";
  if (m.includes("rate")) return "rate_limited";
  return "oauth_failed";
}
