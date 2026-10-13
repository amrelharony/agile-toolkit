import { NextResponse, type NextRequest } from "next/server";
import { getAuthServerClient } from "@/lib/auth/supabase-server";
import { authorizedEmailCount, isOwnerUser } from "@/lib/auth/authorize";

/**
 * OAuth callback handler.
 *
 * Google → Supabase → here. We exchange the `code` query param for a
 * session, which Supabase persists via cookies, then bounce the user
 * back to wherever they came from (or `/`).
 *
 * Every failure lands somewhere that explains it — never on `next`, which
 * is usually a public page that would silently ignore an `auth_error`:
 *   - Supabase refused a new account (`error_code=signup_disabled`): the
 *     Google account isn't the owner → /not-authorized?reason=denied.
 *   - Any other provider error (the user pressed Cancel, …) →
 *     /auth/sign-in?auth_error=oauth_failed&next=…
 *   - No code, auth not configured, or the exchange failed →
 *     /auth/sign-in?auth_error=<slug>&next=…
 *   - An empty owner allowlist (AUTHORIZED_EMAILS) is a deployment fault,
 *     not a verdict on the account → /not-authorized?reason=config, before
 *     any session exists (so nothing has to be revoked).
 *   - A session that isn't the owner's → signed out, then
 *     /not-authorized?reason=denied.
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

/**
 * Back to the sign-in page with `?auth_error=<slug>` (the page maps the slug
 * to a message) and the sanitised `next`, so a retry still lands where the
 * user was going. Built with the URL API: `next` is a full path that may
 * carry its own query and hash, and must arrive as one encoded param.
 */
function redirectToSignIn(origin: string, slug: string, next: string): NextResponse {
  const u = new URL("/auth/sign-in", origin);
  u.searchParams.set("auth_error", slug);
  u.searchParams.set("next", next);
  return NextResponse.redirect(u);
}

function redirectNotAuthorized(origin: string, reason: "denied" | "config"): NextResponse {
  const u = new URL("/not-authorized", origin);
  u.searchParams.set("reason", reason);
  return NextResponse.redirect(u);
}

function redirectNotOwner(origin: string): NextResponse {
  return redirectNotAuthorized(origin, "denied");
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

  // Supabase reports a provider-side failure on the redirect itself, as
  // `?error=…&error_code=…&error_description=…`, with no code. Before this
  // check those all surfaced as a misleading "missing_code".
  const providerError = searchParams.get("error");
  const providerErrorCode = searchParams.get("error_code");
  if (providerError || providerErrorCode) {
    // Logged, never reflected: the description is free text from upstream.
    console.warn(
      "[auth/callback] provider error:",
      providerErrorCode ?? providerError,
      (searchParams.get("error_description") ?? "").slice(0, 200)
    );
    // Sign-ups are disabled on the project, so a Google account Supabase
    // has never seen is by definition not the owner's.
    if (providerErrorCode === "signup_disabled") return redirectNotOwner(origin);
    return redirectToSignIn(origin, "oauth_failed", next);
  }

  if (!code) {
    return redirectToSignIn(origin, "missing_code", next);
  }

  const supabase = getAuthServerClient();
  if (!supabase) {
    return redirectToSignIn(origin, "auth_disabled", next);
  }

  // Same rule as the middleware and requireAuthorizedUser: with no owner
  // allowlisted, isOwnerUser() would reject EVERY account, the owner's
  // included. Don't exchange the code (no session to revoke afterwards —
  // the default sign-out scope is global and would end the owner's
  // sessions on every device sharing this Supabase project) and show the
  // operator hint instead of "not the owner".
  if (authorizedEmailCount() === 0) {
    return redirectNotAuthorized(origin, "config");
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
    return redirectToSignIn(origin, mapAuthErrorToSlug(error.message), next);
  }

  // Owner check: even though the code exchange succeeded, the identity
  // behind that code may not be the owner — allowlisted email, Google
  // identity, verified email, the same isOwnerUser rule the middleware and
  // API apply. Sign out immediately so no non-owner session is left in the
  // browser, then send the user to the denied page, which tells them every
  // tool still works without signing in. Privacy: the rejected email is
  // intentionally not echoed in any URL or response body.
  if (!isOwnerUser(data.session?.user).ok) {
    await supabase.auth.signOut().catch(() => {
      /* best-effort; cookie is gone either way after redirect */
    });
    return redirectNotOwner(origin);
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
