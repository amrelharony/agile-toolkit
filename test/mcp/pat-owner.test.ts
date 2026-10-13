// @vitest-environment node
/**
 * verifyBearer only lets the workspace OWNER's tokens through.
 *
 * RLS lets any signed-in Supabase user insert their own access_tokens row,
 * and a Google account can obtain a session without passing our callback's
 * owner check. So a hash match alone is not enough: after resolve_pat,
 * verifyBearer looks the token's user up with the service-role client and
 * requires isOwnerUser — caching the verdict per user for five minutes, and
 * failing closed (uncached) when the lookup itself fails.
 *
 * `@supabase/supabase-js` is mocked with just the calls verifyBearer makes:
 * the prefix probe, the resolve_pat RPC and auth.admin.getUserById.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetPatOwnerCache,
  generateRawToken,
  generateSalt,
  hashTokenWithSalt,
  verifyBearer,
} from "@/lib/mcp/pat";

const h = vi.hoisted(() => ({
  rows: [] as Array<{ id: string; user_id: string; salt: string | null; token_hash: string }>,
  resolved: [] as Array<Record<string, unknown>>,
  getUserById: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        is: async () => ({ data: h.rows, error: null }),
      };
      return q;
    },
    rpc: async () => ({ data: h.resolved, error: null }),
    auth: { admin: { getUserById: h.getUserById } },
  }),
}));

function googleUser(email: string, emailVerified = true) {
  return {
    id: "u-1",
    email,
    email_confirmed_at: "2026-01-01T00:00:00Z",
    app_metadata: { provider: "google" },
    identities: [{ provider: "google", identity_data: { email, email_verified: emailVerified } }],
  };
}

const OWNER = googleUser("owner@example.com");

let bearer: string;

function lookupReturns(user: Record<string, unknown>) {
  h.getUserById.mockResolvedValue({ data: { user }, error: null });
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role");
  vi.stubEnv("AUTHORIZED_EMAILS", "owner@example.com");
  __resetPatOwnerCache();
  h.getUserById.mockReset();
  lookupReturns(OWNER);

  bearer = generateRawToken();
  const salt = generateSalt();
  h.rows = [{ id: "tok-1", user_id: "u-1", salt, token_hash: hashTokenWithSalt(bearer, salt) }];
  h.resolved = [
    { token_id: "tok-1", user_id: "u-1", squad_profile_ids: ["sp-1"], access_level: "read" },
  ];
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("verifyBearer owner check", () => {
  it("resolves the owner's token", async () => {
    await expect(verifyBearer(bearer)).resolves.toEqual({
      userId: "u-1",
      tokenId: "tok-1",
      squadProfileIds: ["sp-1"],
      accessLevel: "read",
    });
    expect(h.getUserById).toHaveBeenCalledWith("u-1");
  });

  it("rejects a valid token minted by a non-owner account", async () => {
    lookupReturns(googleUser("eve@example.com"));
    await expect(verifyBearer(bearer)).resolves.toBeNull();
  });

  it("rejects a token whose user has an unverified email", async () => {
    lookupReturns(googleUser("owner@example.com", false));
    await expect(verifyBearer(bearer)).resolves.toBeNull();
  });

  it("rejects a token whose user signed in with another provider", async () => {
    lookupReturns({ ...OWNER, app_metadata: { provider: "github" } });
    await expect(verifyBearer(bearer)).resolves.toBeNull();
  });

  it("fails closed when the lookup errors — and does not cache that", async () => {
    h.getUserById.mockResolvedValueOnce({ data: { user: null }, error: { message: "boom" } });
    await expect(verifyBearer(bearer)).resolves.toBeNull();

    // The next call retries the lookup instead of locking the owner out.
    await expect(verifyBearer(bearer)).resolves.not.toBeNull();
    expect(h.getUserById).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the lookup throws", async () => {
    h.getUserById.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(verifyBearer(bearer)).resolves.toBeNull();
  });

  it("caches the verdict per user for five minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T00:00:00Z"));

    await verifyBearer(bearer);
    await verifyBearer(bearer);
    expect(h.getUserById).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-10-01T00:04:59Z"));
    await verifyBearer(bearer);
    expect(h.getUserById).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-10-01T00:05:01Z"));
    await verifyBearer(bearer);
    expect(h.getUserById).toHaveBeenCalledTimes(2);
  });

  it("caches a negative verdict too", async () => {
    lookupReturns(googleUser("eve@example.com"));
    await expect(verifyBearer(bearer)).resolves.toBeNull();
    lookupReturns(OWNER);
    await expect(verifyBearer(bearer)).resolves.toBeNull();
    expect(h.getUserById).toHaveBeenCalledTimes(1);
  });

  it("never looks a user up for a token that does not verify", async () => {
    h.rows = [{ ...h.rows[0], token_hash: "not-the-hash" }];
    await expect(verifyBearer(bearer)).resolves.toBeNull();

    h.rows = [];
    await expect(verifyBearer(bearer)).resolves.toBeNull();
    expect(h.getUserById).not.toHaveBeenCalled();
  });

  it("never looks a user up when resolve_pat finds no live token", async () => {
    h.resolved = [];
    await expect(verifyBearer(bearer)).resolves.toBeNull();
    expect(h.getUserById).not.toHaveBeenCalled();
  });
});
