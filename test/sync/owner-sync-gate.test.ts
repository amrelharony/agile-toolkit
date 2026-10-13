import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { AuthContextValue } from "@/lib/auth/types";
import type { HistoryEvent } from "@/lib/history/types";

/**
 * Shared-browser gate: owner-only cloud sync must not upload work a
 * visitor left in this browser without the owner choosing "merge".
 */

const h = vi.hoisted(() => ({ auth: null as Partial<AuthContextValue> | null }));

// The gate reads auth only through useAuthOptional() (via use-is-owner).
vi.mock("@/lib/auth/auth-provider", () => ({
  useAuthOptional: () => h.auth,
}));

import {
  VISITOR_USED_KEY,
  discardVisitorData,
  mergeVisitorData,
  setVisitorDataPromptOpen,
  useOwnerSeen,
  useOwnerSyncGate,
  useOwnerSyncGateStore,
  useVisitorDataPending,
  useVisitorDataTracker,
} from "@/lib/sync/owner-sync-gate";
import { OWNER_SEEN_KEY } from "@/lib/auth/use-is-owner";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { useHistoryStore } from "@/lib/history/history-store";
import { OWNER_UNVERIFIED } from "@/lib/auth/owner-check";
import { recordUnsyncedBlob } from "@/lib/sync/unsynced-blobs";

const owner = { id: "owner-1", email: "owner@example.com" } as AuthContextValue["user"];

function setAuth(status: AuthContextValue["status"]) {
  h.auth = { status, user: status === "authenticated" ? owner : null };
}

function event(id: string, userId: string | null = null): HistoryEvent {
  return {
    id,
    clientEventId: id,
    clientId: "tab-1",
    toolRunId: "run-1",
    userId,
    toolId: "retro",
    action: "card.added",
    payload: {},
    isMilestone: false,
    occurredAt: "2026-10-01T10:00:00.000Z",
    syncedAt: null,
  };
}

/** Gate + pending flag from one render, the way the providers/dialog see them. */
function renderGate() {
  return renderHook(() => ({ open: useOwnerSyncGate(), pending: useVisitorDataPending() }));
}

beforeAll(async () => {
  // clear-local-data broadcasts on a BroadcastChannel it never closes;
  // Node's real one would keep the worker alive.
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      postMessage() {}
      addEventListener() {}
      removeEventListener() {}
    }
  );
  await useWorkspaceStore.persist.rehydrate();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useWorkspaceStore.getState().resetWorkspace();
  useHistoryStore.setState({ events: [] });
  useOwnerSyncGateStore.setState({ decision: "unchecked", promptOpen: false });
  h.auth = null;
});

describe("useOwnerSyncGate", () => {
  it("follows the verified owner when no visitor used this browser", () => {
    // Local data alone (e.g. the owner's own kept copy) is not a reason to ask.
    useWorkspaceStore.setState({ teamMembers: [{ id: "m1", name: "Ana" }] });
    setAuth("loading");
    const { result, rerender } = renderGate();
    expect(result.current.open).toBe(false);

    setAuth("anonymous");
    rerender();
    expect(result.current.open).toBe(false);

    setAuth("authenticated");
    rerender();
    expect(result.current).toEqual({ open: true, pending: false });

    setAuth("anonymous");
    rerender();
    expect(result.current.open).toBe(false);
  });

  it("stays closed with no AuthProvider (guest tree)", () => {
    h.auth = null;
    const { result } = renderGate();
    expect(result.current.open).toBe(false);
  });

  it("holds sync until the owner merges visitor data", () => {
    localStorage.setItem(VISITOR_USED_KEY, "1");
    useHistoryStore.setState({ events: [event("visitor-1")] });
    setAuth("authenticated");
    const { result, rerender } = renderGate();
    expect(result.current).toEqual({ open: false, pending: true });
    expect(useOwnerSyncGateStore.getState().promptOpen).toBe(true);

    // "Decide later": the prompt closes, sync stays paused.
    act(() => setVisitorDataPromptOpen(false));
    rerender();
    expect(result.current).toEqual({ open: false, pending: true });

    act(() => mergeVisitorData());
    expect(result.current).toEqual({ open: true, pending: false });
    expect(localStorage.getItem(VISITOR_USED_KEY)).toBeNull();
    // Merge keeps the data for the existing stamp-and-push sync.
    expect(useHistoryStore.getState().events).toHaveLength(1);
  });

  it("discard clears local data and keeps the gate closed until the reload", () => {
    localStorage.setItem(VISITOR_USED_KEY, "1");
    useWorkspaceStore.setState({ teamMembers: [{ id: "m1", name: "Visitor's teammate" }] });
    useHistoryStore.setState({ events: [event("visitor-1")] });
    localStorage.setItem("agile-toolkit:retro-board", "{}");
    localStorage.setItem("ae-theme", "dark");
    setAuth("authenticated");
    const { result } = renderGate();
    expect(result.current.pending).toBe(true);

    act(() => discardVisitorData());

    expect(result.current).toEqual({ open: false, pending: false });
    expect(useOwnerSyncGateStore.getState().decision).toBe("discarding");
    expect(localStorage.getItem(VISITOR_USED_KEY)).toBeNull();
    expect(localStorage.getItem("agile-toolkit:workspace")).toBeNull();
    expect(localStorage.getItem("agile-toolkit:retro-board")).toBeNull();
    expect(localStorage.getItem("ae-theme")).toBe("dark");
    expect(useHistoryStore.getState().events).toEqual([]);
  });

  it("opens and drops a stale marker when nothing local is left to merge", () => {
    localStorage.setItem(VISITOR_USED_KEY, "1");
    // Attributed events were already the owner's; only anonymous ones count.
    useHistoryStore.setState({ events: [event("owner-1", "owner-1")] });
    setAuth("authenticated");
    const { result } = renderGate();
    expect(result.current).toEqual({ open: true, pending: false });
    expect(localStorage.getItem(VISITOR_USED_KEY)).toBeNull();
  });

  it("keeps the marker when only another tab's persisted data is left (stale memory)", () => {
    localStorage.setItem(VISITOR_USED_KEY, "1");
    // A visitor logged history in another tab; this tab's store never
    // re-reads it, so in memory there is nothing anonymous.
    expect(useHistoryStore.getState().events).toEqual([]);
    localStorage.setItem(
      "agile-toolkit:history",
      JSON.stringify({ state: { events: [event("visitor-1")] }, version: 1 })
    );
    setAuth("authenticated");
    const { result } = renderGate();
    expect(result.current).toEqual({ open: false, pending: true });
    expect(localStorage.getItem(VISITOR_USED_KEY)).toBe("1");
  });

  it("asks about blob-synced tool data edited while signed out", () => {
    localStorage.setItem(VISITOR_USED_KEY, "1");
    recordUnsyncedBlob("agile-toolkit:risk-register");
    setAuth("authenticated");
    const { result } = renderGate();
    expect(result.current).toEqual({ open: false, pending: true });
  });

  it("re-arms the kudos backfill on merge", () => {
    sessionStorage.setItem("agile-toolkit:kudos:backfilled", "1");
    localStorage.setItem(VISITOR_USED_KEY, "1");
    useHistoryStore.setState({ events: [event("visitor-1")] });
    setAuth("authenticated");
    const { result } = renderGate();
    expect(result.current.pending).toBe(true);

    act(() => mergeVisitorData());
    expect(sessionStorage.getItem("agile-toolkit:kudos:backfilled")).toBeNull();
  });

  it("asks again after the owner signs out and back in", () => {
    localStorage.setItem(VISITOR_USED_KEY, "1");
    useHistoryStore.setState({ events: [event("visitor-1")] });
    setAuth("authenticated");
    const { result, rerender } = renderGate();
    expect(result.current.pending).toBe(true);

    setAuth("anonymous");
    rerender();
    expect(useOwnerSyncGateStore.getState().decision).toBe("unchecked");

    setAuth("authenticated");
    rerender();
    expect(result.current).toEqual({ open: false, pending: true });
  });
});

describe("useVisitorDataTracker", () => {
  it("marks the browser on a settled visitor's first history write", () => {
    setAuth("anonymous");
    renderHook(() => useVisitorDataTracker());
    expect(localStorage.getItem(VISITOR_USED_KEY)).toBeNull();

    // Bookkeeping that isn't a visitor write.
    act(() => useHistoryStore.getState().setSyncStatus("idle"));
    expect(localStorage.getItem(VISITOR_USED_KEY)).toBeNull();

    act(() => useHistoryStore.getState().addEvent(event("visitor-1")));
    expect(localStorage.getItem(VISITOR_USED_KEY)).toBe("1");
  });

  it("marks the browser on a workspace write, but not on rehydration", async () => {
    setAuth("error");
    renderHook(() => useVisitorDataTracker());

    await act(async () => {
      await useWorkspaceStore.persist.rehydrate();
    });
    expect(localStorage.getItem(VISITOR_USED_KEY)).toBeNull();

    act(() => useWorkspaceStore.setState({ teamMembers: [{ id: "m1", name: "Ana" }] }));
    expect(localStorage.getItem(VISITOR_USED_KEY)).toBe("1");
  });

  it("ignores writes while an owner check is unanswered, but not other auth errors", () => {
    h.auth = { status: "error", user: null, error: OWNER_UNVERIFIED };
    const { rerender } = renderHook(() => useVisitorDataTracker());
    act(() => useHistoryStore.getState().addEvent(event("e1")));
    act(() => useWorkspaceStore.setState({ teamMembers: [{ id: "m1", name: "Ana" }] }));
    act(() => recordUnsyncedBlob("agile-toolkit:risk-register"));
    // Almost always the owner's session: its writes sync once verified.
    expect(localStorage.getItem(VISITOR_USED_KEY)).toBeNull();

    h.auth = { status: "error", user: null, error: "something else" };
    rerender();
    act(() => useHistoryStore.getState().addEvent(event("e2")));
    expect(localStorage.getItem(VISITOR_USED_KEY)).toBe("1");
  });

  it("marks the browser on a blob-synced tool write, but not on a UI preference", () => {
    setAuth("anonymous");
    renderHook(() => useVisitorDataTracker());
    act(() => recordUnsyncedBlob("agile-toolkit:tool-prefs:v1"));
    act(() => recordUnsyncedBlob("agile-toolkit:sidebar:collapsed:v2"));
    expect(localStorage.getItem(VISITOR_USED_KEY)).toBeNull();

    act(() => recordUnsyncedBlob("agile-toolkit:decision-log"));
    expect(localStorage.getItem(VISITOR_USED_KEY)).toBe("1");
  });

  it("ignores writes while auth is loading and from the owner", () => {
    setAuth("loading");
    const { rerender } = renderHook(() => useVisitorDataTracker());
    act(() => useHistoryStore.getState().addEvent(event("e1")));
    expect(localStorage.getItem(VISITOR_USED_KEY)).toBeNull();

    setAuth("authenticated");
    rerender();
    act(() => useHistoryStore.getState().addEvent(event("e2", "owner-1")));
    expect(localStorage.getItem(VISITOR_USED_KEY)).toBeNull();
  });
});

describe("useOwnerSeen", () => {
  it("reflects the owner-seen marker", () => {
    expect(renderHook(() => useOwnerSeen()).result.current).toBe(false);
    localStorage.setItem(OWNER_SEEN_KEY, "1");
    expect(renderHook(() => useOwnerSeen()).result.current).toBe(true);
  });
});
