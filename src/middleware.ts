import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  OWNER_DENIAL_MESSAGES,
  authorizedEmailCount,
  isOwnerUser,
  type OwnerCandidate,
} from "@/lib/auth/authorize";
import { jsonError } from "@/lib/auth/json-error";
import { routeKind } from "@/lib/auth/owner-routes";
import { COMICS_ROUTE, comicInternalRedirect, comicRewritePath } from "@/lib/comics/entry";

/**
 * How long the session check may take before we give up and treat the auth
 * backend as unreachable.
 *
 * A healthy getUser() round-trip is tens of milliseconds; 3s is far outside
 * normal and still leaves room under Vercel's middleware budget for the
 * redirect itself. The value is a ceiling on user-visible latency for EVERY
 * gated request when the auth backend is sick, so it should stay small.
 */
export const AUTH_TIMEOUT_MS = 3_000;

/**
 * Outcome of the session check. Every non-`ok` outcome fails closed for the
 * API and owner pages (public pages pass regardless).
 */
type SessionProbe =
  | { status: "ok"; user: OwnerCandidate }
  | { status: "anonymous" }
  | { status: "unreachable" };

/**
 * Just the slice of the Supabase client probeSession touches. Structural, so
 * tests can hand it a two-line fake and so we don't inherit createServerClient's
 * database generics (which erase to `any` when instantiated without a schema).
 */
type SessionVerifier = {
  auth: {
    getUser(): Promise<{
      data: { user: OwnerCandidate | null };
      error: { name?: string } | null;
    }>;
  };
};

/**
 * Run getUser() under a hard deadline.
 *
 * Two independent guards, because they cover different failures:
 *  - the `signal` on the client's fetch aborts the in-flight HTTP request, so
 *    a slow-but-alive backend doesn't leak a socket for the rest of the
 *    invocation;
 *  - this race is the actual guarantee. It bounds the middleware even if the
 *    call never reaches fetch at all — a hanging DNS lookup, an abort the
 *    runtime declines to honour — which is exactly the shape of the outage
 *    that motivated this.
 */
export async function probeSession(supabase: SessionVerifier): Promise<SessionProbe> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<SessionProbe>((resolve) => {
    timer = setTimeout(() => resolve({ status: "unreachable" }), AUTH_TIMEOUT_MS);
  });

  const verify = supabase.auth
    .getUser()
    .then(({ data, error }): SessionProbe => {
      if (!error && data.user) return { status: "ok", user: data.user };
      // Best-effort split: supabase-js raises AuthRetryableFetchError when
      // the request itself failed (DNS, abort, 5xx) as opposed to "this
      // cookie carries no valid session". Both fail closed for the owner
      // surface; the split only picks between a retryable 503 and a 401, so
      // a misclassification costs a wrong status code, never access.
      return error?.name === "AuthRetryableFetchError"
        ? { status: "unreachable" }
        : { status: "anonymous" };
    })
    .catch((): SessionProbe => ({ status: "unreachable" }));

  try {
    return await Promise.race([verify, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Edge middleware — public pages, owner-only server.
 *
 * Every tool page is public: a visitor without a session uses the toolkit in
 * their browser, data in localStorage, and nothing here gets in the way. What
 * stays owner-only is the server — every /api/* route that is not on the
 * bypass list — plus the pages in OWNER_ONLY_PAGES that exist only to manage
 * those APIs. The owner is a Supabase session whose user passes isOwnerUser
 * (allowlisted in AUTHORIZED_EMAILS, Google identity, verified email).
 *
 * So: pages fail OPEN, the API and owner pages fail CLOSED.
 *
 *   - No session cookie: answered without any I/O — no Supabase client, no
 *     env read. A page passes, the API gets a JSON 401, an owner page
 *     redirects to sign-in. Anonymous page views cost nothing, and a Supabase
 *     outage leaves the public site fully working.
 *   - Misconfigured (Supabase env or AUTHORIZED_EMAILS missing): pages pass
 *     with their cookies untouched, the API gets a JSON 503, owner pages go to
 *     /not-authorized?reason=config. An empty allowlist must not read as
 *     "this user is not the owner", or the owner would be signed out on every
 *     navigation with nothing pointing at the cause.
 *   - A session that is not the owner's: its auth cookies are expired, so the
 *     browser carries on as a visitor rather than being locked out of a
 *     public site. The API gets a JSON 403, owner pages /not-authorized.
 *
 * API answers are JSON, never a redirect: fetch follows a 307 keeping the
 * method, so a client would get the HTML sign-in page where it expects JSON
 * — or a 200 for a write that never happened.
 *
 * Fail-FAST too: the session check is the only outbound call this middleware
 * makes, and it is bounded (see AUTH_TIMEOUT_MS). An unreachable auth backend
 * must degrade — pages pass, the API answers 503, owner pages go to sign-in —
 * never hang. When the Supabase project's DNS record disappeared in July
 * 2026, the unbounded call meant every signed-in request sat until Vercel
 * killed the invocation — a site-wide 504 MIDDLEWARE_INVOCATION_TIMEOUT —
 * while signed-out visitors saw a perfectly healthy site, because with no
 * session cookie supabase-js answers locally and never touches the network.
 *
 * Bypass list (see isBypassPath, and `config.matcher` at the bottom):
 *   /auth/*           — sign-in, callback, sign-out flows
 *   /not-authorized   — the denied page itself
 *   /api/health       — uptime probes
 *   /api/mcp, /api/agent/stream — bearer-token / self-gated endpoints
 *   /api/agent/visitor — Amr's AI for visitors; same-site, rate-limited and
 *                     metered by its handler, reads no session
 *   /api/ai/tool/visitor — the tools' Ask Amr for visitors; gated the same
 *                     way by its handler. The owner's /api/ai/tool beside it
 *                     is NOT bypassed: the owner check here applies to it.
 *   /api/comics/hit, /api/comics/licence, /api/comics/guestbook,
 *   /api/comics/taps, /api/comics/stats — public reads and writes, gated by
 *                       their handlers
 *   /api/mascot/weather — the visitor's weather for Amr; reads no session
 *   /guest/*, /api/guest/* — invite-cookie flows, gated by their handlers
 *   /_next/*          — Next.js static + image optimisation
 *   /favicon.ico, robots.txt, sitemap.xml — typical static
 *   /public assets    — anything with a file extension served by Next
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isBypassPath(pathname)) return bypass(request);

  const internalComic = comicInternalRedirect(pathname);
  if (internalComic) return NextResponse.redirect(new URL(internalComic, request.url));

  const kind = routeKind(pathname);

  // /comics?ep=NN answers with a static page behind the same address, so the
  // first paint is right with no I/O. Every "this page passes" branch below
  // goes through passPage, so it holds for visitors and the owner alike.
  const comicPage = comicRewriteUrl(request);
  const passPage = (init?: PassInit): NextResponse =>
    comicPage ? NextResponse.rewrite(comicPage, init) : NextResponse.next(init);

  // Fast path, no I/O: without a session cookie there is nobody to verify.
  // Checked before the env so the public site keeps serving even when the
  // deployment's auth config is broken.
  if (!hasSupabaseSessionCookie(request)) {
    if (kind === "public-page") return passPage();
    if (kind === "api") return jsonError(401, "unauthenticated", "Sign in required.");
    return redirectTo(request, "/auth/sign-in", "unauthenticated");
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Fail closed for the owner surface, open for pages — and leave the
  // cookies alone: nothing here says the session is bad.
  if (!url || !anon || authorizedEmailCount() === 0) {
    warnMisconfiguredOnce();
    if (kind === "public-page") return passPage();
    if (kind === "api") {
      return jsonError(503, "auth_unavailable", "Owner sign-in is not configured.");
    }
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
    // Abort the underlying request at the same deadline probeSession races
    // against. Respects a caller-supplied signal if supabase-js ever sets one.
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(AUTH_TIMEOUT_MS) }),
    },
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
  // the RLS layer — and it is why this call must be bounded.
  const probe = await probeSession(supabase);

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

  if (probe.status === "unreachable") {
    // The one case worth a log line: the site looks "fine" to signed-out
    // visitors while every signed-in request lands here, so without this the
    // outage is invisible in the platform logs.
    console.warn(
      `[middleware] auth backend unreachable within ${AUTH_TIMEOUT_MS}ms — pages pass, owner routes fail closed`
    );
    // The session may well still be valid, so nothing is expired here.
    if (kind === "public-page") return buildResponse(passPage({ request }));
    if (kind === "api") {
      return buildResponse(
        jsonError(503, "auth_unreachable", "The auth backend is unreachable.", {
          "retry-after": "5",
        })
      );
    }
    return buildResponse(redirectTo(request, "/auth/sign-in", "auth_unreachable"));
  }

  if (probe.status === "anonymous") {
    // A stale cookie. buildResponse carries Supabase's own removals for it.
    if (kind === "public-page") return buildResponse(passPage({ request }));
    if (kind === "api") {
      return buildResponse(jsonError(401, "unauthenticated", "Sign in required."));
    }
    return buildResponse(redirectTo(request, "/auth/sign-in", "unauthenticated"));
  }

  const owner = isOwnerUser(probe.user);
  if (!owner.ok) {
    // Privacy: do NOT log the rejected email. The denial event is enough.
    //
    // A real session that isn't the owner's: drop it so the browser carries
    // on as a visitor. Stripped from the forwarded request too, so the page
    // rendered on this very request already sees a visitor.
    const names = sessionCookieNames(request, cookiesToSet);
    for (const name of names) request.cookies.delete(name);
    let resp: NextResponse;
    if (kind === "public-page") resp = passPage({ request });
    else if (kind === "api") resp = jsonError(403, owner.code, OWNER_DENIAL_MESSAGES[owner.code]);
    else resp = redirectTo(request, "/not-authorized", "denied");
    // After buildResponse, so the expiry overwrites any rotated token
    // Supabase queued under the same name.
    return expireCookies(buildResponse(resp), names);
  }

  return buildResponse(passPage({ request }));
}

type PassInit = Parameters<typeof NextResponse.next>[0];

/** The static page behind a valid /comics address, or null for everything else. */
function comicRewriteUrl(request: NextRequest): URL | null {
  if (request.nextUrl.pathname !== COMICS_ROUTE) return null;
  const path = comicRewritePath(request.nextUrl.searchParams);
  if (!path) return null;
  // The query stays, so the page's script can read where the visit came from.
  const url = request.nextUrl.clone();
  url.pathname = path;
  return url;
}

// Bypass paths that must remain reachable for the auth flow itself,
// for trivial static assets, AND for the MCP / agent endpoints that
// perform their own bearer-token authentication. Middleware can't
// enforce a Supabase session on those routes — external agents
// (Claude Desktop, Claude Code) never carry one. Those routes' POST
// handlers gate on `requireAuthorizedUser` or `verifyBearer` directly.
function isBypassPath(pathname: string): boolean {
  return (
    pathname.startsWith("/auth/") ||
    pathname === "/not-authorized" ||
    pathname === "/api/health" ||
    pathname === "/api/mcp" ||
    pathname.startsWith("/api/mcp/") ||
    pathname === "/api/agent/stream" ||
    // Exact match: anything under it stays owner-only.
    pathname === "/api/agent/visitor" ||
    // Exact match too: /api/ai/tool itself (the owner's) stays checked here.
    pathname === "/api/ai/tool/visitor" ||
    // Exact matches, never a prefix: a future /api/comics/* route stays
    // owner-only until it is listed here on purpose.
    pathname === "/api/comics/hit" ||
    pathname === "/api/comics/licence" ||
    pathname === "/api/comics/guestbook" ||
    pathname === "/api/comics/taps" ||
    pathname === "/api/comics/stats" ||
    pathname === "/api/mascot/weather" ||
    isGuestPath(pathname)
  );
}

function isGuestPath(pathname: string): boolean {
  return (
    pathname === "/guest" || pathname.startsWith("/guest/") || pathname.startsWith("/api/guest/")
  );
}

function bypass(request: NextRequest): NextResponse {
  // Dual-cookie disambiguation: when an authenticated owner navigates
  // into the /guest/* tree carrying both an `sb-*` Supabase session
  // AND a leftover `agile-toolkit:guest` cookie (e.g. they tested the
  // guest flow on their own browser earlier), strip the guest cookie
  // on the way through. Otherwise `useCollaborativeSession` reads
  // guest-first and downgrades the owner into a guest identity,
  // attributing their edits to a squad_profile_id instead of user_id.
  const stripGuestCookie =
    isGuestPath(request.nextUrl.pathname) &&
    hasSupabaseSessionCookie(request) &&
    request.cookies.has("agile-toolkit:guest");
  // The strip has to happen on the REQUEST as well, not just the response.
  // Deleting it only on the response expires it in the browser but leaves
  // the incoming cookie header intact, so the very render this fires on
  // still resolves a guest session in `(guest)/layout.tsx` — the owner got
  // a page mounted in guest mode whose writes then 401'd, because the
  // browser had already dropped the cookie the client fetches needed.
  // `NextResponse.next({ request })` forwards the mutated headers.
  if (stripGuestCookie) request.cookies.delete("agile-toolkit:guest");
  const resp = stripGuestCookie ? NextResponse.next({ request }) : NextResponse.next();
  if (stripGuestCookie) {
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

let warnedMisconfigured = false;
function warnMisconfiguredOnce(): void {
  // Once per isolate: every request with a session cookie lands here while
  // the config is broken, and one line is enough to point at the cause.
  if (warnedMisconfigured) return;
  warnedMisconfigured = true;
  console.warn(
    "[middleware] Supabase env or AUTHORIZED_EMAILS is not configured — pages pass, owner routes answer 503 / /not-authorized"
  );
}

function redirectTo(
  request: NextRequest,
  destination: string,
  reason: "config" | "unauthenticated" | "denied" | "auth_unreachable"
): NextResponse {
  // Preserve the originally-requested URL as `?next=…` so the sign-in
  // page can bounce the user back after a successful auth. Skip for the
  // `denied` and `config` cases — those land users on a terminal page.
  // `auth_unreachable` keeps it: the session may well still be valid, so
  // once the backend recovers the retry should land where they were going.
  // The terminal page itself gets `?reason=`, so /not-authorized can tell
  // "not the owner account" apart from "this deployment is misconfigured".
  const url = request.nextUrl.clone();
  url.pathname = destination;
  url.search = "";
  if (reason === "unauthenticated" || reason === "auth_unreachable") {
    const original = request.nextUrl.pathname + request.nextUrl.search;
    if (safeRelativeUrl(original)) {
      url.searchParams.set("next", original);
    }
  } else {
    url.searchParams.set("reason", reason);
  }
  return NextResponse.redirect(url);
}

// Cheap shape-check for "a Supabase session cookie is present." We don't
// try to verify it here (that needs the full Supabase client and a
// round-trip), just notice that one of the `sb-*-auth-token` cookies
// exists. It is the no-I/O fast path for every visitor, and it
// disambiguates the dual-cookie case on /guest/*.
// `@supabase/ssr` splits any session over 3180 bytes into numbered chunks
// named `sb-<ref>-auth-token.0`, `.1`, … and in that case the un-suffixed
// cookie does not exist at all. A plain `endsWith("-auth-token")` therefore
// missed every chunked session — which is the common case for Google OAuth,
// where the `identities[].identity_data` payload pushes the cookie past the
// chunk threshold — so the guest strip never fired for those users.
// The PKCE `sb-<ref>-auth-token-code-verifier` cookie deliberately does not
// match: it is not a session, and a half-finished sign-in must not cost a
// visitor a getUser round-trip.
const AUTH_TOKEN_COOKIE = /-auth-token(\.\d+)?$/;
function isSessionCookieName(name: string): boolean {
  return name.startsWith("sb-") && AUTH_TOKEN_COOKIE.test(name);
}

function hasSupabaseSessionCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some((c) => isSessionCookieName(c.name));
}

/** Every session cookie name in the request or queued by Supabase this pass. */
function sessionCookieNames(
  request: NextRequest,
  cookiesToSet: ReadonlyArray<{ name: string }>
): string[] {
  const names = [...request.cookies.getAll(), ...cookiesToSet]
    .map((c) => c.name)
    .filter(isSessionCookieName);
  return names.filter((name, i) => names.indexOf(name) === i);
}

function expireCookies(resp: NextResponse, names: readonly string[]): NextResponse {
  for (const name of names) resp.cookies.set({ name, value: "", path: "/", maxAge: 0 });
  return resp;
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
  //   - .well-known/*                                  (security.txt et al.)
  //   - the comics feed and sitemap, a .webp directly under /mascot, or a
  //     .webp or .jpg directly under /media (the book's cover, share images)
  //   - any top-level file with an extension served from /public (.svg, …)
  //
  // The inner `(?!…)` is a negative lookahead consumed by Next's matcher
  // syntax. Keep this in sync with the bypass list at the top of the
  // function — the matcher is the fast path, the function body is the
  // safety net. test/auth/middleware-matcher.test.ts compiles it the way
  // Next does and pins which paths are exempt.
  matcher: [
    // The final alternative anchors the extension rule to a TOP-LEVEL file
    // (no further `/` before the end) so that `/api/foo.json` still hits
    // middleware. The prior `.*\.[a-zA-Z0-9]+$` rule matched the whole
    // pathname and silently exempted any dotted route. (BUG-A1)
    //
    // The comics feed and sitemap are named exactly, and fetched by machines
    // that have no session to check. Never the bare `comics/` prefix: the
    // rewrite to the story pages lives in the middleware. Amr's sprite sheet and
    // the book's art are exempt so each fetch doesn't cost the owner a getUser
    // round-trip; link-preview bots fetch the share images with no session.
    "/((?!_next/static|_next/image|_next/data|favicon\\.ico|robots\\.txt|sitemap\\.xml|manifest\\.webmanifest|\\.well-known/|comics/(?:feed|sitemap)\\.xml$|mascot/[^/]+\\.webp$|media/[^/]+\\.(?:webp|jpg)$|[^/]+\\.[a-zA-Z0-9]+$).*)",
  ],
};
