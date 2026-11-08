import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The `@/lib/utils/toast` wrapper. Its API is imported by ~73 modules and
 * stays exactly as it was: every helper still renders through sonner and
 * returns the toast's id. Since the notification policy, each helper sends
 * its toast through lib/notify (kind → duration, close button, sound,
 * haptic), and feedback goes out only through `emitFeedback` (never the
 * gamification engine) and can never throw out of a helper.
 * `NEXT_PUBLIC_NOTIFY_POLICY=legacy` restores the old pass-through.
 */

const h = vi.hoisted(() => {
  const sonner = Object.assign(
    vi.fn(() => "id-plain"),
    {
      success: vi.fn(() => "id-success"),
      error: vi.fn(() => "id-error"),
      info: vi.fn(() => "id-info"),
      warning: vi.fn(() => "id-warning"),
      message: vi.fn(() => "id-message"),
      loading: vi.fn(() => "id-loading"),
      promise: vi.fn(() => "id-promise"),
      dismiss: vi.fn(),
    }
  );
  return { sonner, emitFeedback: vi.fn() as ReturnType<typeof vi.fn> };
});

vi.mock("sonner", () => ({ toast: h.sonner }));
vi.mock("@/lib/sonification/emit", () => ({ emitFeedback: h.emitFeedback }));

import { toast } from "@/lib/utils/toast";
import { __resetNotifyForTests, __setPolicyContextForTests } from "@/lib/notify/notify";

beforeEach(() => {
  vi.clearAllMocks();
  __resetNotifyForTests();
  __setPolicyContextForTests({
    quiet: { quiet: false, reason: null },
    dialogOpen: false,
    typing: false,
    phone: false,
    touch: false,
  });
  h.emitFeedback.mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** The options a sonner helper was called with. */
function optsOf(fn: { mock: { calls: unknown[][] } }, i = 0): Record<string, unknown> {
  return (fn.mock.calls[i] as unknown[])[1] as Record<string, unknown>;
}

describe("toast wrapper (policy)", () => {
  it.each([
    ["plain", (m: string, o?: object) => toast(m, o), h.sonner, 4000],
    ["success", toast.success, h.sonner.success, 2500],
    ["error", toast.error, h.sonner.error, 7000],
    ["info", toast.info, h.sonner.info, 4000],
    ["warning", toast.warning, h.sonner.warning, 5000],
    ["message", toast.message, h.sonner.message, 4000],
  ] as const)(
    "%s renders through its sonner helper with the kind's duration",
    (_n, fn, target, ms) => {
      const id = fn("Hello", { description: "d" });
      expect(target).toHaveBeenCalledTimes(1);
      const [msg, opts] = target.mock.calls[0] as unknown as [string, Record<string, unknown>];
      expect(msg).toBe("Hello");
      expect(opts).toMatchObject({ description: "d", duration: ms, id });
    }
  );

  it("keeps the caller's id and duration", () => {
    expect(toast.success("Saved", { id: "k1", duration: 1234 })).toBe("k1");
    expect(optsOf(h.sonner.success)).toMatchObject({ id: "k1", duration: 1234 });
  });

  it.each([
    ["error", toast.error, "toast-error", { sound: true, haptics: true }],
    ["warning", toast.warning, "toast-warning", { sound: true, haptics: true }],
    [
      "success",
      toast.success,
      "toast-success",
      { sound: true, haptics: false, soundFullModeOnly: true },
    ],
  ] as const)("%s plays %s through emitFeedback", (_n, fn, ev, fb) => {
    fn("Hello");
    expect(h.emitFeedback).toHaveBeenCalledTimes(1);
    expect(h.emitFeedback).toHaveBeenCalledWith("ui", ev, undefined, expect.objectContaining(fb));
  });

  it("info, message, plain and loading are silent", () => {
    toast("a");
    toast.info("b");
    toast.message("c");
    toast.loading("d");
    expect(h.emitFeedback).not.toHaveBeenCalled();
  });

  it("loading is progress: shown until settled", () => {
    const id = toast.loading("Saving…");
    expect(optsOf(h.sonner.loading)).toMatchObject({
      id,
      duration: Number.POSITIVE_INFINITY,
    });
  });

  it("an explicit kind overrides the helper's", () => {
    toast("Deleted", { kind: "undo", action: { label: "Undo", onClick: () => {} } });
    const opts = optsOf(h.sonner);
    expect(opts).toMatchObject({ duration: 8000, closeButton: true });
    expect(opts).not.toHaveProperty("kind");
  });

  it("dismiss passes straight through without a sound event", () => {
    toast.dismiss("t1");
    expect(h.sonner.dismiss).toHaveBeenCalledWith("t1");
    expect(h.emitFeedback).not.toHaveBeenCalled();
  });

  it("promise passes straight through without a sound event", () => {
    const p = Promise.resolve(1);
    toast.promise(p, { loading: "…", success: "ok", error: "no" });
    expect(h.sonner.promise).toHaveBeenCalledWith(p, { loading: "…", success: "ok", error: "no" });
    expect(h.emitFeedback).not.toHaveBeenCalled();
  });

  it("still shows the toast when sonifying throws", () => {
    h.emitFeedback.mockImplementation(() => {
      throw new Error("audio blocked");
    });
    const id = toast.error("Couldn't save");
    expect(h.sonner.error).toHaveBeenCalledWith("Couldn't save", expect.objectContaining({ id }));
  });

  it("attaches a catch to an async sonify result", () => {
    const thenable = { then: vi.fn(), catch: vi.fn() };
    h.emitFeedback.mockImplementation(() => thenable);
    toast.error("Couldn't save");
    expect(thenable.catch).toHaveBeenCalledTimes(1);
  });
});

describe("toast wrapper (NEXT_PUBLIC_NOTIFY_POLICY=legacy)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_NOTIFY_POLICY", "legacy");
  });

  it.each([
    ["plain", (m: string, o?: object) => toast(m, o), h.sonner, "toast-info", "id-plain"],
    ["success", toast.success, h.sonner.success, "toast-success", "id-success"],
    ["error", toast.error, h.sonner.error, "toast-error", "id-error"],
    ["info", toast.info, h.sonner.info, "toast-info", "id-info"],
    ["warning", toast.warning, h.sonner.warning, "toast-warning", "id-warning"],
    ["message", toast.message, h.sonner.message, "toast-info", "id-message"],
    ["loading", toast.loading, h.sonner.loading, "toast-info", "id-loading"],
  ] as const)(
    "%s forwards unchanged, returns sonner's id and emits %s",
    (_n, fn, target, ev, id) => {
      const opts = { description: "d", id: "k1", duration: 1234 };
      expect(fn("Hello", opts)).toBe(id);
      expect(target).toHaveBeenCalledWith("Hello", opts);
      expect(h.emitFeedback).toHaveBeenCalledTimes(1);
      expect(h.emitFeedback).toHaveBeenCalledWith("ui", ev);
    }
  );

  it("dismiss passes straight through", () => {
    toast.dismiss("t1");
    expect(h.sonner.dismiss).toHaveBeenCalledWith("t1");
  });
});
