// @vitest-environment node
/**
 * GET /api/auth/owner — the browser's way to ask "is this session the owner?"
 * (the allowlist is server-only, so the client cannot answer it itself).
 *
 * requireAuthorizedUser is mocked: its own checks are covered in
 * require-user.test.ts. What matters here is that a success is an explicit,
 * uncacheable `{ owner: true }`, and that every refusal it throws reaches the
 * client unchanged — the client maps 401 / 403 / anything else differently.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonError } from "@/lib/auth/json-error";

const h = vi.hoisted(() => ({ outcome: null as unknown }));

vi.mock("@/lib/auth/require-user", () => ({
  requireAuthorizedUser: async () => {
    if (h.outcome) throw h.outcome;
    return { user: { id: "owner-1" }, supabase: {} };
  },
}));

import { GET, dynamic } from "@/app/api/auth/owner/route";

beforeEach(() => {
  h.outcome = null;
});

describe("GET /api/auth/owner", () => {
  it("is never prerendered", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("answers 200 { owner: true }, not cacheable, for the verified owner", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ owner: true });
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
    const res = await GET();
    expect(res).toBe(thrown);
    expect(res.status).toBe(status);
    expect((await res.json()).error).toBe(code);
  });

  it("rethrows anything that is not a Response", async () => {
    h.outcome = new Error("boom");
    await expect(GET()).rejects.toThrow("boom");
  });
});
