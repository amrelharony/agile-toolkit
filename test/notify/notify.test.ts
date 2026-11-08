import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The notification executor: dedupe "(×N)", burst cap, the deferred queue,
 * learned muting and dismissing held toasts. sonner and the feedback call
 * are mocked; the clock moves by swapping Date for a subclass, and fake
 * timers drive only the deferred queue's setTimeout.
 */

type Opts = Record<string, unknown> & {
  id?: string | number;
  onDismiss?: (t: unknown) => void;
  onAutoClose?: (t: unknown) => void;
};

const h = vi.hoisted(() => {
  const sonner = Object.assign(
    vi.fn((_m: unknown, o?: { id?: string | number }) => o?.id ?? "x"),
    {
      success: vi.fn((_m: unknown, o?: { id?: string | number }) => o?.id ?? "x"),
      error: vi.fn((_m: unknown, o?: { id?: string | number }) => o?.id ?? "x"),
      info: vi.fn((_m: unknown, o?: { id?: string | number }) => o?.id ?? "x"),
      warning: vi.fn((_m: unknown, o?: { id?: string | number }) => o?.id ?? "x"),
      message: vi.fn((_m: unknown, o?: { id?: string | number }) => o?.id ?? "x"),
      loading: vi.fn((_m: unknown, o?: { id?: string | number }) => o?.id ?? "x"),
      promise: vi.fn(),
      dismiss: vi.fn(),
    }
  );
  return { sonner, emitFeedback: vi.fn() };
});

vi.mock("sonner", () => ({ toast: h.sonner }));
vi.mock("@/lib/sonification/emit", () => ({ emitFeedback: h.emitFeedback }));

import {
  __resetNotifyForTests,
  __setPolicyContextForTests,
  dismissNotification,
  flushPending,
  notify,
  pendingCount,
  readPolicyContext,
  setNotifyPathname,
} from "@/lib/notify/notify";
import { useNotificationPrefsStore } from "@/lib/stores/notification-prefs-store";
import type { PolicyContext } from "@/lib/notify/types";

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
function advance(ms: number) {
  nowMs += ms;
}

const CALM: Partial<PolicyContext> = {
  quiet: { quiet: false, reason: null },
  dialogOpen: false,
  typing: false,
  phone: false,
  touch: false,
};

function calls(fn: ReturnType<typeof vi.fn>): [unknown, Opts][] {
  return fn.mock.calls as unknown as [unknown, Opts][];
}

beforeEach(() => {
  vi.stubGlobal("Date", ShiftedDate);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.clearAllMocks();
  __resetNotifyForTests();
  __setPolicyContextForTests(CALM);
  useNotificationPrefsStore.setState(useNotificationPrefsStore.getInitialState(), true);
  localStorage.clear();
});

afterEach(() => {
  __resetNotifyForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("dedupe", () => {
  it("three identical errors make one toast: 'x (×3)', one sound", () => {
    const a = notify("error", "x");
    advance(1000);
    const b = notify("error", "x");
    advance(1000);
    const c = notify("error", "x");
    expect(b).toBe(a);
    expect(c).toBe(a);
    const rendered = calls(h.sonner.error);
    expect(rendered.map(([m]) => m)).toEqual(["x", "x (×2)", "x (×3)"]);
    expect(new Set(rendered.map(([, o]) => o.id))).toEqual(new Set([a]));
    expect(h.emitFeedback).toHaveBeenCalledTimes(1);
  });

  it("a repeat after 10 s is a new toast", () => {
    const a = notify("error", "x");
    advance(10_001);
    const b = notify("error", "x");
    expect(b).not.toBe(a);
    expect(calls(h.sonner.error).map(([m]) => m)).toEqual(["x", "x"]);
  });

  it("a repeat after the toast closed is a new toast", () => {
    const a = notify("error", "x");
    calls(h.sonner.error)[0][1].onAutoClose?.({});
    const b = notify("error", "x");
    expect(b).not.toBe(a);
  });

  it("the caller's id is the key, and a new title is an update, not a repeat", () => {
    notify("loading", "Saving…", { id: "save" });
    notify("success", "Saved", { id: "save" });
    expect(calls(h.sonner.loading)[0][1].id).toBe("save");
    expect(calls(h.sonner.success)[0]).toEqual(["Saved", expect.objectContaining({ id: "save" })]);
  });

  it("two Undo toasts with the same label stay separate", () => {
    const opts = { kind: "undo" as const, action: { label: "Undo", onClick: () => {} } };
    const a = notify("plain", "Card deleted", opts);
    const b = notify("plain", "Card deleted", opts);
    expect(b).not.toBe(a);
    expect(calls(h.sonner).map(([m]) => m)).toEqual(["Card deleted", "Card deleted"]);
  });
});

describe("burst cap", () => {
  it("a third success within 10 s replaces the newest", () => {
    const a = notify("success", "one");
    const b = notify("success", "two");
    const c = notify("success", "three");
    expect(a).not.toBe(b);
    expect(c).toBe(b);
    expect(calls(h.sonner.success).map(([m, o]) => [m, o.id])).toEqual([
      ["one", a],
      ["two", b],
      ["three", b],
    ]);
  });

  it("errors, warnings and undo are never limited", () => {
    const ids = new Set(
      ["a", "b", "c", "d"].map((t) => notify("error", t)).concat(notify("warning", "w"))
    );
    expect(ids.size).toBe(5);
  });

  it("the window frees up after 10 s", () => {
    notify("info", "one");
    notify("info", "two");
    advance(10_001);
    const ids = new Set(calls(h.sonner.info).map(([, o]) => o.id));
    notify("info", "three");
    expect(ids.has(calls(h.sonner.info)[2][1].id as string)).toBe(false);
  });
});

describe("deferred queue", () => {
  it("holds a success while typing on a phone, then shows it after at most 3 s", () => {
    __setPolicyContextForTests({ ...CALM, typing: true, phone: true });
    const id = notify("success", "Saved");
    expect(h.sonner.success).not.toHaveBeenCalled();
    expect(pendingCount()).toBe(1);
    advance(3000);
    vi.advanceTimersByTime(3000);
    expect(calls(h.sonner.success)[0]).toEqual(["Saved", expect.objectContaining({ id })]);
    expect(pendingCount()).toBe(0);
  });

  it("holds a success until the dialog closes (≤5 s)", () => {
    __setPolicyContextForTests({ ...CALM, dialogOpen: true });
    notify("success", "Shared");
    advance(1000);
    vi.advanceTimersByTime(1000);
    expect(h.sonner.success).not.toHaveBeenCalled();
    __setPolicyContextForTests(CALM);
    advance(500);
    vi.advanceTimersByTime(500);
    expect(h.sonner.success).toHaveBeenCalledTimes(1);
  });

  it("holds info through the quiet state and shows it on flush", () => {
    __setPolicyContextForTests({ ...CALM, quiet: { quiet: true, reason: "presenting" } });
    notify("info", "Tip");
    advance(60_000);
    vi.advanceTimersByTime(60_000);
    expect(h.sonner.info).not.toHaveBeenCalled();
    __setPolicyContextForTests(CALM);
    flushPending();
    expect(h.sonner.info).toHaveBeenCalledTimes(1);
  });

  it("drops held info after 30 min", () => {
    __setPolicyContextForTests({ ...CALM, quiet: { quiet: true, reason: "focus" } });
    notify("info", "Tip");
    advance(30 * 60_000);
    flushPending();
    expect(pendingCount()).toBe(0);
    __setPolicyContextForTests(CALM);
    flushPending();
    expect(h.sonner.info).not.toHaveBeenCalled();
  });

  it("dismissing a held toast removes it from the queue", () => {
    __setPolicyContextForTests({ ...CALM, dialogOpen: true });
    const id = notify("info", "Back up", { kind: "system" });
    dismissNotification(id);
    expect(pendingCount()).toBe(0);
    expect(h.sonner.dismiss).toHaveBeenCalledWith(id);
  });

  it("a dropped or inline toast still returns an id and renders nothing", () => {
    __setPolicyContextForTests({ ...CALM, quiet: { quiet: true, reason: "ceremony" } });
    expect(notify("success", "Saved")).toBeTruthy();
    __setPolicyContextForTests(CALM);
    expect(notify("success", "Copied", { kind: "echo" })).toBeTruthy();
    expect(h.sonner.success).not.toHaveBeenCalled();
  });

  it("errors show at once whatever is going on", () => {
    __setPolicyContextForTests({
      ...CALM,
      dialogOpen: true,
      typing: true,
      phone: true,
      quiet: { quiet: true, reason: "focus" },
    });
    notify("error", "Couldn't save");
    expect(h.sonner.error).toHaveBeenCalledTimes(1);
    expect(h.emitFeedback).not.toHaveBeenCalled(); // silent while quiet
  });
});

describe("learned muting", () => {
  it("three user dismissals of an info key mute it", () => {
    for (let i = 0; i < 3; i++) {
      notify("info", "Tip");
      const [, o] = calls(h.sonner.info).at(-1)!;
      o.onDismiss?.({});
      advance(11_000);
    }
    expect(useNotificationPrefsStore.getState().mutedKeys).toEqual(["info:Tip"]);
    __setPolicyContextForTests({ ...CALM, mutedKeys: ["info:Tip"] });
    notify("info", "Tip");
    expect(h.sonner.info).toHaveBeenCalledTimes(3);
  });

  it("our own dismissals don't count, and errors are never muted", () => {
    for (let i = 0; i < 3; i++) {
      const id = notify("info", "Tip");
      dismissNotification(id);
      calls(h.sonner.info).at(-1)![1].onDismiss?.({});
      notify("error", "Boom");
      calls(h.sonner.error).at(-1)![1].onDismiss?.({});
      advance(11_000);
    }
    expect(useNotificationPrefsStore.getState().mutedKeys).toEqual([]);
  });

  it("keeps the caller's onDismiss and onAutoClose", () => {
    const onDismiss = vi.fn();
    const onAutoClose = vi.fn();
    notify("plain", "Deleted", { kind: "undo", onDismiss, onAutoClose });
    const [, o] = calls(h.sonner)[0];
    o.onDismiss?.({});
    o.onAutoClose?.({});
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onAutoClose).toHaveBeenCalledTimes(1);
  });
});

describe("context", () => {
  it("reads the quiet state from the reported route", () => {
    __setPolicyContextForTests(null);
    setNotifyPathname("/retro");
    expect(readPolicyContext().quiet).toEqual({ quiet: true, reason: "ceremony" });
    setNotifyPathname("/");
    expect(readPolicyContext().quiet.quiet).toBe(false);
  });

  it("sees an open dialog", () => {
    __setPolicyContextForTests(null);
    const el = document.createElement("div");
    el.setAttribute("role", "dialog");
    el.setAttribute("data-state", "open");
    document.body.appendChild(el);
    expect(readPolicyContext().dialogOpen).toBe(true);
    el.remove();
    expect(readPolicyContext().dialogOpen).toBe(false);
  });
});
