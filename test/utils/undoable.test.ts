import { beforeEach, describe, expect, it, vi } from "vitest";

const toastSpy = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn() }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));

import { dismissUndoToasts, undoable } from "@/lib/utils/undoable";

beforeEach(() => {
  toastSpy.mockReset();
  toastSpy.dismiss.mockReset();
});

describe("undoable", () => {
  it("applies the change and offers a one-shot Undo", () => {
    let items = ["a", "b"];
    undoable({
      label: "Deleted “b”",
      apply: () => (items = items.filter((i) => i !== "b")),
      revert: () => (items = ["a", "b"]),
    });
    expect(items).toEqual(["a"]);

    const [label, opts] = toastSpy.mock.calls[0];
    expect(label).toBe("Deleted “b”");
    expect(opts.action.label).toBe("Undo");

    opts.action.onClick();
    expect(items).toEqual(["a", "b"]);
    items = ["changed"];
    opts.action.onClick(); // second click ignored
    expect(items).toEqual(["changed"]);
  });

  it("closes open Undo toasts on navigation, but not ones already gone", () => {
    toastSpy.mockReturnValueOnce("t1").mockReturnValueOnce("t2");
    undoable({ label: "Deleted one", apply: () => {}, revert: () => {} });
    undoable({ label: "Deleted two", apply: () => {}, revert: () => {} });
    // The first toast timed out on its own.
    toastSpy.mock.calls[0][1].onAutoClose();

    dismissUndoToasts();
    expect(toastSpy.dismiss.mock.calls).toEqual([["t2"]]);

    dismissUndoToasts();
    expect(toastSpy.dismiss).toHaveBeenCalledTimes(1);
  });
});
