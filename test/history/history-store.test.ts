import { beforeEach, describe, expect, it } from "vitest";
import { useHistoryStore } from "@/lib/history/history-store";
import type { HistoryEvent } from "@/lib/history/types";

/**
 * Regression: the cross-device merge sort used to be a pure `occurredAt`
 * compare, which interleaves events incorrectly when devices have skewed
 * clocks (a 30 s-slow device's "later" event lands before a fast-device's
 * "earlier" event). The fix prefers the server-stamped `syncedAt` when
 * both sides carry it and falls back to `clientEventId` for determinism.
 */
function evt(
  partial: Partial<HistoryEvent> & {
    clientEventId: string;
    occurredAt: string;
  }
): HistoryEvent {
  return {
    id: partial.clientEventId,
    clientEventId: partial.clientEventId,
    clientId: partial.clientId ?? "tab-1",
    toolRunId: partial.toolRunId ?? "run-1",
    userId: partial.userId ?? null,
    toolId: partial.toolId ?? "test",
    action: partial.action ?? "test",
    payload: partial.payload ?? {},
    isMilestone: partial.isMilestone ?? false,
    occurredAt: partial.occurredAt,
    syncedAt: partial.syncedAt ?? null,
    undoIndex: partial.undoIndex,
  };
}

describe("useHistoryStore.addEvents", () => {
  beforeEach(() => {
    useHistoryStore.setState({
      events: [],
      clientId: "tab-1",
      lastSyncAt: null,
      syncStatus: "idle",
      syncError: null,
    });
  });

  it("orders by syncedAt when both sides carry it (server clock wins over skewed client clock)", () => {
    const a = evt({
      clientEventId: "evt-A",
      occurredAt: "2026-05-24T10:00:30Z", // slow-clock device thinks this is later
      syncedAt: "2026-05-24T09:59:50Z", // but server stamped it earlier
    });
    const b = evt({
      clientEventId: "evt-B",
      occurredAt: "2026-05-24T10:00:00Z",
      syncedAt: "2026-05-24T10:00:10Z",
    });
    useHistoryStore.getState().addEvents([b, a]);
    const order = useHistoryStore.getState().events.map((e) => e.clientEventId);
    expect(order).toEqual(["evt-A", "evt-B"]);
  });

  it("falls back to occurredAt when syncedAt is missing on either side", () => {
    const a = evt({
      clientEventId: "evt-A",
      occurredAt: "2026-05-24T10:00:00Z",
    });
    const b = evt({
      clientEventId: "evt-B",
      occurredAt: "2026-05-24T10:00:05Z",
    });
    useHistoryStore.getState().addEvents([b, a]);
    const order = useHistoryStore.getState().events.map((e) => e.clientEventId);
    expect(order).toEqual(["evt-A", "evt-B"]);
  });

  it("tie-breaks identical timestamps by clientEventId for full determinism", () => {
    const a = evt({
      clientEventId: "evt-aaaa",
      occurredAt: "2026-05-24T10:00:00Z",
    });
    const b = evt({
      clientEventId: "evt-bbbb",
      occurredAt: "2026-05-24T10:00:00Z",
    });
    // Insert in reverse order; the sort must put `a` first deterministically.
    useHistoryStore.getState().addEvents([b, a]);
    const order = useHistoryStore.getState().events.map((e) => e.clientEventId);
    expect(order).toEqual(["evt-aaaa", "evt-bbbb"]);
  });

  it("deduplicates by clientEventId across calls", () => {
    const a = evt({
      clientEventId: "evt-A",
      occurredAt: "2026-05-24T10:00:00Z",
    });
    useHistoryStore.getState().addEvents([a]);
    useHistoryStore.getState().addEvents([a, a]);
    expect(useHistoryStore.getState().events).toHaveLength(1);
  });
});
