// @vitest-environment node
/**
 * The OAuth callback's exits. Every failure has to land somewhere that
 * explains it — never on `next`, which is usually a public page that would
 * silently ignore an `auth_error` — and only the owner keeps a session.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  client: null as null | {
    auth: {
      exchangeCodeForSession: ReturnType<typeof vi.fn>;
      signOut: ReturnType<typeof vi.fn>;
    };
  },
  getAuthServerClient: vi.fn(),
}));

vi.mock("@/lib/auth/supabase-server", () => ({
  getAuthServerClient: () => {
    h.getAuthServerClient();
    return h.client;
  },
}));

import { GET } from "@/app/auth/callback/route";

const OWNER = {
  id: "owner-1",
  email: "owner@example.com",
  email_confirmed_at: "2026-01-01T00:00:00Z",
  app_metadata: { provider: "google" },
  identities: [
    { provider: "google", identity_data: { email: "owner@example.com", email_verified: true } },
  ],
};

function exchangeReturns(result: { user?: Record<string, unknown>; error?: string }) {
  h.client!.auth.exchangeCodeForSession.mockResolvedValue(
    result.error
      ? { data: { session: null }, error: { message: result.error } }
      : { data: { session: { user: result.user } }, error: null }
  );
}

function callback(query: string, headers: Record<string, string> = {}) {
  return GET(new NextRequest(`https://agile.test/auth/callback?${query}`, { headers }));
}

function location(res: Response): string {
  const loc = new URL(res.headers.get("location")!);
  expect(loc.origin).toBe("https://agile.test");
  return loc.pathname + loc.search;
}

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubEnv("AUTHORIZED_EMAILS", "owner@example.com");
  h.getAuthServerClient.mockClear();
  h.client = {
    auth: {
      exchangeCodeForSession: vi.fn(),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  };
  exchangeReturns({ user: OWNER });
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  warn.mockRestore();
  error.mockRestore();
});

describe("provider errors on the redirect", () => {
  it("signup_disabled means not the owner → /not-authorized?reason=denied", async () => {
    const res = await callback(
      "error=access_denied&error_code=signup_disabled&error_description=Signups+not+allowed+for+this+instance&next=%2Fretro"
    );
    expect(res.status).toBe(307);
    expect(location(res)).toBe("/not-authorized?reason=denied");
    expect(h.getAuthServerClient).not.toHaveBeenCalled();
  });

  it("any other provider error (e.g. Cancel) → sign-in with oauth_failed and next", async () => {
    const res = await callback(
      "error=access_denied&error_description=User+cancelled&next=%2Fretro"
    );
    expect(location(res)).toBe("/auth/sign-in?auth_error=oauth_failed&next=%2Fretro");
    expect(h.client!.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("an error_code without error is still a provider error", async () => {
    const res = await callback("error_code=bad_oauth_state&code=abc");
    expect(location(res)).toBe("/auth/sign-in?auth_error=oauth_failed&next=%2F");
    expect(h.client!.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("never reflects the upstream description into the URL", async () => {
    const res = await callback(
      "error=server_error&error_description=%3Cscript%3Eleak%3C%2Fscript%3E"
    );
    expect(res.headers.get("location")).not.toContain("leak");
  });
});

describe("failures before or during the exchange", () => {
  it("no code → sign-in with missing_code and the sanitised next", async () => {
    const res = await callback("next=%2Fretro%3Fboard%3D1%23top");
    expect(location(res)).toBe(
      "/auth/sign-in?auth_error=missing_code&next=%2Fretro%3Fboard%3D1%23top"
    );
  });

  it("an unsafe next is replaced with /", async () => {
    const res = await callback("next=%2F%2Fevil.com");
    expect(location(res)).toBe("/auth/sign-in?auth_error=missing_code&next=%2F");
  });

  it.each([
    ["empty", ""],
    ["blank entries only", " , ,"],
  ])(
    "an %s owner allowlist → /not-authorized?reason=config, with no exchange or sign-out",
    async (_label, value) => {
      vi.stubEnv("AUTHORIZED_EMAILS", value);
      const res = await callback("code=abc&next=%2Fretro");
      expect(location(res)).toBe("/not-authorized?reason=config");
      // No session is created, so nothing (least of all the owner's sessions
      // on every device) has to be revoked.
      expect(h.client!.auth.exchangeCodeForSession).not.toHaveBeenCalled();
      expect(h.client!.auth.signOut).not.toHaveBeenCalled();
    }
  );

  it("auth not configured → sign-in with auth_disabled", async () => {
    h.client = null;
    const res = await callback("code=abc&next=%2Fretro");
    expect(location(res)).toBe("/auth/sign-in?auth_error=auth_disabled&next=%2Fretro");
  });

  it.each([
    ["Code has expired", "expired"],
    ["invalid flow state, no valid flow state found", "invalid"],
    ["fetch failed", "network"],
    ["Request rate limit reached", "rate_limited"],
    ["something else", "oauth_failed"],
  ])("exchange error %j → sign-in with %s, never next", async (message, slug) => {
    exchangeReturns({ error: message });
    const res = await callback("code=abc&next=%2Fretro");
    expect(location(res)).toBe(`/auth/sign-in?auth_error=${slug}&next=%2Fretro`);
  });
});

describe("after a successful exchange", () => {
  it("the owner goes to next", async () => {
    const res = await callback("code=abc&next=%2Fretro%3Fboard%3D1");
    expect(location(res)).toBe("/retro?board=1");
    expect(h.client!.auth.signOut).not.toHaveBeenCalled();
  });

  it("a non-allowlisted account is signed out and sent to /not-authorized?reason=denied", async () => {
    exchangeReturns({
      user: {
        ...OWNER,
        email: "eve@example.com",
        identities: [{ identity_data: { email: "eve@example.com", email_verified: true } }],
      },
    });
    const res = await callback("code=abc&next=%2Fretro");
    expect(location(res)).toBe("/not-authorized?reason=denied");
    expect(h.client!.auth.signOut).toHaveBeenCalledTimes(1);
    // Privacy: the rejected email is not echoed anywhere.
    expect(res.headers.get("location")).not.toContain("eve");
  });

  it("an allowlisted email Google reports as unverified is not the owner", async () => {
    exchangeReturns({
      user: {
        ...OWNER,
        identities: [{ identity_data: { email: "owner@example.com", email_verified: false } }],
      },
    });
    const res = await callback("code=abc");
    expect(location(res)).toBe("/not-authorized?reason=denied");
    expect(h.client!.auth.signOut).toHaveBeenCalledTimes(1);
  });

  it("an allowlisted email from another provider is not the owner", async () => {
    exchangeReturns({ user: { ...OWNER, app_metadata: { provider: "github" } } });
    const res = await callback("code=abc");
    expect(location(res)).toBe("/not-authorized?reason=denied");
  });

  it("a failing signOut still ends on the denied page", async () => {
    exchangeReturns({ user: { ...OWNER, email: "eve@example.com" } });
    h.client!.auth.signOut.mockRejectedValue(new Error("network"));
    const res = await callback("code=abc");
    expect(location(res)).toBe("/not-authorized?reason=denied");
  });
});

it("refuses a cross-site, non-document fetch (BUG-A8)", async () => {
  const res = await callback("code=abc", {
    "sec-fetch-site": "cross-site",
    "sec-fetch-dest": "image",
  });
  expect(res.status).toBe(403);
  expect(h.client!.auth.exchangeCodeForSession).not.toHaveBeenCalled();
});
