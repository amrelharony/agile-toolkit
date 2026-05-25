import { describe, expect, it, vi } from "vitest";
import { toRow, fromRow } from "@/lib/history/sync";
import type { HistoryEvent } from "@/lib/history/types";

// Capture the blob that exportToJSON tries to save so we can inspect its
// contents without touching the DOM's download machinery.
const savedBlobs: Blob[] = [];
vi.mock("file-saver", () => ({
  saveAs: (blob: Blob) => {
    savedBlobs.push(blob);
  },
}));

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

describe("sanitizeGuestPayload", () => {
  it("rejects non-object payloads", async () => {
    const { sanitizeGuestPayload, GuestPayloadError } = await import("@/lib/history/sanitize");
    expect(() => sanitizeGuestPayload(null)).toThrow(GuestPayloadError);
    expect(() => sanitizeGuestPayload("scalar")).toThrow(GuestPayloadError);
    expect(() => sanitizeGuestPayload([1, 2, 3])).toThrow(GuestPayloadError);
  });

  it("rejects payloads deeper than 3 levels", async () => {
    const { sanitizeGuestPayload, GuestPayloadError } = await import("@/lib/history/sanitize");
    const tooDeep = { a: { b: { c: { d: 1 } } } };
    expect(() => sanitizeGuestPayload(tooDeep)).toThrow(GuestPayloadError);
  });

  it("redacts suspicious keys", async () => {
    const { sanitizeGuestPayload } = await import("@/lib/history/sanitize");
    const cleaned = sanitizeGuestPayload({ token: "abc", boardId: "b1" });
    expect(cleaned.token).toBe("[redacted]");
    expect(cleaned.boardId).toBe("b1");
  });

  it("rejects payloads exceeding 16 KiB", async () => {
    const { sanitizeGuestPayload, GuestPayloadError } = await import("@/lib/history/sanitize");
    const big = { huge: "x".repeat(20_000) };
    expect(() => sanitizeGuestPayload(big)).toThrow(GuestPayloadError);
  });

  it("rejects objects with too many keys", async () => {
    const { sanitizeGuestPayload, GuestPayloadError } = await import("@/lib/history/sanitize");
    const wide: Record<string, number> = {};
    for (let i = 0; i < 60; i++) wide[`k${i}`] = i;
    expect(() => sanitizeGuestPayload(wide)).toThrow(GuestPayloadError);
  });
});

describe("exportEventsAsJSON identity redaction", () => {
  it("strips userId / squadProfileId / clientId / toolRunId from serialised events", async () => {
    savedBlobs.length = 0;
    const { exportEventsAsJSON } = await import("@/lib/history/export");
    const event: HistoryEvent = {
      id: "evt-1",
      clientEventId: "evt-1",
      clientId: "tab-1",
      toolRunId: "run-1",
      userId: "owner-uid-secret",
      squadProfileId: "guest-uid-secret",
      toolId: "canvas",
      action: "card_added",
      payload: { cardId: "c1" },
      isMilestone: false,
      occurredAt: "2026-05-24T10:00:00Z",
      syncedAt: null,
    };

    exportEventsAsJSON([event]);
    expect(savedBlobs).toHaveLength(1);
    const written = await savedBlobs[0].text();
    expect(written).not.toContain("owner-uid-secret");
    expect(written).not.toContain("guest-uid-secret");
    expect(written).not.toContain("tab-1");
    expect(written).not.toContain("run-1");
    // Useful payload still present.
    expect(written).toContain("card_added");
    expect(written).toContain("canvas");
  });
});
