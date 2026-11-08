import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The event bridge listens to no input: no click, hover, key, scroll or
 * popstate listeners, no session-minute interval, and `history.pushState` /
 * `replaceState` stay untouched. Tool visits come from the provider's
 * `usePathname` through `trackPathVisit`. The history-log parts (retro
 * formats, outcome bridge) still run.
 */

const h = vi.hoisted(() => ({
  dispatch: vi.fn(),
  ingestToolVisit: vi.fn(),
  detachOutcomes: vi.fn(),
  installOutcomeBridge: vi.fn(),
}));

vi.mock("@/lib/gamification/engine", () => ({ dispatch: h.dispatch }));
vi.mock("@/lib/gamification/ledger", () => ({ ingestToolVisit: h.ingestToolVisit }));
vi.mock("@/lib/gamification/outcome-bridge", () => ({
  installOutcomeBridge: h.installOutcomeBridge,
}));

import {
  __resetPathVisitForTests,
  installEventBridge,
  trackPathVisit,
} from "@/lib/gamification/event-bridge";
import { useHistoryStore } from "@/lib/history/history-store";
import { useVDnaStore } from "@/lib/stores/vdna-store";
import { useSonificationStore } from "@/lib/stores/sonification-store";
import type { HistoryEvent } from "@/lib/history/types";

const INPUT_EVENTS = ["click", "pointerover", "keydown", "scroll", "popstate"];

let detach: () => void = () => {};

beforeEach(() => {
  h.dispatch.mockClear();
  h.ingestToolVisit.mockClear();
  h.detachOutcomes.mockClear();
  h.installOutcomeBridge.mockReset();
  h.installOutcomeBridge.mockReturnValue(h.detachOutcomes);
  __resetPathVisitForTests();
  useHistoryStore.setState({ events: [] });
  useVDnaStore.setState({ counters: {} });
});

afterEach(() => {
  detach();
  vi.restoreAllMocks();
});

describe("installEventBridge", () => {
  it("registers no input listeners and no interval", () => {
    const add = vi.spyOn(window, "addEventListener");
    const docAdd = vi.spyOn(document, "addEventListener");
    const interval = vi.spyOn(window, "setInterval");
    detach = installEventBridge();
    const types = [...add.mock.calls, ...docAdd.mock.calls].map((c) => c[0]);
    for (const t of INPUT_EVENTS) expect(types).not.toContain(t);
    expect(interval).not.toHaveBeenCalled();
  });

  it("leaves history.pushState and replaceState untouched", () => {
    const push = window.history.pushState;
    const replace = window.history.replaceState;
    detach = installEventBridge();
    expect(window.history.pushState).toBe(push);
    expect(window.history.replaceState).toBe(replace);
    window.history.pushState({}, "", "/retro");
    expect(h.ingestToolVisit).not.toHaveBeenCalled();
    detach();
    expect(window.history.pushState).toBe(push);
    window.history.replaceState({}, "", "/");
  });

  it("dispatches nothing on clicks, hovers, keys or scrolling", () => {
    detach = installEventBridge();
    h.dispatch.mockClear();
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    btn.dispatchEvent(new Event("pointerover", { bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    window.dispatchEvent(new Event("scroll"));
    btn.remove();
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(useVDnaStore.getState().counters).toEqual({});
  });

  it("no longer marks audio modes in the stripped counters", () => {
    detach = installEventBridge();
    useSonificationStore.setState({ enabled: true, mode: "full" });
    const counters = useVDnaStore.getState().counters;
    expect(counters["audio-modes-used"]).toBeUndefined();
    expect(counters["audio-mode:full"]).toBeUndefined();
    expect(h.dispatch).not.toHaveBeenCalled();
    useSonificationStore.setState({ enabled: false });
  });

  it("still counts distinct retro formats from the history log", () => {
    detach = installEventBridge();
    const ev = (id: string, format: string) =>
      ({
        id,
        clientEventId: id,
        clientId: "c",
        toolRunId: "r",
        userId: null,
        toolId: "retro",
        action: "format_changed",
        payload: { format },
        isMilestone: false,
        occurredAt: new Date().toISOString(),
        syncedAt: null,
      }) as HistoryEvent;
    useHistoryStore.setState({ events: [ev("a", "starfish"), ev("b", "4ls"), ev("c", "4ls")] });
    expect(useVDnaStore.getState().counters["retro-formats-used"]).toBe(2);
    expect(h.dispatch).toHaveBeenCalledWith({ name: "retro-format-used" });
  });

  it("installs the outcome bridge and detaches it", () => {
    detach = installEventBridge();
    expect(h.installOutcomeBridge).toHaveBeenCalledTimes(1);
    detach();
    expect(h.detachOutcomes).toHaveBeenCalledTimes(1);
  });

  it("is idempotent while installed", () => {
    detach = installEventBridge();
    installEventBridge();
    expect(h.installOutcomeBridge).toHaveBeenCalledTimes(1);
  });
});

describe("trackPathVisit", () => {
  it("records a visit for a tool route", () => {
    trackPathVisit("/retro");
    expect(h.ingestToolVisit).toHaveBeenCalledWith("retro");
  });

  it("counts the same path once in a row, and again after leaving", () => {
    trackPathVisit("/retro");
    trackPathVisit("/retro");
    expect(h.ingestToolVisit).toHaveBeenCalledTimes(1);
    trackPathVisit("/planning-poker");
    trackPathVisit("/retro");
    expect(h.ingestToolVisit.mock.calls.map((c) => c[0])).toEqual([
      "retro",
      "planning-poker",
      "retro",
    ]);
  });

  it("ignores non-tool routes, nested routes, VIP tools and empty paths", () => {
    trackPathVisit("/");
    trackPathVisit("/history");
    trackPathVisit("/retro/room");
    trackPathVisit("/squad-session");
    trackPathVisit(null);
    trackPathVisit("");
    expect(h.ingestToolVisit).not.toHaveBeenCalled();
  });
});
