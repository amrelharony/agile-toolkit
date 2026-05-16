import { NextResponse, type NextRequest } from "next/server";
import { getAuthServerClient } from "@/lib/auth/supabase-server";

/**
 * OAuth callback handler.
 *
 * Google → Supabase → here. We exchange the `code` query param for a
 * session, which Supabase persists via cookies, then bounce the user
 * back to wherever they came from (or `/`).
 *
 * Security model:
 *   - `next` is sanitised against `safeNext` before any redirect.
 *   - Error responses use opaque short codes, never the upstream
 *     provider message (which can leak internal details to the
 *     referer log / browser history).
 *   - `Cache-Control: no-store` on every response — OAuth callbacks
 *     must never be cached by browsers or intermediary proxies.
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
 *   - The `/auth/` prefix itself: bouncing the user back through the
 *     callback creates loops and can recycle a now-stale `?code=`
 *     param into a re-exchange attempt. Send them home instead.
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
    // F7 — block recursion back through the callback. Even with valid
    // same-origin, `?next=/auth/callback?...` invites loops if a stale
    // `code` is re-presented or a future revision of this handler
    // forwards query state.
    if (u.pathname === "/auth/callback" || u.pathname.startsWith("/auth/callback/")) {
      return "/";
    }
    return u.pathname + u.search + u.hash;
  } catch {
    return "/";
  }
}

/**
 * Build a redirect response with the no-store cache directive applied.
 * OAuth callbacks must never enter any cache (browser, CDN, corporate
 * proxy) — a cached callback page can reveal the code/state to anyone
 * with read access to the cache and prevents fresh redirects from
 * landing on the right URL.
 */
function redirect(url: string): NextResponse {
  const res = NextResponse.redirect(url);
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // F18 — Google can also redirect with `?error=access_denied` (user
  // cancelled consent) or `?error=server_error` (provider failure)
  // instead of `?code=...`. Distinguish "user cancelled" from
  // "missing code" so the consumer can show a friendlier message.
  const providerError = searchParams.get("error");
  const next = safeNext(searchParams.get("next"));

  if (providerError) {
    // Don't leak the provider's raw error message (which can describe
    // internal Google account state in surprising ways). Map known
    // ones to short stable codes; everything else collapses to
    // `oauth_provider_error`.
    const code =
      providerError === "access_denied" ? "oauth_cancelled" : "oauth_provider_error";
    return redirect(`${origin}${next}?auth_error=${code}`);
  }

  if (!code) {
    return redirect(`${origin}${next}?auth_error=missing_code`);
  }

  const supabase = getAuthServerClient();
  if (!supabase) {
    return redirect(`${origin}${next}?auth_error=auth_disabled`);
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    // F1/F2 — never reflect `error.message` into the URL. The provider
    // message can include internal details (token shapes, project ids,
    // backend state) that should not survive into the referer header
    // or browser history. Log server-side; surface an opaque code.
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn("[auth/callback] exchangeCodeForSession failed:", error.message);
    }
    return redirect(`${origin}${next}?auth_error=oauth_exchange_failed`);
  }

  return redirect(`${origin}${next}`);
}
