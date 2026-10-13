import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Smoke tests for the shared email allowlist.
 *
 * `isEmailAuthorized` reads `process.env.AUTHORIZED_EMAILS` and caches
 * the parsed Set across calls. The module re-checks the raw env value
 * each call, so stubbing AUTHORIZED_EMAILS via vi.stubEnv is enough to
 * invalidate the cache between assertions — no module reload needed.
 */

describe("isEmailAuthorized", () => {
  beforeEach(() => {
    // Start every test from a clean env so prior tests cannot leak.
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns false when AUTHORIZED_EMAILS is unset (fail-closed)", async () => {
    vi.stubEnv("AUTHORIZED_EMAILS", "");
    const { isEmailAuthorized } = await import("@/lib/auth/authorize");
    expect(isEmailAuthorized("anyone@example.com")).toBe(false);
  });

  it("returns false for null / undefined / empty input", async () => {
    vi.stubEnv("AUTHORIZED_EMAILS", "user@example.com");
    const { isEmailAuthorized } = await import("@/lib/auth/authorize");
    expect(isEmailAuthorized(null)).toBe(false);
    expect(isEmailAuthorized(undefined)).toBe(false);
    expect(isEmailAuthorized("")).toBe(false);
  });

  it("matches case-insensitively", async () => {
    vi.stubEnv("AUTHORIZED_EMAILS", "User@Example.com");
    const { isEmailAuthorized } = await import("@/lib/auth/authorize");
    expect(isEmailAuthorized("user@example.com")).toBe(true);
    expect(isEmailAuthorized("USER@EXAMPLE.COM")).toBe(true);
    expect(isEmailAuthorized("User@Example.com")).toBe(true);
  });

  it("trims whitespace from the input", async () => {
    vi.stubEnv("AUTHORIZED_EMAILS", "alice@example.com,bob@example.com");
    const { isEmailAuthorized } = await import("@/lib/auth/authorize");
    expect(isEmailAuthorized("  alice@example.com  ")).toBe(true);
    expect(isEmailAuthorized("\tbob@example.com\n")).toBe(true);
  });

  it("rejects unknown emails when env is set", async () => {
    vi.stubEnv("AUTHORIZED_EMAILS", "alice@example.com,bob@example.com");
    const { isEmailAuthorized } = await import("@/lib/auth/authorize");
    expect(isEmailAuthorized("eve@example.com")).toBe(false);
    expect(isEmailAuthorized("alice@evil.com")).toBe(false);
  });

  it("exposes authorizedEmailCount for diagnostics", async () => {
    vi.stubEnv("AUTHORIZED_EMAILS", "a@x.com,b@x.com, c@x.com ,,");
    const { authorizedEmailCount } = await import("@/lib/auth/authorize");
    expect(authorizedEmailCount()).toBe(3);
  });
});

describe("isOwnerUser", () => {
  const owner = {
    email: "alice@example.com",
    email_confirmed_at: "2024-01-01T00:00:00Z",
    app_metadata: { provider: "google" },
    identities: [{ identity_data: { email: "alice@example.com", email_verified: true } }],
  };

  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("AUTHORIZED_EMAILS", "alice@example.com");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts an allowlisted, verified Google identity", async () => {
    const { isOwnerUser } = await import("@/lib/auth/authorize");
    expect(isOwnerUser(owner)).toEqual({ ok: true });
  });

  it("rejects a missing user", async () => {
    const { isOwnerUser } = await import("@/lib/auth/authorize");
    expect(isOwnerUser(null)).toEqual({ ok: false, code: "not_authorized" });
    expect(isOwnerUser(undefined)).toEqual({ ok: false, code: "not_authorized" });
    expect(isOwnerUser({})).toEqual({ ok: false, code: "not_authorized" });
  });

  it("rejects an email that is not on the allowlist", async () => {
    const { isOwnerUser } = await import("@/lib/auth/authorize");
    expect(
      isOwnerUser({
        ...owner,
        email: "eve@example.com",
        identities: [{ identity_data: { email: "eve@example.com", email_verified: true } }],
      })
    ).toEqual({ ok: false, code: "not_authorized" });
  });

  it("rejects everyone when the allowlist is empty (fail-closed)", async () => {
    vi.stubEnv("AUTHORIZED_EMAILS", "");
    const { isOwnerUser } = await import("@/lib/auth/authorize");
    expect(isOwnerUser(owner)).toEqual({ ok: false, code: "not_authorized" });
  });

  it("rejects a missing or non-Google provider", async () => {
    const { isOwnerUser } = await import("@/lib/auth/authorize");
    const wrong = { ok: false, code: "wrong_provider" };
    expect(isOwnerUser({ ...owner, app_metadata: { provider: "github" } })).toEqual(wrong);
    expect(isOwnerUser({ ...owner, app_metadata: {} })).toEqual(wrong);
    expect(isOwnerUser({ ...owner, app_metadata: null })).toEqual(wrong);
    expect(isOwnerUser({ ...owner, app_metadata: undefined })).toEqual(wrong);
  });

  it("rejects an identity Google reports as unverified", async () => {
    const { isOwnerUser } = await import("@/lib/auth/authorize");
    expect(
      isOwnerUser({
        ...owner,
        identities: [{ identity_data: { email: "alice@example.com", email_verified: false } }],
      })
    ).toEqual({ ok: false, code: "email_unverified" });
  });

  it("rejects when no identity matches the user's email", async () => {
    const { isOwnerUser } = await import("@/lib/auth/authorize");
    expect(
      isOwnerUser({
        ...owner,
        identities: [{ identity_data: { email: "other@example.com", email_verified: true } }],
      })
    ).toEqual({ ok: false, code: "email_unverified" });
    expect(isOwnerUser({ ...owner, identities: [{ identity_data: null }] })).toEqual({
      ok: false,
      code: "email_unverified",
    });
  });

  it("matches the identity email case-insensitively", async () => {
    const { isOwnerUser } = await import("@/lib/auth/authorize");
    expect(
      isOwnerUser({
        ...owner,
        email: "Alice@Example.com",
        identities: [{ identity_data: { email: "ALICE@example.com", email_verified: true } }],
      })
    ).toEqual({ ok: true });
  });

  it("falls back to email_confirmed_at only when identities is empty", async () => {
    const { isOwnerUser } = await import("@/lib/auth/authorize");
    expect(isOwnerUser({ ...owner, identities: [] })).toEqual({ ok: true });
    expect(isOwnerUser({ ...owner, identities: null })).toEqual({ ok: true });
    expect(isOwnerUser({ ...owner, identities: [], email_confirmed_at: null })).toEqual({
      ok: false,
      code: "email_unverified",
    });
    expect(isOwnerUser({ ...owner, identities: undefined, email_confirmed_at: "" })).toEqual({
      ok: false,
      code: "email_unverified",
    });
  });

  it("has a 403 message for every denial code", async () => {
    const { OWNER_DENIAL_MESSAGES } = await import("@/lib/auth/authorize");
    expect(Object.keys(OWNER_DENIAL_MESSAGES).sort()).toEqual([
      "email_unverified",
      "not_authorized",
      "wrong_provider",
    ]);
  });
});
