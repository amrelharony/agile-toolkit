import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the `@/lib/utils/toast` wrapper. Its API is imported by
 * ~73 modules and must stay exactly as it is through the notification
 * redesign: every helper forwards to sonner unchanged and returns sonner's id,
 * and each one sonifies through a UI event that can never throw out of it.
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
  return { sonner, emitUiEvent: vi.fn() as ReturnType<typeof vi.fn> };
});

vi.mock("sonner", () => ({ toast: h.sonner }));
vi.mock("@/lib/sonification/emit", () => ({ emitUiEvent: h.emitUiEvent }));

import { toast } from "@/lib/utils/toast";

beforeEach(() => {
  vi.clearAllMocks();
  h.emitUiEvent.mockImplementation(() => undefined);
});

describe("toast wrapper", () => {
  it.each([
    ["plain", (m: string, o?: object) => toast(m, o), h.sonner, "toast-info", "id-plain"],
    ["success", toast.success, h.sonner.success, "toast-success", "id-success"],
    ["error", toast.error, h.sonner.error, "toast-error", "id-error"],
    ["info", toast.info, h.sonner.info, "toast-info", "id-info"],
    ["warning", toast.warning, h.sonner.warning, "toast-warning", "id-warning"],
    ["message", toast.message, h.sonner.message, "toast-info", "id-message"],
  ] as const)("%s forwards to sonner, returns its id and emits %s", (_n, fn, target, ev, id) => {
    const opts = { description: "d", id: "k1", duration: 1234 };
    expect(fn("Hello", opts)).toBe(id);
    expect(target).toHaveBeenCalledWith("Hello", opts);
    expect(h.emitUiEvent).toHaveBeenCalledTimes(1);
    expect(h.emitUiEvent).toHaveBeenCalledWith(ev);
  });

  it("loading forwards and emits toast-info", () => {
    expect(toast.loading("Saving…")).toBe("id-loading");
    expect(h.sonner.loading).toHaveBeenCalledWith("Saving…", undefined);
    expect(h.emitUiEvent).toHaveBeenCalledWith("toast-info");
  });

  it("dismiss and promise pass straight through without sonifying", () => {
    toast.dismiss("t1");
    expect(h.sonner.dismiss).toHaveBeenCalledWith("t1");
    const p = Promise.resolve(1);
    toast.promise(p, { loading: "…", success: "ok", error: "no" });
    expect(h.sonner.promise).toHaveBeenCalledWith(p, { loading: "…", success: "ok", error: "no" });
    expect(h.emitUiEvent).not.toHaveBeenCalled();
  });

  it("still shows the toast when sonifying throws", () => {
    h.emitUiEvent.mockImplementation(() => {
      throw new Error("audio blocked");
    });
    expect(toast.error("Couldn't save")).toBe("id-error");
    expect(h.sonner.error).toHaveBeenCalledWith("Couldn't save", undefined);
  });

  it("swallows an async sonify rejection", async () => {
    const rejected = Promise.reject(new Error("haptics import failed"));
    h.emitUiEvent.mockImplementation(() => rejected);
    expect(toast.success("Saved")).toBe("id-success");
    // Let the rejection settle; an unhandled one would fail the run.
    await rejected.catch(() => {});
    await Promise.resolve();
  });
});
