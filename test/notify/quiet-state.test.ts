import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultQuietDom, getQuietState, type QuietDom } from "@/lib/notify/quiet-state";
import { DEFAULT_NOTIFICATION_PREFS, type NotificationPrefs } from "@/lib/notify/prefs";
import {
  getNotificationPrefsSnapshot,
  useNotificationPrefsStore,
} from "@/lib/stores/notification-prefs-store";
import { isPhoneViewport, PHONE_MAX_PX, PHONE_MEDIA_QUERY } from "@/lib/layout/breakpoints";

/**
 * The clock is moved by swapping the global Date for a subclass whose "now"
 * the test sets (not fake timers, which would also freeze scheduler code).
 */
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

function setClock(h: number, m = 0, day = 8) {
  nowMs = new RealDate(2026, 10, day, h, m).getTime();
}

function dom(dataset: QuietDom["dataset"] = {}): QuietDom {
  return { dataset };
}

const prefs = (patch: Partial<NotificationPrefs> = {}): NotificationPrefs => ({
  ...DEFAULT_NOTIFICATION_PREFS,
  ...patch,
});

beforeEach(() => {
  vi.stubGlobal("Date", ShiftedDate);
  setClock(14);
  useNotificationPrefsStore.setState(useNotificationPrefsStore.getInitialState(), true);
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.presenting;
  delete document.documentElement.dataset.intro;
});

describe("getQuietState", () => {
  it("is not quiet on an ordinary route at an ordinary time", () => {
    expect(getQuietState(Date.now(), "/", dom(), prefs())).toEqual({ quiet: false, reason: null });
    expect(getQuietState(Date.now(), "/kanban", null)).toEqual({ quiet: false, reason: null });
  });

  it.each([
    ["/retro", true],
    ["/retro/board-1", true],
    ["/planning-poker", true],
    ["/retrospective-guide", false],
    ["/kanban", false],
  ])("ceremony route %s → quiet %s", (path, quiet) => {
    const state = getQuietState(Date.now(), path, dom(), prefs());
    expect(state.quiet).toBe(quiet);
    if (quiet) expect(state.reason).toBe("ceremony");
  });

  it("reads presenting and intro from the DOM", () => {
    expect(getQuietState(Date.now(), "/", dom({ presenting: "true" }))).toEqual({
      quiet: true,
      reason: "presenting",
    });
    expect(getQuietState(Date.now(), "/", dom({ presenting: "false" })).quiet).toBe(false);
    expect(getQuietState(Date.now(), "/comics", dom({ intro: "poster" }))).toEqual({
      quiet: true,
      reason: "intro",
    });
  });

  it("names the most specific reason first", () => {
    const all = prefs({
      focusUntil: Date.now() + 60_000,
      quietHours: { enabled: true, start: "00:00", end: "23:59" },
    });
    const both = dom({ intro: "book", presenting: "true" });
    expect(getQuietState(Date.now(), "/retro", both, all).reason).toBe("intro");
    expect(getQuietState(Date.now(), "/retro", dom({ presenting: "true" }), all).reason).toBe(
      "presenting"
    );
    expect(getQuietState(Date.now(), "/retro", dom(), all).reason).toBe("ceremony");
    expect(getQuietState(Date.now(), "/", dom(), all).reason).toBe("focus");
    expect(getQuietState(Date.now(), "/", dom(), { ...all, focusUntil: null }).reason).toBe(
      "quiet-hours"
    );
  });

  it("quiet hours wrap past midnight", () => {
    const p = prefs({ quietHours: { enabled: true, start: "22:00", end: "08:00" } });
    const at = (h: number, m = 0, day = 8) => {
      setClock(h, m, day);
      return getQuietState(Date.now(), "/", dom(), p);
    };
    expect(at(21, 59).quiet).toBe(false);
    expect(at(22, 0)).toEqual({ quiet: true, reason: "quiet-hours" });
    expect(at(0, 30, 9)).toEqual({ quiet: true, reason: "quiet-hours" });
    expect(at(7, 59, 9).quiet).toBe(true);
    expect(at(8, 0, 9).quiet).toBe(false);
    // Disabled quiet hours never apply.
    setClock(23);
    expect(getQuietState(Date.now(), "/", dom(), prefs()).quiet).toBe(false);
  });

  it("accepts a Date as well as epoch ms", () => {
    const p = prefs({ quietHours: { enabled: true, start: "22:00", end: "08:00" } });
    setClock(23);
    expect(getQuietState(new Date(), "/", dom(), p).reason).toBe("quiet-hours");
  });

  it("Focus from the store expires on its own", () => {
    setClock(15, 0);
    useNotificationPrefsStore.getState().startFocus(30 * 60_000);
    const quietAt = (h: number, m: number) => {
      setClock(h, m);
      return getQuietState(Date.now(), "/", dom(), getNotificationPrefsSnapshot());
    };
    expect(quietAt(15, 0)).toEqual({ quiet: true, reason: "focus" });
    expect(quietAt(15, 29)).toEqual({ quiet: true, reason: "focus" });
    expect(quietAt(15, 30)).toEqual({ quiet: false, reason: null });
  });

  it("Focus until turned off lasts until endFocus", () => {
    useNotificationPrefsStore.getState().startFocus(null);
    setClock(9, 0, 30);
    expect(getQuietState(Date.now(), "/", dom(), getNotificationPrefsSnapshot()).reason).toBe(
      "focus"
    );
    useNotificationPrefsStore.getState().endFocus();
    expect(getQuietState(Date.now(), "/", dom(), getNotificationPrefsSnapshot()).quiet).toBe(false);
  });

  it("defaultQuietDom reads <html>", () => {
    document.documentElement.dataset.presenting = "true";
    expect(getQuietState(Date.now(), "/", defaultQuietDom()).reason).toBe("presenting");
  });
});

describe("breakpoints", () => {
  it("phones are below Tailwind's sm", () => {
    expect(PHONE_MAX_PX).toBe(639);
    expect(PHONE_MEDIA_QUERY).toBe("(max-width: 639px)");
  });

  it("isPhoneViewport follows matchMedia", () => {
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q === PHONE_MEDIA_QUERY })) as never;
    expect(isPhoneViewport()).toBe(true);
    window.matchMedia = (() => ({ matches: false })) as never;
    expect(isPhoneViewport()).toBe(false);
    window.matchMedia = original;
  });
});
