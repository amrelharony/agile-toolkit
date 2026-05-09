import { NextResponse, type NextRequest } from "next/server";
import { getAuthServerClient } from "@/lib/auth/supabase-server";

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

  if (!code) {
    return NextResponse.redirect(`${origin}${next}?auth_error=missing_code`);
  }

  const supabase = getAuthServerClient();
  if (!supabase) {
    return NextResponse.redirect(`${origin}${next}?auth_error=auth_disabled`);
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      `${origin}${next}?auth_error=${encodeURIComponent(error.message)}`
    );
  }

  return NextResponse.redirect(`${origin}${next}`);
}
