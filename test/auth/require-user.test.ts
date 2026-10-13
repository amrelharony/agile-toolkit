import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the provider/email-verified guards in `requireAuthorizedUser`.
 *
 * The function pulls auth state from Supabase via `@supabase/ssr`'s
 * `createServerClient`. We mock that module so each test can hand-craft
 * the `getUser()` payload — provider undefined vs "google", identities
 * empty vs populated, email_confirmed_at set vs null.
 *
 * Why these tests exist: a deep audit flagged two paths through the
 * provider/identity checks that previously fell through silently:
 *
 *   1. provider === undefined bypassed the Google-only restriction
 *   2. identities.length === 0 skipped the email_verified check entirely
 *
 * Both were tightened — these assertions encode the fail-closed contract
 * so the next refactor can't quietly undo it.
 */

const supabaseCreateServerClient = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: (...args: unknown[]) => supabaseCreateServerClient(...args),
}));

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: () => undefined,
    set: () => undefined,
  }),
}));

function makeSupabase(user: Record<string, unknown> | null, error: unknown = null) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error }),
    },
  };
}

async function callRequireAuthorizedUser() {
  const mod = await import("@/lib/auth/require-user");
  try {
    const result = await mod.requireAuthorizedUser();
    return { ok: true as const, result };
  } catch (e) {
    if (e instanceof Response) {
      return { ok: false as const, status: e.status, body: await e.json(), headers: e.headers };
    }
    throw e;
  }
}

describe("requireAuthorizedUser — provider + email-verified gates", () => {
  beforeEach(() => {
    vi.resetModules();
    supabaseCreateServerClient.mockReset();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("AUTHORIZED_EMAILS", "alice@example.com");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects when app_metadata.provider is undefined (fail-closed)", async () => {
    supabaseCreateServerClient.mockReturnValue(
      makeSupabase({
        id: "u1",
        email: "alice@example.com",
        email_confirmed_at: "2024-01-01T00:00:00Z",
        app_metadata: {}, // provider missing
        identities: [
          {
            provider: "google",
            identity_data: {
              email: "alice@example.com",
              email_verified: true,
            },
          },
        ],
      })
    );
    const r = await callRequireAuthorizedUser();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(403);
      expect(r.body.error).toBe("wrong_provider");
    }
  });

  it("rejects when app_metadata.provider is non-Google", async () => {
    supabaseCreateServerClient.mockReturnValue(
      makeSupabase({
        id: "u1",
        email: "alice@example.com",
        email_confirmed_at: "2024-01-01T00:00:00Z",
        app_metadata: { provider: "github" },
        identities: [
          {
            provider: "github",
            identity_data: { email: "alice@example.com", email_verified: true },
          },
        ],
      })
    );
    const r = await callRequireAuthorizedUser();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(403);
      expect(r.body.error).toBe("wrong_provider");
    }
  });

  it("rejects when identities is empty AND email_confirmed_at is null", async () => {
    supabaseCreateServerClient.mockReturnValue(
      makeSupabase({
        id: "u1",
        email: "alice@example.com",
        email_confirmed_at: null,
        app_metadata: { provider: "google" },
        identities: [],
      })
    );
    const r = await callRequireAuthorizedUser();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(403);
      expect(r.body.error).toBe("email_unverified");
    }
  });

  it("allows when identities is empty BUT email_confirmed_at is set", async () => {
    supabaseCreateServerClient.mockReturnValue(
      makeSupabase({
        id: "u1",
        email: "alice@example.com",
        email_confirmed_at: "2024-01-01T00:00:00Z",
        app_metadata: { provider: "google" },
        identities: [],
      })
    );
    const r = await callRequireAuthorizedUser();
    expect(r.ok).toBe(true);
  });

  it("rejects when matched identity has email_verified === false", async () => {
    supabaseCreateServerClient.mockReturnValue(
      makeSupabase({
        id: "u1",
        email: "alice@example.com",
        email_confirmed_at: "2024-01-01T00:00:00Z",
        app_metadata: { provider: "google" },
        identities: [
          {
            provider: "google",
            identity_data: { email: "alice@example.com", email_verified: false },
          },
        ],
      })
    );
    const r = await callRequireAuthorizedUser();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(403);
      expect(r.body.error).toBe("email_unverified");
    }
  });

  it("rejects when identity matching this email is missing from identities", async () => {
    // Identities is populated, but none of them are for this user's email.
    // This could happen if Supabase ever returns a partial identities list.
    // Fail-closed: an unverified-by-default state must not pass.
    supabaseCreateServerClient.mockReturnValue(
      makeSupabase({
        id: "u1",
        email: "alice@example.com",
        email_confirmed_at: "2024-01-01T00:00:00Z",
        app_metadata: { provider: "google" },
        identities: [
          {
            provider: "google",
            identity_data: { email: "someoneelse@example.com", email_verified: true },
          },
        ],
      })
    );
    const r = await callRequireAuthorizedUser();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(403);
      expect(r.body.error).toBe("email_unverified");
    }
  });

  it("allows a properly-verified Google identity", async () => {
    supabaseCreateServerClient.mockReturnValue(
      makeSupabase({
        id: "u1",
        email: "alice@example.com",
        email_confirmed_at: "2024-01-01T00:00:00Z",
        app_metadata: { provider: "google" },
        identities: [
          {
            provider: "google",
            identity_data: { email: "alice@example.com", email_verified: true },
          },
        ],
      })
    );
    const r = await callRequireAuthorizedUser();
    expect(r.ok).toBe(true);
  });

  it("still rejects when email is not on the allowlist", async () => {
    supabaseCreateServerClient.mockReturnValue(
      makeSupabase({
        id: "u1",
        email: "eve@example.com",
        email_confirmed_at: "2024-01-01T00:00:00Z",
        app_metadata: { provider: "google" },
        identities: [
          {
            provider: "google",
            identity_data: { email: "eve@example.com", email_verified: true },
          },
        ],
      })
    );
    const r = await callRequireAuthorizedUser();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(403);
      expect(r.body.error).toBe("not_authorized");
    }
  });
});

describe("requireAuthorizedUser — error responses", () => {
  const owner = {
    id: "u1",
    email: "alice@example.com",
    email_confirmed_at: "2024-01-01T00:00:00Z",
    app_metadata: { provider: "google" },
    identities: [
      { provider: "google", identity_data: { email: "alice@example.com", email_verified: true } },
    ],
  };

  beforeEach(() => {
    vi.resetModules();
    supabaseCreateServerClient.mockReset();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("AUTHORIZED_EMAILS", "alice@example.com");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("answers JSON that no cache may store, with the shared { error, message } shape", async () => {
    supabaseCreateServerClient.mockReturnValue(
      makeSupabase({ ...owner, email: "eve@example.com" })
    );
    const r = await callRequireAuthorizedUser();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(403);
      expect(r.headers.get("content-type")).toContain("application/json");
      expect(r.headers.get("cache-control")).toBe("no-store");
      expect(r.body).toEqual({
        error: "not_authorized",
        message: "This account is not on the allowlist.",
      });
    }
  });

  it("401s when there is no session", async () => {
    supabaseCreateServerClient.mockReturnValue(
      makeSupabase(null, { name: "AuthSessionMissingError", message: "Auth session missing!" })
    );
    const r = await callRequireAuthorizedUser();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(401);
      expect(r.body.error).toBe("unauthenticated");
      expect(r.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("503s (retryable) rather than 401 when the auth backend is unreachable", async () => {
    // A 401 would make the client drop the owner's session over an outage.
    supabaseCreateServerClient.mockReturnValue(
      makeSupabase(null, { name: "AuthRetryableFetchError", message: "fetch failed" })
    );
    const r = await callRequireAuthorizedUser();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(503);
      expect(r.body.error).toBe("auth_unreachable");
      expect(r.headers.get("retry-after")).toBe("5");
    }
  });

  it("503s when Supabase is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const r = await callRequireAuthorizedUser();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(503);
      expect(r.body.error).toBe("auth_unavailable");
    }
    expect(supabaseCreateServerClient).not.toHaveBeenCalled();
  });

  it("503s instead of 403 when the allowlist is empty — a config fault, not a verdict", async () => {
    vi.stubEnv("AUTHORIZED_EMAILS", "");
    supabaseCreateServerClient.mockReturnValue(makeSupabase(owner));
    const r = await callRequireAuthorizedUser();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(503);
      expect(r.body.error).toBe("auth_unavailable");
    }
  });
});
