import { describe, expect, it } from "vitest";
import { inviteAuditKeys } from "@/lib/squads/audit-keys";

/**
 * Regression: the invite create/revoke audit rows used
 * `invite_create_${uuid}` / `invite_${uuid}` for client_event_id /
 * tool_run_id. A 36-char gen_random_uuid() pushed those to 50 / 43 chars,
 * overflowing the `char_length(...) between 1 and 32` CHECK on
 * history_events (0002_auth_history.sql) — so every audit insert failed
 * with errcode 23514 and was silently swallowed (best-effort void insert).
 * inviteAuditKeys() must keep both keys within 32 chars and keep the
 * create/revoke rows distinct for the same invite.
 */
const SAMPLE_UUIDS = [
  "0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
  "ffffffff-ffff-ffff-ffff-ffffffffffff",
  "00000000-0000-0000-0000-000000000000",
  "deadbeef-cafe-babe-f00d-1234567890ab",
];

describe("inviteAuditKeys", () => {
  it("keeps both keys within the 32-char history_events CHECK for create and revoke", () => {
    for (const id of SAMPLE_UUIDS) {
      for (const kind of ["create", "revoke"] as const) {
        const { clientEventId, toolRunId } = inviteAuditKeys(id, kind);
        expect(clientEventId.length).toBeGreaterThanOrEqual(1);
        expect(clientEventId.length).toBeLessThanOrEqual(32);
        expect(toolRunId.length).toBeGreaterThanOrEqual(1);
        expect(toolRunId.length).toBeLessThanOrEqual(32);
      }
    }
  });

  it("produces distinct client_event_ids for create vs revoke of the same invite", () => {
    const id = SAMPLE_UUIDS[0];
    const create = inviteAuditKeys(id, "create");
    const revoke = inviteAuditKeys(id, "revoke");
    expect(create.clientEventId).not.toBe(revoke.clientEventId);
    // tool_run_id intentionally groups both events under the same invite run.
    expect(create.toolRunId).toBe(revoke.toolRunId);
  });

  it("produces distinct keys for different invites", () => {
    const a = inviteAuditKeys(SAMPLE_UUIDS[0], "create");
    const b = inviteAuditKeys(SAMPLE_UUIDS[3], "create");
    expect(a.clientEventId).not.toBe(b.clientEventId);
  });
});
