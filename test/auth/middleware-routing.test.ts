// @vitest-environment node
/**
 * The middleware's routing table: pages fail OPEN, the API and owner pages
 * fail CLOSED.
 *
 *                     | public page        | /api/*          | owner page
 *   no session cookie | pass (no I/O)      | 401 JSON        | sign-in ?next=
 *   misconfigured     | pass               | 503 JSON        | /not-authorized?reason=config
 *   unreachable       | pass               | 503 + retry     | sign-in ?next=
 *   stale cookie      | pass (+ removals)  | 401 JSON        | sign-in ?next=
 *   not the owner     | pass + expire      | 403 + expire    | /not-authorized?reason=denied
 *   owner             | pass               | pass            | pass
 *
 * `@supabase/ssr` is mocked with a fake whose getUser() is scripted per test
 * and which writes cookies through the real set/remove callbacks, the way
 * supabase-js does when it refreshes or clears a session — so the cookie
 * batching is exercised, not just the branch choice.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type CookieOpts = Record<string, unknown>;
type FakeCookies = {
  set(name: string, value: string, options: CookieOpts): void;
  remove(name: string, options: CookieOpts): void;
};
type GetUserResult = {
  data: { user: Record<string, unknown> | null };
  error: { name?: string } | null;
};

const h = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  /** What getUser() resolves to; a never-settling promise models the outage. */
  getUser: (() => Promise.resolve({ data: { user: null }, error: null })) as () => Promise<unknown>,
  /** Cookie writes the fake performs during getUser(), as supabase-js would. */
  writes: [] as Array<{ name: string; value: string }>,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (...args: unknown[]) => {
    h.createServerClient(...args);
    const cookies = (args[2] as { cookies: FakeCookies }).cookies;
    return {
      auth: {
        getUser: () => {
          for (const w of h.writes) {
            if (w.value) cookies.set(w.name, w.value, { path: "/", sameSite: "lax" });
            else cookies.remove(w.name, { path: "/" });
          }
          return h.getUser();
        },
      },
    };
  },
}));

const OWNER_EMAIL = "owner@example.com";

function googleUser(email: string, emailVerified = true) {
  return {
    id: `id-${email}`,
    email,
    email_confirmed_at: "2026-01-01T00:00:00Z",
    app_metadata: { provider: "google" },
    identities: [{ provider: "google", identity_data: { email, email_verified: emailVerified } }],
  };
}

const OWNER = googleUser(OWNER_EMAIL);
const STRANGER = googleUser("eve@example.com");

function signedInAs(user: Record<string, unknown>) {
  h.getUser = () => Promise.resolve({ data: { user }, error: null } satisfies GetUserResult);
}

function staleSession() {
  h.getUser = () =>
    Promise.resolve({
      data: { user: null },
      error: { name: "AuthSessionMissingError" },
    } satisfies GetUserResult);
}

function hangs() {
  h.getUser = () => new Promise<never>(() => {});
}

const CHUNKED = "sb-ref-auth-token.0=chunk0; sb-ref-auth-token.1=chunk1";

function req(path: string, init: { cookie?: string; method?: string } = {}) {
  const headers: Record<string, string> = {};
  if (init.cookie) headers.cookie = init.cookie;
  return new NextRequest(`https://agile.test${path}`, { method: init.method ?? "GET", headers });
}

async function run(request: NextRequest) {
  const { middleware } = await import("@/middleware");
  return middleware(request);
}

const passes = (res: Response) => res.headers.get("x-middleware-next") === "1";

function setCookie(res: Response, name: string): string | undefined {
  return res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
}

/** The cookie header forwarded to the page render (only set with next({ request })). */
function forwardedCookies(res: Response): string {
  return res.headers.get("x-middleware-request-cookie") ?? "";
}

async function expectJsonError(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(res.headers.get("location")).toBeNull();
  expect(res.headers.get("content-type")).toContain("application/json");
  expect(res.headers.get("cache-control")).toBe("no-store");
  const body = await res.json();
  expect(body.error).toBe(code);
  expect(typeof body.message).toBe("string");
}

function expectRedirect(res: Response, pathAndQuery: string) {
  expect(res.status).toBe(307);
  const loc = new URL(res.headers.get("location")!);
  expect(loc.origin).toBe("https://agile.test");
  expect(loc.pathname + loc.search).toBe(pathAndQuery);
}

function expectExpired(res: Response, names: string[]) {
  for (const name of names) {
    const c = setCookie(res, name);
    expect(c, name).toBeDefined();
    expect(c).toMatch(new RegExp(`^${name.replace(/\./g, "\\.")}=;`));
    expect(c).toContain("Max-Age=0");
    expect(c).toContain("Path=/");
  }
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetModules();
  h.createServerClient.mockClear();
  h.writes = [];
  signedInAs(OWNER);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("AUTHORIZED_EMAILS", OWNER_EMAIL);
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  warn.mockRestore();
});

describe("no session cookie — answered without any I/O", () => {
  it("passes a public page without building a Supabase client", async () => {
    const res = await run(req("/planning-poker"));
    expect(passes(res)).toBe(true);
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(h.createServerClient).not.toHaveBeenCalled();
  });

  it("passes a public page even when the auth env is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    vi.stubEnv("AUTHORIZED_EMAILS", "");
    const res = await run(req("/"));
    expect(passes(res)).toBe(true);
    expect(h.createServerClient).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("answers the API with a JSON 401, never a redirect", async () => {
    await expectJsonError(await run(req("/api/kudos")), 401, "unauthenticated");
    await expectJsonError(
      await run(req("/api/sessions", { method: "POST" })),
      401,
      "unauthenticated"
    );
    expect(h.createServerClient).not.toHaveBeenCalled();
  });

  it("classifies /API/... as the API, not a public page", async () => {
    await expectJsonError(await run(req("/API/kudos")), 401, "unauthenticated");
    await expectJsonError(await run(req("/Api")), 401, "unauthenticated");
  });

  it("sends an owner page to sign-in with ?next=", async () => {
    expectRedirect(
      await run(req("/settings/access-tokens")),
      "/auth/sign-in?next=%2Fsettings%2Faccess-tokens"
    );
    expectRedirect(
      await run(req("/settings/squads/abc?tab=1")),
      "/auth/sign-in?next=%2Fsettings%2Fsquads%2Fabc%3Ftab%3D1"
    );
    expect(h.createServerClient).not.toHaveBeenCalled();
  });

  it("treats a PKCE code-verifier cookie alone as no session", async () => {
    const cookie = "sb-ref-auth-token-code-verifier=verifier";
    const page = await run(req("/retro", { cookie }));
    expect(passes(page)).toBe(true);
    await expectJsonError(await run(req("/api/kudos", { cookie })), 401, "unauthenticated");
    expect(h.createServerClient).not.toHaveBeenCalled();
  });

  it("ignores cookies that only look similar", async () => {
    const cookie = "other-auth-token=x; sb-ref-auth-token.x=y; sbx-ref-auth-token=z";
    expect(passes(await run(req("/", { cookie })))).toBe(true);
    expect(h.createServerClient).not.toHaveBeenCalled();
  });
});

describe("misconfigured deployment (session cookie present)", () => {
  for (const [label, stub] of [
    ["Supabase env missing", () => vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "")],
    ["anon key missing", () => vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")],
    ["AUTHORIZED_EMAILS empty", () => vi.stubEnv("AUTHORIZED_EMAILS", "")],
  ] as const) {
    it(`${label}: page passes untouched, API 503, owner page → config`, async () => {
      stub();
      const page = await run(req("/", { cookie: CHUNKED }));
      expect(passes(page)).toBe(true);
      // Nothing says the session is bad — the owner's cookies must survive.
      expect(page.headers.getSetCookie()).toEqual([]);

      await expectJsonError(
        await run(req("/api/kudos", { cookie: CHUNKED })),
        503,
        "auth_unavailable"
      );
      expectRedirect(
        await run(req("/settings/squads", { cookie: CHUNKED })),
        "/not-authorized?reason=config"
      );
      expect(h.createServerClient).not.toHaveBeenCalled();
    });
  }

  it("warns once per isolate, not per request", async () => {
    vi.stubEnv("AUTHORIZED_EMAILS", "");
    const { middleware } = await import("@/middleware");
    await middleware(req("/", { cookie: CHUNKED }));
    await middleware(req("/api/kudos", { cookie: CHUNKED }));
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("auth backend unreachable", () => {
  it("a hung getUser: page passes, API 503 with retry-after, owner page → sign-in", async () => {
    vi.useFakeTimers();
    hangs();
    const { middleware, AUTH_TIMEOUT_MS } = await import("@/middleware");

    const pending = [
      middleware(req("/planning-poker", { cookie: CHUNKED })),
      middleware(req("/api/kudos", { cookie: CHUNKED })),
      middleware(req("/settings/access-tokens", { cookie: CHUNKED })),
    ];
    await vi.advanceTimersByTimeAsync(AUTH_TIMEOUT_MS);
    const [page, api, ownerPage] = await Promise.all(pending);

    expect(passes(page)).toBe(true);
    // The session may still be valid: nothing is expired.
    expect(page.headers.getSetCookie()).toEqual([]);

    await expectJsonError(api, 503, "auth_unreachable");
    expect(api.headers.get("retry-after")).toBe("5");

    expectRedirect(ownerPage, "/auth/sign-in?next=%2Fsettings%2Faccess-tokens");
    // One log line per stuck request — the outage must be visible in logs.
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it("an AuthRetryableFetchError is unreachable too, not anonymous", async () => {
    h.getUser = () =>
      Promise.resolve({ data: { user: null }, error: { name: "AuthRetryableFetchError" } });
    const res = await run(req("/api/squads", { cookie: CHUNKED }));
    await expectJsonError(res, 503, "auth_unreachable");
  });
});

describe("stale session cookie (getUser finds no session)", () => {
  it("page passes and carries Supabase's own cookie removals", async () => {
    staleSession();
    h.writes = [
      { name: "sb-ref-auth-token.0", value: "" },
      { name: "sb-ref-auth-token.1", value: "" },
    ];
    const res = await run(req("/retro", { cookie: CHUNKED }));
    expect(passes(res)).toBe(true);
    expect(setCookie(res, "sb-ref-auth-token.0")).toMatch(/^sb-ref-auth-token\.0=;/);
    expect(setCookie(res, "sb-ref-auth-token.1")).toMatch(/^sb-ref-auth-token\.1=;/);
  });

  it("API gets a JSON 401; owner page goes to sign-in", async () => {
    staleSession();
    await expectJsonError(
      await run(req("/api/kudos", { cookie: CHUNKED })),
      401,
      "unauthenticated"
    );
    expectRedirect(
      await run(req("/settings/access-tokens", { cookie: CHUNKED })),
      "/auth/sign-in?next=%2Fsettings%2Faccess-tokens"
    );
  });
});

describe("a session that is not the owner's", () => {
  const cookie = `sb-ref-auth-token=legacy; ${CHUNKED}; theme=dark`;
  const SESSION_COOKIES = ["sb-ref-auth-token", "sb-ref-auth-token.0", "sb-ref-auth-token.1"];

  it("page passes as a visitor, every session cookie expired (Max-Age=0)", async () => {
    signedInAs(STRANGER);
    const res = await run(req("/planning-poker", { cookie }));
    expect(passes(res)).toBe(true);
    expectExpired(res, SESSION_COOKIES);
    // The page rendered on this very request already sees a visitor.
    expect(forwardedCookies(res)).toBe("theme=dark");
    expect(setCookie(res, "theme")).toBeUndefined();
  });

  it("the expiry wins over a rotated token Supabase queued under the same name", async () => {
    signedInAs(STRANGER);
    h.writes = [
      { name: "sb-ref-auth-token.0", value: "rotated0" },
      { name: "sb-ref-auth-token.2", value: "rotated2" },
    ];
    const res = await run(req("/", { cookie: CHUNKED }));
    expect(passes(res)).toBe(true);
    expectExpired(res, ["sb-ref-auth-token.0", "sb-ref-auth-token.1", "sb-ref-auth-token.2"]);
    expect(res.headers.getSetCookie().join("\n")).not.toContain("rotated");
  });

  it("API gets a JSON 403 not_authorized, plus the expiry", async () => {
    signedInAs(STRANGER);
    const res = await run(req("/api/kudos", { cookie }));
    await expectJsonError(res, 403, "not_authorized");
    expectExpired(res, SESSION_COOKIES);
  });

  it("owner page goes to /not-authorized?reason=denied, plus the expiry", async () => {
    signedInAs(STRANGER);
    const res = await run(req("/settings/access-tokens", { cookie }));
    expectRedirect(res, "/not-authorized?reason=denied");
    expectExpired(res, SESSION_COOKIES);
  });

  it("an allowlisted email that Google says is unverified is not the owner", async () => {
    signedInAs(googleUser(OWNER_EMAIL, false));
    const page = await run(req("/", { cookie }));
    expect(passes(page)).toBe(true);
    expectExpired(page, SESSION_COOKIES);
    await expectJsonError(await run(req("/api/kudos", { cookie })), 403, "email_unverified");
  });

  it("an allowlisted email from another provider is not the owner", async () => {
    signedInAs({ ...OWNER, app_metadata: { provider: "github" } });
    await expectJsonError(await run(req("/api/squads", { cookie })), 403, "wrong_provider");
  });

  it("never logs the rejected email", async () => {
    signedInAs(STRANGER);
    await run(req("/api/kudos", { cookie }));
    expect(JSON.stringify(warn.mock.calls)).not.toContain("eve@example.com");
  });
});

describe("the owner", () => {
  it("passes a page and carries BOTH rotated chunks (no dropped cookie)", async () => {
    h.writes = [
      { name: "sb-ref-auth-token.0", value: "new0" },
      { name: "sb-ref-auth-token.1", value: "new1" },
    ];
    const res = await run(req("/planning-poker", { cookie: CHUNKED }));
    expect(passes(res)).toBe(true);
    expect(setCookie(res, "sb-ref-auth-token.0")).toMatch(/^sb-ref-auth-token\.0=new0;/);
    expect(setCookie(res, "sb-ref-auth-token.1")).toMatch(/^sb-ref-auth-token\.1=new1;/);
    expect(res.headers.getSetCookie().join("\n")).not.toContain("Max-Age=0");
    // The render sees the refreshed session, not the one the browser sent.
    expect(forwardedCookies(res)).toContain("sb-ref-auth-token.0=new0");
  });

  it("passes the API and owner pages", async () => {
    expect(passes(await run(req("/api/squads", { cookie: CHUNKED })))).toBe(true);
    expect(passes(await run(req("/settings/access-tokens", { cookie: CHUNKED })))).toBe(true);
    expect(h.createServerClient).toHaveBeenCalledTimes(2);
  });

  it("is matched against the allowlist case-insensitively", async () => {
    signedInAs(googleUser("Owner@Example.COM"));
    expect(passes(await run(req("/api/kudos", { cookie: CHUNKED })))).toBe(true);
  });
});

describe("bypass paths", () => {
  const BYPASS = [
    "/api/health",
    "/api/mcp",
    "/api/mcp/x",
    "/api/agent/stream",
    "/api/guest/redeem",
    "/api/comics/hit",
    "/api/comics/licence",
    "/api/comics/guestbook",
    "/api/mascot/weather",
    "/guest",
    "/guest/join",
    "/auth/callback",
    "/auth/sign-in",
    "/not-authorized",
  ];

  for (const path of BYPASS) {
    it(`${path} never builds a client, with or without a session`, async () => {
      signedInAs(STRANGER);
      for (const cookie of [undefined, CHUNKED]) {
        const res = await run(req(path, { cookie }));
        expect(passes(res)).toBe(true);
        // Not even a non-owner session is touched here.
        expect(res.headers.getSetCookie()).toEqual([]);
      }
      expect(h.createServerClient).not.toHaveBeenCalled();
    });
  }

  // The comics' public forms are exact matches: the owner's routes beside them stay checked.
  for (const path of [
    "/api/comics/guestbook-notes",
    "/api/comics/guestbook-notes/x",
    "/api/comics/guestbook/x",
    "/api/comics/licence-requests",
    "/api/comics/hit/x",
    "/api/mascot/weather/x",
    "/api/mascot",
  ]) {
    it(`${path} is checked like any other API route`, async () => {
      signedInAs(STRANGER);
      await expectJsonError(await run(req(path, { cookie: CHUNKED })), 403, "not_authorized");
      expect(h.createServerClient).toHaveBeenCalled();
    });
  }

  it("strips a leftover guest cookie when a chunked owner session is present", async () => {
    const res = await run(
      req("/guest/x", { cookie: `${CHUNKED}; agile-toolkit:guest=g1; theme=dark` })
    );
    expect(passes(res)).toBe(true);
    const expired = setCookie(res, "agile-toolkit:guest");
    expect(expired).toContain("Max-Age=0");
    // Stripped from the forwarded request too, so this render isn't a guest.
    expect(forwardedCookies(res)).not.toContain("agile-toolkit:guest");
    expect(forwardedCookies(res)).toContain("sb-ref-auth-token.0=chunk0");
    expect(h.createServerClient).not.toHaveBeenCalled();
  });

  it("keeps the guest cookie for a real guest (no Supabase session)", async () => {
    const res = await run(req("/api/guest/kudos", { cookie: "agile-toolkit:guest=g1" }));
    expect(passes(res)).toBe(true);
    expect(setCookie(res, "agile-toolkit:guest")).toBeUndefined();
  });
});

describe("/comics addresses", () => {
  const rewrite = (res: Response) => res.headers.get("x-middleware-rewrite");
  const target = (res: Response) => {
    const url = new URL(rewrite(res)!);
    return url.pathname + url.search;
  };

  it("rewrites a valid number with no I/O for a visitor", async () => {
    const res = await run(req("/comics?ep=07"));
    expect(target(res)).toBe("/comics/ep/7?ep=07");
    expect(h.createServerClient).not.toHaveBeenCalled();
  });

  it("rewrites for the owner too, and keeps their rotated cookies", async () => {
    h.writes = [{ name: "sb-ref-auth-token.0", value: "rotated" }];
    const res = await run(req("/comics?ep=07&b=03", { cookie: CHUNKED }));
    expect(target(res)).toBe("/comics/poster/7?ep=07&b=03");
    expect(h.createServerClient).toHaveBeenCalled();
    expect(setCookie(res, "sb-ref-auth-token.0")).toContain("rotated");
  });

  it("still rewrites when the auth config is missing or the session isn't the owner's", async () => {
    signedInAs(STRANGER);
    expect(target(await run(req("/comics?ep=27", { cookie: CHUNKED })))).toBe(
      "/comics/ep/27?ep=27"
    );
    vi.stubEnv("AUTHORIZED_EMAILS", "");
    expect(target(await run(req("/comics?ep=27", { cookie: CHUNKED })))).toBe(
      "/comics/ep/27?ep=27"
    );
  });

  it("leaves a plain or invalid address as the normal page", async () => {
    for (const path of ["/comics", "/comics?ep=abc", "/comics?ep=0", "/comics?b=01"]) {
      const res = await run(req(path));
      expect(rewrite(res), path).toBeNull();
      expect(passes(res), path).toBe(true);
    }
  });

  it("only touches /comics itself", async () => {
    for (const path of ["/retro?ep=1", "/comics/license?ep=1", "/comicsx?ep=1"]) {
      expect(rewrite(await run(req(path))), path).toBeNull();
    }
  });

  it("sends a direct visit to an internal page back to the public address", async () => {
    expectRedirect(await run(req("/comics/ep/27")), "/comics?ep=27");
    expectRedirect(await run(req("/comics/poster/5")), "/comics?ep=5");
    expectRedirect(await run(req("/comics/ep/nonsense")), "/comics");
    expect(h.createServerClient).not.toHaveBeenCalled();
  });
});
