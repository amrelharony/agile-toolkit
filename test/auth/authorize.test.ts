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
