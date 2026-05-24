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
      return { ok: false as const, status: e.status, body: await e.json() };
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
