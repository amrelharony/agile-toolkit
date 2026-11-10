/**
 * isQuietNow: the quiet state for the route the caller names, with the
 * stored preferences. During a client navigation the address bar (and the
 * notify layer's own copy of the route) can still name the old page, so the
 * route must come from the argument.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isQuietNow } from "@/lib/notify/quiet-now";
import { getQuietState } from "@/lib/notify/quiet-state";
import { FOCUS_UNTIL_OFF, NOTIFICATION_PREFS_VERSION } from "@/lib/notify/prefs";
import { useNotificationPrefsStore } from "@/lib/stores/notification-prefs-store";

const PREFS_KEY = "agile-toolkit:notification-prefs";

/** The clock moves by swapping Date for a subclass (not fake timers), as in quiet-state.test.ts. */
const RealDate = Date;
let nowMs = new RealDate(2026, 10, 8, 14, 0).getTime();

class ShiftedDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(nowMs);
    else super(...(args as [number]));
  }
  static now() {
    return nowMs;
  }
}

function setClock(h: number, m = 0) {
  nowMs = new RealDate(2026, 10, 8, h, m).getTime();
}

const root = document.documentElement;

beforeEach(() => {
  vi.stubGlobal("Date", ShiftedDate);
  setClock(14);
  useNotificationPrefsStore.setState(useNotificationPrefsStore.getInitialState(), true);
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete root.dataset.presenting;
  delete root.dataset.intro;
  window.history.replaceState(null, "", "/");
});

describe("isQuietNow", () => {
  it("takes the route from its argument: a ceremony page is quiet while the address bar says /", () => {
    expect(window.location.pathname).toBe("/");
    expect(isQuietNow("/refinement")).toBe(true);
    expect(isQuietNow("/retro/board-1")).toBe(true);
    expect(isQuietNow("/")).toBe(false);
    expect(isQuietNow("/kanban")).toBe(false);
  });

  it("is quiet while presenting and during an intro, on any route", () => {
    root.dataset.presenting = "true";
    expect(isQuietNow("/kanban")).toBe(true);
    root.dataset.presenting = "false";
    expect(isQuietNow("/kanban")).toBe(false);
    delete root.dataset.presenting;
    root.dataset.intro = "poster";
    expect(isQuietNow("/kanban")).toBe(true);
  });

  it("is quiet with Focus on, and inside quiet hours", () => {
    useNotificationPrefsStore.getState().startFocus(30 * 60_000);
    expect(isQuietNow("/kanban")).toBe(true);
    useNotificationPrefsStore.getState().endFocus();
    expect(isQuietNow("/kanban")).toBe(false);

    useNotificationPrefsStore.getState().setQuietHours({
      enabled: true,
      start: "13:00",
      end: "15:00",
    });
    expect(isQuietNow("/kanban")).toBe(true);
    setClock(15, 30);
    expect(isQuietNow("/kanban")).toBe(false);
  });

  it("reads the stored preferences, not the factory defaults", async () => {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        state: { quietHours: { enabled: true, start: "12:00", end: "18:00" } },
        version: NOTIFICATION_PREFS_VERSION,
      })
    );
    await useNotificationPrefsStore.persist.rehydrate();
    // With the defaults (quiet hours off) 14:00 is not quiet.
    expect(getQuietState(Date.now(), "/kanban", root).quiet).toBe(false);
    expect(isQuietNow("/kanban")).toBe(true);
  });

  describe("on a cold load, before any provider has loaded the store", () => {
    afterEach(() => {
      vi.resetModules();
    });

    /** A fresh store that has never loaded, as on a first page load. */
    async function coldStart(stored: Record<string, unknown>) {
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({ state: stored, version: NOTIFICATION_PREFS_VERSION })
      );
      vi.resetModules();
      const store = await import("@/lib/stores/notification-prefs-store");
      const { isQuietNow: coldIsQuietNow } = await import("@/lib/notify/quiet-now");
      expect(store.useNotificationPrefsStore.persist.hasHydrated()).toBe(false);
      return { store, coldIsQuietNow };
    }

    it("is quiet with Focus stored on", async () => {
      const { store, coldIsQuietNow } = await coldStart({ focusUntil: FOCUS_UNTIL_OFF });
      expect(coldIsQuietNow("/kanban")).toBe(true);
      expect(store.useNotificationPrefsStore.persist.hasHydrated()).toBe(true);
    });

    it("is quiet inside stored quiet hours", async () => {
      const { coldIsQuietNow } = await coldStart({
        quietHours: { enabled: true, start: "13:00", end: "15:00" },
      });
      expect(coldIsQuietNow("/kanban")).toBe(true);
    });

    it("is not quiet when nothing quiet is stored", async () => {
      const { coldIsQuietNow } = await coldStart({});
      expect(coldIsQuietNow("/kanban")).toBe(false);
    });
  });

  it("falls back to window.location only when given null", () => {
    window.history.replaceState(null, "", "/retro");
    expect(isQuietNow(null)).toBe(true);
    // A route given wins over the address bar, even an empty one.
    expect(isQuietNow("/kanban")).toBe(false);
    expect(isQuietNow("")).toBe(false);
    window.history.replaceState(null, "", "/kanban");
    expect(isQuietNow(null)).toBe(false);
    expect(isQuietNow("/retro")).toBe(true);
  });

  it("is false on the server", () => {
    root.dataset.presenting = "true";
    useNotificationPrefsStore.getState().startFocus(null);
    vi.stubGlobal("window", undefined);
    expect(isQuietNow("/refinement")).toBe(false);
    expect(isQuietNow(null)).toBe(false);
  });
});
