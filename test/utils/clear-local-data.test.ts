import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HistoryEvent } from "@/lib/history/types";

/**
 * "Clear data on this browser" (visitor menu, owner sign-out, discarding
 * signed-out work). It must remove every app-owned key from both storages
 * and nothing else, leave no emptied store state behind, and tell other
 * tabs to reload.
 *
 * Modules are re-imported per test: clear-local-data keeps one
 * BroadcastChannel per tab at module level.
 */

const h = vi.hoisted(() => ({ resetRegistry: vi.fn() }));
vi.mock("@/lib/sync/use-cloud-persisted", () => ({
  resetCloudPersistedRegistry: h.resetRegistry,
}));

/** In-memory BroadcastChannel: delivers to every OTHER instance with the
 *  same name, like the real one (never to the posting object). */
class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = [];
  private listeners = new Set<(e: MessageEvent) => void>();
  constructor(public name: string) {
    FakeBroadcastChannel.instances.push(this);
  }
  postMessage(data: unknown) {
    for (const ch of FakeBroadcastChannel.instances) {
      if (ch === this || ch.name !== this.name) continue;
      ch.listeners.forEach((l) => l({ data } as MessageEvent));
    }
  }
  addEventListener(_type: "message", l: (e: MessageEvent) => void) {
    this.listeners.add(l);
  }
  removeEventListener(_type: "message", l: (e: MessageEvent) => void) {
    this.listeners.delete(l);
  }
  close() {}
}

async function load() {
  vi.resetModules();
  const mod = await import("@/lib/utils/clear-local-data");
  const { useHistoryStore } = await import("@/lib/history/history-store");
  const { useLlmStore } = await import("@/lib/stores/llm-store");
  return { ...mod, useHistoryStore, useLlmStore };
}

function event(id: string): HistoryEvent {
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
  localStorage.clear();
  sessionStorage.clear();
  h.resetRegistry.mockClear();
  FakeBroadcastChannel.instances = [];
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("clearLocalWorkspaceData", () => {
  it("removes only app-owned keys from localStorage and sessionStorage", async () => {
    const { clearLocalWorkspaceData } = await load();
    localStorage.setItem("agile-toolkit:workspace", "{}");
    localStorage.setItem("agile-toolkit:retro-board", "{}");
    localStorage.setItem("agile-toolkit:owner-seen", "1");
    localStorage.setItem("agile-toolkit:visitor-used", "1");
    localStorage.setItem("mascot_appearance", "{}");
    // What Amr notes about the visitor: his memory, the last day, today's greetings.
    localStorage.setItem("mascot_memory", "{}");
    localStorage.setItem("mascot_last_day", "2026-11-9");
    localStorage.setItem("mascot_greeted", "{}");
    localStorage.setItem("icebreaker-favorites", "[]");
    localStorage.setItem("icebreaker-favorites:migrated", "[]");
    localStorage.setItem("icebreaker-favorites:migrated:1729000000000", "[]");
    localStorage.setItem("canvas:touchGestureHintSeen:v1", "1");
    localStorage.setItem("ae-theme", "light");
    localStorage.setItem("sb-project-auth-token", "session");
    localStorage.setItem("other-app:prefs", "x");
    sessionStorage.setItem("agile-toolkit:llm", "{}");
    sessionStorage.setItem("agile-toolkit:kudos:backfilled", "1");
    // Amr's notes for this tab: where he offered a hand, and the visitor's weather.
    sessionStorage.setItem("mascot_helped", "[]");
    sessionStorage.setItem("mascot_weather", "{}");
    sessionStorage.setItem("unrelated", "keep");

    clearLocalWorkspaceData();

    expect(Object.keys(localStorage).sort()).toEqual([
      "ae-theme",
      "other-app:prefs",
      "sb-project-auth-token",
    ]);
    expect(localStorage.getItem("ae-theme")).toBe("light");
    expect(Object.keys(sessionStorage)).toEqual(["unrelated"]);
  });

  it("resets the history, BYOK and cloud-registry stores without writing them back", async () => {
    const { clearLocalWorkspaceData, useHistoryStore, useLlmStore } = await load();
    useHistoryStore.getState().addEvents([event("e1"), event("e2")]);
    useLlmStore.setState({
      storageMode: "device",
      activeProvider: "openai",
      providers: { openai: { apiKey: "sk-test", model: "gpt" } },
    });
    expect(localStorage.getItem("agile-toolkit:history")).toContain("e1");
    expect(localStorage.getItem("agile-toolkit:llm")).toContain("sk-test");

    clearLocalWorkspaceData();

    expect(useHistoryStore.getState().events).toEqual([]);
    expect(useLlmStore.getState().providers).toEqual({});
    expect(useLlmStore.getState().activeProvider).toBeNull();
    expect(h.resetRegistry).toHaveBeenCalledTimes(1);
    // The resets' persist writes happen first and are swept up afterwards.
    expect(localStorage.getItem("agile-toolkit:history")).toBeNull();
    expect(localStorage.getItem("agile-toolkit:llm")).toBeNull();
  });

  it("forgets what Amr remembers, and a save already on its way can't put it back", async () => {
    const { clearLocalWorkspaceData } = await load();
    const { MEMORY_KEY } = await import("@/lib/agent/mascot/memory");
    const { feel, getMind } = await import("@/lib/agent/mascot/mind");
    vi.useFakeTimers();
    // Someone who has been here a few days running.
    localStorage.setItem(
      MEMORY_KEY,
      JSON.stringify({
        v: 1,
        firstDay: "2026-11-01",
        lastDay: "2026-11-01",
        days: 3,
        streak: 3,
        counts: { pat: 7 },
        recent: ["wave"],
      })
    );
    getMind();
    feel("poke"); // counted now, saved a moment later
    expect(localStorage.getItem(MEMORY_KEY)).toContain('"pat":7');

    clearLocalWorkspaceData({ broadcast: false });
    expect(localStorage.getItem(MEMORY_KEY)).toBeNull();
    // The page hasn't reloaded yet: the save that was on its way doesn't land.
    vi.advanceTimersByTime(5000);
    expect(localStorage.getItem(MEMORY_KEY)).toBeNull();

    // If something happens to him before the reload, he starts over as a stranger.
    feel("poke");
    vi.advanceTimersByTime(5000);
    const kept = JSON.parse(localStorage.getItem(MEMORY_KEY)!);
    expect(kept).toMatchObject({ days: 1, streak: 1, counts: { poke: 1 }, recent: [] });
  });

  it("tells other tabs to reload, but not the tab that cleared", async () => {
    const { clearLocalWorkspaceData, installLocalDataChannelListener, LOCAL_DATA_CHANNEL } =
      await load();
    const ownReload = vi.fn();
    const uninstall = installLocalDataChannelListener(ownReload);
    const otherTab = new FakeBroadcastChannel(LOCAL_DATA_CHANNEL);
    const received: unknown[] = [];
    otherTab.addEventListener("message", (e) => received.push(e.data));

    clearLocalWorkspaceData({ broadcast: true });

    expect(received).toEqual([{ type: "cleared", at: expect.any(Number) }]);
    expect(ownReload).not.toHaveBeenCalled();
    uninstall();
  });

  it("does not broadcast when asked not to", async () => {
    const { clearLocalWorkspaceData, LOCAL_DATA_CHANNEL } = await load();
    const otherTab = new FakeBroadcastChannel(LOCAL_DATA_CHANNEL);
    const received: unknown[] = [];
    otherTab.addEventListener("message", (e) => received.push(e.data));

    clearLocalWorkspaceData({ broadcast: false });

    expect(received).toEqual([]);
  });

  it("reloads this tab when another tab clears, until uninstalled", async () => {
    const { installLocalDataChannelListener, LOCAL_DATA_CHANNEL } = await load();
    const onCleared = vi.fn();
    const uninstall = installLocalDataChannelListener(onCleared);
    const otherTab = new FakeBroadcastChannel(LOCAL_DATA_CHANNEL);

    otherTab.postMessage({ type: "something-else" });
    expect(onCleared).not.toHaveBeenCalled();

    otherTab.postMessage({ type: "cleared" });
    expect(onCleared).toHaveBeenCalledTimes(1);
    expect(onCleared).toHaveBeenLastCalledWith({ fresh: true });

    uninstall();
    otherTab.postMessage({ type: "cleared" });
    expect(onCleared).toHaveBeenCalledTimes(1);
  });

  it("by default clears the receiving tab itself before reloading (its sessionStorage, its write-backs)", async () => {
    const { installLocalDataChannelListener, LOCAL_DATA_CHANNEL, useHistoryStore, useLlmStore } =
      await load();
    // This tab: a "session"-mode BYOK key (sessionStorage is per tab, so
    // the clearing tab's sweep never reached it) and owner history held in
    // memory, already written back after the other tab's sweep.
    useLlmStore.setState({
      storageMode: "session",
      activeProvider: "openai",
      providers: { openai: { apiKey: "sk-owner", model: "gpt" } },
    });
    useHistoryStore.getState().addEvents([{ ...event("e1"), userId: "owner-1" }]);
    expect(sessionStorage.getItem("agile-toolkit:llm")).toContain("sk-owner");
    expect(localStorage.getItem("agile-toolkit:history")).toContain("owner-1");
    sessionStorage.setItem("agile-toolkit:canvas-draft:b1", "draft");
    localStorage.setItem("ae-theme", "light");

    // jsdom can't navigate; it reports reload() as not implemented.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const uninstall = installLocalDataChannelListener();
    new FakeBroadcastChannel(LOCAL_DATA_CHANNEL).postMessage({ type: "cleared", at: Date.now() });

    expect(useLlmStore.getState().providers).toEqual({});
    expect(useHistoryStore.getState().events).toEqual([]);
    expect(sessionStorage.getItem("agile-toolkit:llm")).toBeNull();
    expect(sessionStorage.getItem("agile-toolkit:canvas-draft:b1")).toBeNull();
    expect(localStorage.getItem("agile-toolkit:history")).toBeNull();
    expect(localStorage.getItem("ae-theme")).toBe("light");
    uninstall();
  });

  it("a late message (tab was frozen) clears only what the receiving tab could have written", async () => {
    const { installLocalDataChannelListener, LOCAL_DATA_CHANNEL, useHistoryStore } = await load();
    const { MEMORY_KEY } = await import("@/lib/agent/mascot/memory");
    const { feel, getMind } = await import("@/lib/agent/mascot/mind");
    vi.useFakeTimers();
    useHistoryStore.getState().addEvents([{ ...event("e1"), userId: "owner-1" }]);
    sessionStorage.setItem("agile-toolkit:canvas-draft:b1", "draft");
    // This tab's Amr still holds the earlier visitor in mind, with a save on its way.
    getMind();
    feel("pat");
    // Newer work someone did in another tab since the clear, and what Amr
    // remembers of them.
    localStorage.setItem("agile-toolkit:retro-board", '{"cards":[1]}');
    const newer = JSON.stringify({
      v: 1,
      firstDay: "2026-11-09",
      lastDay: "2026-11-09",
      days: 1,
      streak: 1,
      counts: { highFive: 2 },
      recent: [],
    });
    localStorage.setItem(MEMORY_KEY, newer);

    vi.spyOn(console, "error").mockImplementation(() => {});
    const uninstall = installLocalDataChannelListener();
    new FakeBroadcastChannel(LOCAL_DATA_CHANNEL).postMessage({
      type: "cleared",
      at: Date.now() - 5 * 60_000,
    });
    vi.advanceTimersByTime(5000);

    expect(useHistoryStore.getState().events).toEqual([]);
    expect(localStorage.getItem("agile-toolkit:history")).toBeNull();
    expect(sessionStorage.getItem("agile-toolkit:canvas-draft:b1")).toBeNull();
    expect(localStorage.getItem("agile-toolkit:retro-board")).toBe('{"cards":[1]}');
    // The newer memory stays, and the frozen tab's old one is not written over it.
    expect(localStorage.getItem(MEMORY_KEY)).toBe(newer);
    uninstall();
  });

  it("survives blocked storage and a missing BroadcastChannel", async () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    const { clearLocalWorkspaceData, installLocalDataChannelListener } = await load();
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    expect(() => clearLocalWorkspaceData({ broadcast: true })).not.toThrow();
    expect(() => installLocalDataChannelListener(() => {})()).not.toThrow();
  });
});
