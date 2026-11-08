import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What `emit()` hands to the gamification engine. Tool events always go to
 * the ledger; `ui` and `mascot` events never do (clicks, hovers, keystrokes,
 * toasts, mascot taps); `rt`
 * events only for `sync-remote`, which `sync-first` needs. `emitFeedback()`
 * and the toast wrapper play sound and haptics but never reach the engine.
 */

const h = vi.hoisted(() => ({
  ingestEvent: vi.fn(),
  fireFromEvent: vi.fn(),
}));

vi.mock("@/lib/gamification/ledger", () => ({ ingestEvent: h.ingestEvent }));
vi.mock("@/lib/haptics/engine", () => ({ fireFromEvent: h.fireFromEvent }));
vi.mock("sonner", () => {
  const t = Object.assign(
    vi.fn(() => "id"),
    {
      success: vi.fn(() => "id"),
      error: vi.fn(() => "id"),
      info: vi.fn(() => "id"),
      warning: vi.fn(() => "id"),
      message: vi.fn(() => "id"),
      loading: vi.fn(() => "id"),
      promise: vi.fn(() => "id"),
      dismiss: vi.fn(),
    }
  );
  return { toast: t };
});

import {
  emit,
  emitFeedback,
  emitRtEvent,
  emitUiEvent,
  shouldForwardToGamification,
} from "@/lib/sonification/emit";
import { toast } from "@/lib/utils/toast";

/** Let the lazy `import()` inside emit settle. */
async function settle() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  h.ingestEvent.mockClear();
  h.fireFromEvent.mockClear();
});

describe("shouldForwardToGamification", () => {
  it.each([
    ["retro", "card-add", true],
    ["ceremony-timer", "finish", true],
    ["ui", "click-default", false],
    ["ui", "hover-button", false],
    ["ui", "keystroke", false],
    ["ui", "toast-success", false],
    ["ui", "state-open", false],
    ["mascot", "click", false],
    ["mascot", "wiggle", false],
    ["rt", "sync-remote", true],
    ["rt", "member-join", false],
    ["rt", "member-leave", false],
    ["rt", "room-connected", false],
  ] as const)("%s:%s → %s", (tool, event, expected) => {
    expect(shouldForwardToGamification(tool, event)).toBe(expected);
  });
});

describe("emit", () => {
  it("forwards tool events to the ledger as tool:<id>:<event>", async () => {
    emit("retro", "card-add");
    await settle();
    expect(h.ingestEvent).toHaveBeenCalledWith("tool:retro:card-add", {
      toolId: "retro",
      eventName: "card-add",
    });
    expect(h.fireFromEvent).toHaveBeenCalledWith("retro", "card-add", null);
  });

  it("never forwards ui events, but still plays their haptics", async () => {
    emit("ui", "click-default");
    emit("ui", "keystroke");
    emitUiEvent("hover-button");
    await settle();
    expect(h.ingestEvent).not.toHaveBeenCalled();
    expect(h.fireFromEvent).toHaveBeenCalledTimes(3);
  });

  it("never forwards mascot taps, reactions or mood changes", async () => {
    emit("mascot", "click");
    emit("mascot", "wiggle");
    await settle();
    expect(h.ingestEvent).not.toHaveBeenCalled();
    expect(h.fireFromEvent).toHaveBeenCalledTimes(2);
  });

  it("forwards only sync-remote among rt events, under its bare name", async () => {
    emitRtEvent("member-join");
    emitRtEvent("room-connected");
    emitRtEvent("sync-remote");
    await settle();
    expect(h.ingestEvent).toHaveBeenCalledTimes(1);
    expect(h.ingestEvent).toHaveBeenCalledWith("sync-remote", {
      toolId: "rt",
      eventName: "sync-remote",
    });
    expect(h.fireFromEvent).toHaveBeenCalledTimes(3);
  });
});

describe("emitFeedback", () => {
  it("plays haptics for a tool event without reaching the engine", async () => {
    const el = document.createElement("button");
    emitFeedback("retro", "card-add", el);
    await settle();
    expect(h.fireFromEvent).toHaveBeenCalledWith("retro", "card-add", el);
    expect(h.ingestEvent).not.toHaveBeenCalled();
  });
});

describe("toasts are feedback only", () => {
  it("toast helpers never reach the engine; only error and warning vibrate", async () => {
    toast("a");
    toast.success("b");
    toast.error("c");
    toast.info("d");
    toast.warning("e");
    toast.message("f");
    toast.loading("g");
    await settle();
    expect(h.ingestEvent).not.toHaveBeenCalled();
    // The toast policy (lib/notify/policy.ts): a success plays its chord but
    // no haptic, info and progress are silent.
    expect(h.fireFromEvent).toHaveBeenCalledWith("ui", "toast-error", null);
    expect(h.fireFromEvent).toHaveBeenCalledWith("ui", "toast-warning", null);
    expect(h.fireFromEvent).toHaveBeenCalledTimes(2);
  });
});
