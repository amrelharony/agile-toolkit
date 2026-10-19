// @vitest-environment node
/**
 * POST /api/realtime/token — the owner's room token for private Realtime
 * channels.
 *
 * requireAuthorizedUser is mocked (its checks live in require-user.test.ts).
 * What matters here: the verified owner gets an uncacheable owner token
 * (`room_owner`, no `rooms`, `sub` = their id), every refusal reaches the
 * client unchanged, and a server without the JWT secret says so with a 503
 * rather than handing out something Supabase would reject.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonError } from "@/lib/auth/json-error";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({ outcome: null as unknown }));
vi.mock("@/lib/auth/require-user", () => ({
  requireAuthorizedUser: async () => {
    if (h.outcome) throw h.outcome;
    return { user: { id: "owner-1" }, supabase: {} };
  },
}));

import { POST, dynamic } from "@/app/api/realtime/token/route";
import { verifyRoomToken } from "@/lib/realtime/room-token";

beforeEach(() => {
  h.outcome = null;
  vi.stubEnv("SUPABASE_JWT_SECRET", "test-legacy-jwt-secret");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/realtime/token", () => {
  it("is never prerendered", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("answers 200 with an owner token, not cacheable", async () => {
    const before = Date.now();
    const res = await POST();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { token: string; expiresAt: number };
    expect(Object.keys(body).sort()).toEqual(["expiresAt", "token"]);

    const claims = verifyRoomToken(body.token);
    expect(claims).not.toBeNull();
    expect(claims).toMatchObject({ role: "anon", sub: "owner-1", room_owner: true });
    expect(claims).not.toHaveProperty("rooms");
    expect(body.expiresAt).toBe(claims!.exp * 1000);
    // About an hour from now.
    expect(body.expiresAt - before).toBeGreaterThan(3590_000);
    expect(body.expiresAt - before).toBeLessThanOrEqual(3601_000);
  });

  it.each([
    [401, "unauthenticated"],
    [403, "not_authorized"],
    [403, "wrong_provider"],
    [403, "email_unverified"],
    [503, "auth_unavailable"],
    [503, "auth_unreachable"],
  ])("passes a thrown %i %s through unchanged", async (status, code) => {
    const thrown = jsonError(status, code, "msg");
    h.outcome = thrown;
    const res = await POST();
    expect(res).toBe(thrown);
    expect(res.status).toBe(status);
    expect((await res.json()).error).toBe(code);
  });

  it("rethrows anything that is not a Response", async () => {
    h.outcome = new Error("boom");
    await expect(POST()).rejects.toThrow("boom");
  });

  it.each([[""], ["  "]])(
    "answers 503 private_rooms_unavailable when the secret is %j",
    async (v) => {
      vi.stubEnv("SUPABASE_JWT_SECRET", v);
      const res = await POST();
      expect(res.status).toBe(503);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const body = await res.json();
      expect(body.error).toBe("private_rooms_unavailable");
      expect(typeof body.message).toBe("string");
      expect(body).not.toHaveProperty("token");
    }
  );
});
