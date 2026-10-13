import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import type { HistoryEvent } from "@/lib/history/types";

/**
 * CloudSyncProvider and HistorySyncProvider start only once the owner sync
 * gate opens (verified owner + any visitor-data question answered), not on
 * a bare "authenticated" status. In particular the history provider's
 * stamp of anonymous events with the owner's id must wait for the gate.
 */

const h = vi.hoisted(() => ({
  gate: false,
  user: { id: "owner-1" } as { id: string } | null,
  supabase: {} as object | null,
  start: vi.fn(async () => {}),
  stop: vi.fn(),
  resetRegistry: vi.fn(),
  pushEvents: vi.fn(async (events: { clientEventId: string }[], userId: string) =>
    userId ? events.map((e) => e.clientEventId) : []
  ),
  pullEvents: vi.fn(async () => []),
  subscribeToHistory: vi.fn(() => () => {}),
}));

vi.mock("@/lib/sync/owner-sync-gate", () => ({ useOwnerSyncGate: () => h.gate }));
vi.mock("@/lib/auth/auth-provider", () => ({
  // Status is deliberately "authenticated" throughout: only the gate decides.
  useAuth: () => ({ status: "authenticated", user: h.user }),
}));
vi.mock("@/lib/auth/supabase-browser", () => ({ getAuthBrowserClient: () => h.supabase }));
vi.mock("@/lib/sync/engine", () => ({ syncEngine: { start: h.start, stop: h.stop } }));
vi.mock("@/lib/sync/use-cloud-persisted", () => ({
  resetCloudPersistedRegistry: h.resetRegistry,
}));
vi.mock("@/lib/history/sync", () => ({
  pushEvents: h.pushEvents,
  pullEvents: h.pullEvents,
  nextPullCursor: () => null,
  subscribeToHistory: h.subscribeToHistory,
}));

import { CloudSyncProvider } from "@/lib/sync/sync-provider";
import { HistorySyncProvider } from "@/lib/history/sync-provider";
import { useHistoryStore } from "@/lib/history/history-store";

function anonymousEvent(id: string): HistoryEvent {
  return {
    id,
    clientEventId: id,
    clientId: "tab-1",
    toolRunId: "run-1",
    userId: null,
    toolId: "retro",
    action: "card.added",
    payload: {},
    isMilestone: false,
    occurredAt: "2026-10-01T10:00:00.000Z",
    syncedAt: null,
  };
}

beforeEach(() => {
  h.gate = false;
  h.user = { id: "owner-1" };
  for (const fn of [
    h.start,
    h.stop,
    h.resetRegistry,
    h.pushEvents,
    h.pullEvents,
    h.subscribeToHistory,
  ]) {
    fn.mockClear();
  }
  useHistoryStore.setState({ events: [], lastSyncAt: null, syncStatus: "idle" });
});

describe("CloudSyncProvider", () => {
  it("keeps the engine stopped while the gate is closed", () => {
    render(<CloudSyncProvider>{null}</CloudSyncProvider>);
    expect(h.start).not.toHaveBeenCalled();
  });

  it("starts when the gate opens and stops (clearing the registry) when it closes", () => {
    const { rerender } = render(<CloudSyncProvider>{null}</CloudSyncProvider>);
    h.gate = true;
    rerender(<CloudSyncProvider>{null}</CloudSyncProvider>);
    expect(h.start).toHaveBeenCalledTimes(1);
    expect(h.start).toHaveBeenCalledWith(h.supabase, "owner-1");

    h.gate = false;
    rerender(<CloudSyncProvider>{null}</CloudSyncProvider>);
    expect(h.stop).toHaveBeenCalled();
    expect(h.resetRegistry).toHaveBeenCalledTimes(1);
  });

  it("clears the registry when a different user signs in on the same tab (BUG-S6)", () => {
    h.gate = true;
    const { rerender } = render(<CloudSyncProvider>{null}</CloudSyncProvider>);
    h.user = { id: "owner-2" };
    rerender(<CloudSyncProvider>{null}</CloudSyncProvider>);
    expect(h.resetRegistry).toHaveBeenCalledTimes(1);
    expect(h.start).toHaveBeenLastCalledWith(h.supabase, "owner-2");
  });
});

describe("HistorySyncProvider", () => {
  it("does not stamp or push anonymous events while the gate is closed", async () => {
    useHistoryStore.setState({ events: [anonymousEvent("visitor-1")] });
    render(<HistorySyncProvider>{null}</HistorySyncProvider>);
    // Give any (wrongly) started async sync a chance to run.
    await new Promise((r) => setTimeout(r, 0));
    expect(h.pushEvents).not.toHaveBeenCalled();
    expect(useHistoryStore.getState().events[0].userId).toBeNull();
  });

  it("stamps and pushes anonymous events once the gate opens", async () => {
    useHistoryStore.setState({ events: [anonymousEvent("visitor-1")] });
    const { rerender } = render(<HistorySyncProvider>{null}</HistorySyncProvider>);
    h.gate = true;
    rerender(<HistorySyncProvider>{null}</HistorySyncProvider>);
    await waitFor(() => expect(h.pushEvents).toHaveBeenCalledTimes(1));
    expect(useHistoryStore.getState().events[0].userId).toBe("owner-1");
    expect(h.pushEvents).toHaveBeenCalledWith(
      [expect.objectContaining({ clientEventId: "visitor-1", userId: "owner-1" })],
      "owner-1"
    );
    await waitFor(() => expect(h.subscribeToHistory).toHaveBeenCalledTimes(1));
  });
});
