import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isEmailAuthorized } from "@/lib/auth/authorize";

/**
 * Edge middleware — single-user auth gate.
 *
 * Every page route and API route runs through this. Allows only requests
 * carrying a valid Supabase session whose email is in AUTHORIZED_EMAILS.
 *
 * Fail-closed: if Supabase env vars or AUTHORIZED_EMAILS are unset, every
 * request is redirected to /not-authorized. That's the desired behaviour
 * — the toolkit should not boot in an unconfigured state.
 *
 * Bypass list (see `config.matcher` at the bottom):
 *   /auth/*           — sign-in, callback, sign-out flows
 *   /not-authorized   — the denied page itself
 *   /api/health       — uptime probes
 *   /_next/*          — Next.js static + image optimisation
 *   /favicon.ico, robots.txt, sitemap.xml — typical static
 *   /public assets    — anything with a file extension served by Next
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Bypass paths that must remain reachable for the auth flow itself,
  // for trivial static assets, AND for the MCP / agent endpoints that
  // perform their own bearer-token authentication. Middleware can't
  // enforce a Supabase session on those routes — external agents
  // (Claude Desktop, Claude Code) never carry one. Those routes' POST
  // handlers gate on `requireAuthorizedUser` or `verifyBearer` directly.
  const isGuestPath =
    pathname === "/guest" || pathname.startsWith("/guest/") || pathname.startsWith("/api/guest/");
  if (
    pathname.startsWith("/auth/") ||
    pathname === "/not-authorized" ||
    pathname === "/api/health" ||
    pathname === "/api/mcp" ||
    pathname.startsWith("/api/mcp/") ||
    pathname === "/api/agent/stream" ||
    isGuestPath
  ) {
    const resp = NextResponse.next();
    // Dual-cookie disambiguation: when an authenticated owner navigates
    // into the /guest/* tree carrying both an `sb-*` Supabase session
    // AND a leftover `agile-toolkit:guest` cookie (e.g. they tested the
    // guest flow on their own browser earlier), strip the guest cookie
    // on the way through. Otherwise `useCollaborativeSession` reads
    // guest-first and downgrades the owner into a guest identity,
    // attributing their edits to a squad_profile_id instead of user_id.
    if (
      isGuestPath &&
      hasOwnerSessionCookie(request) &&
      request.cookies.has("agile-toolkit:guest")
    ) {
      resp.cookies.set({
        name: "agile-toolkit:guest",
        value: "",
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 0,
      });
    }
    return resp;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Fail closed: if Supabase env is missing, treat every request as
  // unauthorised. Redirect rather than 500 so the page renders cleanly.
  if (!url || !anon) {
    return redirectTo(request, "/not-authorized", "config");
  }

  // Collect cookies set by Supabase during getUser() into an array,
  // then apply all of them to the final response in ONE pass.
  //
  // The prior implementation reassigned `response = NextResponse.next({
  // request })` inside each set/remove callback — Supabase often writes
  // BOTH the access token AND refresh token cookies in the same call,
  // and the reassignment dropped every cookie except the last one. Net
  // effect: rotated session cookies silently failed to persist; users
  // got 401'd mid-session.
  const cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }> =
    [];

  const supabase = createServerClient(url, anon, {
    auth: { flowType: "pkce" },
    cookies: {
      get(name) {
        return request.cookies.get(name)?.value;
      },
      set(name, value, options) {
        // Mutate the request copy so subsequent operations in THIS request
        // see the updated cookie (e.g. a refreshed access token used in
        // a follow-up getUser call).
        request.cookies.set({ name, value, ...options });
        cookiesToSet.push({ name, value, options });
      },
      remove(name, options) {
        request.cookies.set({ name, value: "", ...options });
        cookiesToSet.push({ name, value: "", options });
      },
    },
  });

  // getUser() verifies the JWT with Supabase rather than trusting the
  // cookie blindly. The extra round-trip is worth it: a forged cookie
  // would otherwise pass straight through to the app and only fail at
  // the RLS layer.
  const { data, error } = await supabase.auth.getUser();

  const buildResponse = (resp: NextResponse): NextResponse => {
    // Apply every cookie set during getUser() to whatever response the
    // caller is about to return — whether that's NextResponse.next() or
    // a redirect. Without this on the redirect path, the rotated tokens
    // are dropped and the user re-loads with the OLD cookie, which the
    // next middleware pass rejects, creating a redirect loop.
    for (const c of cookiesToSet) {
      resp.cookies.set({ name: c.name, value: c.value, ...c.options });
    }
    return resp;
  };

  if (error || !data.user) {
    return buildResponse(redirectTo(request, "/auth/sign-in", "unauthenticated"));
  }

  if (!isEmailAuthorized(data.user.email)) {
    // Privacy: do NOT log the rejected email. The denial event is enough.
    return buildResponse(redirectTo(request, "/not-authorized", "denied"));
  }

  return buildResponse(NextResponse.next({ request }));
}

function redirectTo(
  request: NextRequest,
  destination: string,
  reason: "config" | "unauthenticated" | "denied"
): NextResponse {
  // Preserve the originally-requested URL as `?next=…` so the sign-in
  // page can bounce the user back after a successful auth. Skip for the
  // `denied` and `config` cases — those land users on a terminal page.
  const url = request.nextUrl.clone();
  url.pathname = destination;
  url.search = "";
  if (reason === "unauthenticated") {
    const original = request.nextUrl.pathname + request.nextUrl.search;
    if (safeRelativeUrl(original)) {
      url.searchParams.set("next", original);
    }
  }
  return NextResponse.redirect(url);
}

// Cheap shape-check for "an owner Supabase session cookie is present."
// We don't try to verify it (that needs the full Supabase client and a
// round-trip), just notice that one of the `sb-*-auth-token` cookies
// exists. Used only to disambiguate the dual-cookie case on /guest/*
// — verification on the owner-side path remains in the main flow.
function hasOwnerSessionCookie(request: NextRequest): boolean {
  for (const c of request.cookies.getAll()) {
    if (c.name.startsWith("sb-") && c.name.endsWith("-auth-token")) return true;
  }
  return false;
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;
function safeRelativeUrl(raw: string): boolean {
  if (!raw || raw.length > 2048) return false;
  if (CONTROL_CHARS.test(raw)) return false;
  if (!raw.startsWith("/")) return false;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return false;
  // Belt-and-braces: parse against a dummy origin and require it survive.
  // Catches URL-encoded scheme/host bypasses like "/%2F%2Fevil.com" that
  // pass the textual checks above. (BUG-A5)
  try {
    const u = new URL(raw, "http://dummy.local");
    if (u.origin !== "http://dummy.local") return false;
  } catch {
    return false;
  }
  return true;
}

export const config = {
  // Match everything EXCEPT:
  //   - _next/static, _next/image, _next/data         (build artifacts)
  //   - favicon.ico, robots.txt, sitemap.xml, manifest (root statics)
  //   - any file with an extension served from /public (.svg, .png, etc.)
  //
  // The inner `(?!…)` is a negative lookahead consumed by Next's matcher
  // syntax. Keep this in sync with the bypass list at the top of the
  // function — the matcher is the fast path, the function body is the
  // safety net.
  matcher: [
    // The final alternative anchors the extension rule to the BASENAME
    // (last path segment) so that `/api/foo.json` or `/dashboard.csv`
    // still hit middleware. The prior `.*\.[a-zA-Z0-9]+$` rule matched
    // the whole pathname and silently exempted any dotted route. (BUG-A1)
    "/((?!_next/static|_next/image|_next/data|favicon\\.ico|robots\\.txt|sitemap\\.xml|manifest\\.webmanifest|[^/]+\\.[a-zA-Z0-9]+$).*)",
  ],
};
