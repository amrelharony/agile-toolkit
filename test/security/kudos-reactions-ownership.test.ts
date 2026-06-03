/**
 * Security regression: POST /api/kudos/[id]/reactions must verify the kudos
 * belongs to the caller BEFORE invoking the SECURITY DEFINER `kudos_add_reaction`
 * RPC (which bypasses RLS and looks the row up by id alone). Otherwise an
 * authorized owner could append a reaction to another owner's kudos — multiple
 * owners can share one Supabase project via AUTHORIZED_EMAILS.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "owner-1" } as { id: string },
  owned: null as null | { id: string },
  rpc: vi.fn(async () => ({ error: null as null | { message?: string } })),
}));

function makeClient() {
  const from = () => {
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      maybeSingle: async () => ({ data: h.owned, error: null }),
    };
    return b;
  };
  return { from, rpc: h.rpc };
}

vi.mock("@/lib/auth/require-user", () => ({
  requireAuthorizedUser: async () => ({ user: h.user, supabase: makeClient() }),
}));

import { POST } from "@/app/api/kudos/[id]/reactions/route";

function req(emoji: unknown = "👍"): Request {
  return { headers: { get: () => null }, json: async () => ({ emoji }) } as unknown as Request;
}

beforeEach(() => {
  h.user = { id: "owner-1" };
  h.owned = null;
  h.rpc.mockClear();
  h.rpc.mockResolvedValue({ error: null });
});

describe("kudos reactions ownership gate", () => {
  it("404s and does NOT call the RPC for a kudos the caller doesn't own", async () => {
    h.owned = null; // RLS-bound select finds nothing → foreign/nonexistent
    const res = await POST(req() as never, { params: { id: "kud_victim" } });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("calls the RPC for the caller's own kudos", async () => {
    h.owned = { id: "kud_mine" };
    const res = await POST(req("🎉") as never, { params: { id: "kud_mine" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith("kudos_add_reaction", {
      p_kudos_id: "kud_mine",
      p_emoji: "🎉",
      p_by_profile_id: "owner-1",
    });
  });

  it("still rejects a bad emoji before any DB work", async () => {
    h.owned = { id: "kud_mine" };
    const res = await POST(req("") as never, { params: { id: "kud_mine" } });
    expect(res.status).toBe(400);
    expect(h.rpc).not.toHaveBeenCalled();
  });
});
