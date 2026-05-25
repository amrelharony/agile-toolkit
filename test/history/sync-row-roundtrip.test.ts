import { describe, expect, it } from "vitest";
import { toRow, fromRow } from "@/lib/history/sync";
import type { HistoryEvent } from "@/lib/history/types";

function baseEvent(overrides: Partial<HistoryEvent> = {}): HistoryEvent {
  return {
    id: "evt-1",
    clientEventId: "evt-1",
    clientId: "tab-1",
    toolRunId: "run-1",
    userId: "00000000-0000-0000-0000-000000000001",
    toolId: "canvas",
    action: "card_added",
    payload: { cardId: "c1", text: "hello" },
    isMilestone: false,
    occurredAt: "2026-05-24T10:00:00.000Z",
    syncedAt: null,
    ...overrides,
  };
}

describe("history row round-trip", () => {
  it("stamps squad_profile_id null for owner-authored events", () => {
    const row = toRow(baseEvent(), "00000000-0000-0000-0000-000000000001");
    expect(row.squad_profile_id).toBeNull();
  });

  it("round-trips squad_profile_id for guest-authored events", () => {
    const profileId = "11111111-1111-1111-1111-111111111111";
    const ownerId = "00000000-0000-0000-0000-000000000001";
    const event = baseEvent({ squadProfileId: profileId });
    const row = toRow(event, ownerId);
    expect(row.squad_profile_id).toBe(profileId);
    expect(row.user_id).toBe(ownerId);

    const restored = fromRow({
      ...row,
      created_at: "2026-05-24T10:00:01.000Z",
    });
    expect(restored.squadProfileId).toBe(profileId);
    expect(restored.userId).toBe(ownerId);
  });

  it("normalises absent squad_profile_id to null on read", () => {
    const row = toRow(baseEvent(), "00000000-0000-0000-0000-000000000001");
    delete row.squad_profile_id;
    const restored = fromRow(row);
    expect(restored.squadProfileId).toBeNull();
  });
});
