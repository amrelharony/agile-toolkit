/**
 * Security regression: the guest kudos endpoint must be append-only.
 *
 * It writes via the RLS-bypassing service-role client. The original code
 * did `upsert(row, { onConflict: "id" })` with a client-supplied `id`, so a
 * guest who knew/guessed an existing kudos id (the owner-scoped realtime
 * channel leaks peers' ids across squads) could turn the write into an
 * UPDATE of THAT row — rewriting its message/author/squad and bypassing the
 * BEFORE INSERT fairness trigger.
 *
 * The fix: pre-check by id; INSERT only when absent; the guest's own id is
 * an idempotent retry; a foreign id is a 409 conflict (never an overwrite).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const SESSION = {
  profileId: "guest-profile-A",
  squadId: "squad-A",
  displayName: "Guest A",
};

// Mutable holders the mocked modules read from (set per test).
const h = vi.hoisted(() => ({
  session: null as null | typeof SESSION,
  invite: null as null | { ownerId: string; role: string },
  existingKudos: null as null | { from_profile_id: string | null },
  insertResult: { error: null as null | { code?: string; message?: string } },
  inserts: [] as Array<Record<string, unknown>>,
}));

function makeAdmin() {
  const builder = (table: string) => {
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      maybeSingle: async () => {
        if (table === "kudos") return { data: h.existingKudos, error: null };
        // squad_profiles recipient lookup — not exercised (no toProfileId).
        return { data: null, error: null };
      },
      insert: async (row: Record<string, unknown>) => {
        if (table === "kudos") h.inserts.push(row);
        return h.insertResult;
      },
    };
    return b;
  };
  return { from: builder };
}

vi.mock("@/lib/auth/guest-session", () => ({ getGuestSession: async () => h.session }));
vi.mock("@/lib/squads/invites", () => ({
  resolveGuestInvite: async () => h.invite,
}));
vi.mock("@/lib/squads/server", () => ({
  getSquadAdminClient: vi.fn(() => makeAdmin()),
  touchProfileLastSeen: vi.fn(async () => {}),
}));
vi.mock("@/app/api/guest/_rate-limit", () => ({ consumeGuestRateToken: () => true }));

import { POST } from "@/app/api/guest/kudos/route";

// A real Request — the route reads the body via the streaming readBoundedText
// (req.body), not req.json(), so a stub that only implements json() no longer
// suffices.
function req(body: unknown): Request {
  return new Request("http://localhost/api/guest/kudos", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function kudosBody(id: string) {
  return {
    id,
    theme: "awesome",
    toName: "Bob",
    fromName: "ignored-overridden",
    message: "Great work on the release!",
    sentAt: new Date().toISOString(),
  };
}

beforeEach(() => {
  h.session = SESSION;
  h.invite = { ownerId: "owner-1", role: "editor" };
  h.existingKudos = null;
  h.insertResult = { error: null };
  h.inserts = [];
});

describe("guest kudos append-only write", () => {
  it("INSERTs a brand-new kudos (no existing row)", async () => {
    const res = await POST(req(kudosBody("kud_new")) as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0].id).toBe("kud_new");
    // Identity is taken from the verified cookie, not the payload.
    expect(h.inserts[0].from_profile_id).toBe(SESSION.profileId);
  });

  it("stores a printed card's book episode, and only its number", async () => {
    const res = await POST(
      req({ ...kudosBody("kud_card"), theme: "ownership", episode: 7 }) as never
    );
    expect(res.status).toBe(200);
    expect(h.inserts[0]).toMatchObject({ theme: "ownership", episode: 7 });
    await POST(req(kudosBody("kud_plain")) as never);
    expect(h.inserts[1].episode).toBeNull();
  });

  it("REFUSES to overwrite a kudos owned by another profile (the IDOR)", async () => {
    h.existingKudos = { from_profile_id: "some-other-guest" };
    const res = await POST(req(kudosBody("kud_victim")) as never);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "id_conflict" });
    // Critically: no write happened — the victim row is untouched.
    expect(h.inserts).toHaveLength(0);
  });

  it("treats the guest's own id as an idempotent retry (no mutation)", async () => {
    h.existingKudos = { from_profile_id: SESSION.profileId };
    const res = await POST(req(kudosBody("kud_mine")) as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, duplicate: true });
    expect(h.inserts).toHaveLength(0);
  });

  it("on a concurrent-insert 23505 race, re-checks ownership", async () => {
    // Pre-check misses, INSERT 23505s, post-race row is a DIFFERENT author.
    h.existingKudos = null;
    h.insertResult = { error: { code: "23505", message: "duplicate key" } };
    // After the failed insert, the existing lookup now returns a foreign row.
    let call = 0;
    const adminWithRace = {
      from: (table: string) => {
        const b: Record<string, unknown> = {
          select: () => b,
          eq: () => b,
          maybeSingle: async () => {
            if (table !== "kudos") return { data: null, error: null };
            call += 1;
            // 1st call: pre-check (absent). 2nd call: post-race (foreign).
            return { data: call === 1 ? null : { from_profile_id: "other" }, error: null };
          },
          insert: async () => h.insertResult,
        };
        return b;
      },
    };
    const mod = await import("@/lib/squads/server");
    vi.mocked(mod.getSquadAdminClient).mockReturnValueOnce(adminWithRace as never);
    const res = await POST(req(kudosBody("kud_race")) as never);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "id_conflict" });
  });
});
