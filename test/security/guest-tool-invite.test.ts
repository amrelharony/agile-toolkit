// @vitest-environment node
/**
 * hasGuestToolInvite — "does this guest hold ANY live invite for the tool?"
 *
 * Room-token minting uses it for the kudos wall: one room per workspace, whose
 * key the guest kudos page hands to the holder of a kudos invite for any
 * entity. It must apply the same filters as resolveGuestInvite, minus the
 * entity: the right squad and tool, not revoked, squad not revoked, open or
 * pinned to THIS profile, not expired.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type Row = { profile_id: string | null; expires_at: string | null };

const h = vi.hoisted(() => ({
  admin: true,
  rows: [] as Row[],
  error: null as null | { message: string },
  calls: [] as Array<[string, ...unknown[]]>,
}));

vi.mock("@/lib/squads/server", () => ({
  getSquadAdminClient: () => {
    if (!h.admin) return null;
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "or", "order"]) {
      builder[method] = (...args: unknown[]) => {
        h.calls.push([method, ...args]);
        return builder;
      };
    }
    builder.limit = async (n: number) => {
      h.calls.push(["limit", n]);
      return { data: h.error ? null : h.rows, error: h.error };
    };
    return {
      from: (table: string) => {
        h.calls.push(["from", table]);
        return builder;
      },
    };
  },
}));

import { hasGuestToolInvite } from "@/lib/squads/guest-tool-invite";

const PROFILE = "11111111-1111-4111-8111-111111111111";
const OPTS = { squadId: "squad-1", profileId: PROFILE, toolId: "kudos" };
const FUTURE = new Date(Date.now() + 86_400_000).toISOString();
const PAST = new Date(Date.now() - 86_400_000).toISOString();

beforeEach(() => {
  h.admin = true;
  h.rows = [];
  h.error = null;
  h.calls = [];
});

describe("hasGuestToolInvite", () => {
  it("filters on the squad, the tool, revocation of invite and squad, and this profile", async () => {
    h.rows = [{ profile_id: null, expires_at: null }];
    await expect(hasGuestToolInvite(OPTS)).resolves.toBe(true);
    expect(h.calls).toContainEqual(["from", "session_invites"]);
    expect(h.calls).toContainEqual(["eq", "squad_id", "squad-1"]);
    expect(h.calls).toContainEqual(["eq", "tool_id", "kudos"]);
    expect(h.calls).toContainEqual(["is", "revoked_at", null]);
    expect(h.calls).toContainEqual(["is", "squad.revoked_at", null]);
    expect(h.calls).toContainEqual(["or", `profile_id.is.null,profile_id.eq.${PROFILE}`]);
    // No entity filter: any entity's invite counts.
    expect(h.calls.some(([m, col]) => m === "eq" && col === "entity_id")).toBe(false);
  });

  it("accepts an invite pinned to this profile, or one that has not expired", async () => {
    h.rows = [{ profile_id: PROFILE, expires_at: FUTURE }];
    await expect(hasGuestToolInvite(OPTS)).resolves.toBe(true);
  });

  it("refuses when every invite has expired", async () => {
    h.rows = [
      { profile_id: null, expires_at: PAST },
      { profile_id: PROFILE, expires_at: PAST },
    ];
    await expect(hasGuestToolInvite(OPTS)).resolves.toBe(false);
  });

  it("refuses an invite pinned to another profile", async () => {
    h.rows = [{ profile_id: "99999999-9999-4999-8999-999999999999", expires_at: null }];
    await expect(hasGuestToolInvite(OPTS)).resolves.toBe(false);
  });

  it("refuses when there is no invite, on a query error, or without the admin client", async () => {
    await expect(hasGuestToolInvite(OPTS)).resolves.toBe(false);
    h.rows = [{ profile_id: null, expires_at: null }];
    h.error = { message: "boom" };
    await expect(hasGuestToolInvite(OPTS)).resolves.toBe(false);
    h.error = null;
    h.admin = false;
    await expect(hasGuestToolInvite(OPTS)).resolves.toBe(false);
  });
});
