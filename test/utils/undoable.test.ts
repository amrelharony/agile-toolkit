import { beforeEach, describe, expect, it, vi } from "vitest";

const toastSpy = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn() }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));

import { dismissUndoToasts, removeWithUndo, undoable } from "@/lib/utils/undoable";

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

describe("undoable — toast contract (characterization)", () => {
  it("shows the label through the plain toast with an 8 s default and the description", () => {
    toastSpy.mockReturnValueOnce("t1");
    const id = undoable({
      label: "Item deleted",
      description: "From the backlog",
      apply: () => {},
      revert: () => {},
    });
    expect(id).toBe("t1");
    expect(toastSpy).toHaveBeenCalledTimes(1);
    const [label, opts] = toastSpy.mock.calls[0];
    expect(label).toBe("Item deleted");
    expect(opts).toMatchObject({ description: "From the backlog", duration: 8000 });
    expect(typeof opts.onDismiss).toBe("function");
    expect(typeof opts.onAutoClose).toBe("function");
  });

  it("honours a custom duration", () => {
    undoable({ label: "Cleared", apply: () => {}, revert: () => {}, durationMs: 12_000 });
    expect(toastSpy.mock.calls[0][1].duration).toBe(12_000);
  });

  it("applies before the toast appears, and a manual dismiss forgets the toast", () => {
    // Clear toasts earlier tests left open in the module-level set.
    dismissUndoToasts();
    toastSpy.dismiss.mockReset();
    const order: string[] = [];
    toastSpy.mockImplementationOnce(() => {
      order.push("toast");
      return "t9";
    });
    undoable({ label: "Deleted", apply: () => order.push("apply"), revert: () => {} });
    expect(order).toEqual(["apply", "toast"]);

    toastSpy.mock.calls[0][1].onDismiss();
    dismissUndoToasts();
    expect(toastSpy.dismiss).not.toHaveBeenCalled();
  });
});

describe("removeWithUndo", () => {
  /** A functional setter over a plain variable, like a useState setter. */
  function listState<T>(initial: T[]) {
    const state = { list: initial };
    const update = (fn: (list: readonly T[]) => T[]) => {
      state.list = fn(state.list);
    };
    return { state, update };
  }

  it("removes the matching items and Undo puts them back where they were", () => {
    const { state, update } = listState(["a", "b", "c", "d"]);
    removeWithUndo({ label: "Deleted b and d", update, match: (x) => x === "b" || x === "d" });
    expect(state.list).toEqual(["a", "c"]);

    toastSpy.mock.calls[0][1].action.onClick();
    expect(state.list).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps an edit made to another item before Undo", () => {
    const { state, update } = listState([
      { id: 1, v: "x" },
      { id: 2, v: "y" },
      { id: 3, v: "z" },
    ]);
    removeWithUndo({ label: "Deleted 2", update, match: (x) => x.id === 2 });
    // Item 3 edited while the toast is up.
    update((list) => list.map((x) => (x.id === 3 ? { ...x, v: "edited" } : x)));

    toastSpy.mock.calls[0][1].action.onClick();
    expect(state.list).toEqual([
      { id: 1, v: "x" },
      { id: 2, v: "y" },
      { id: 3, v: "edited" },
    ]);
  });

  it("survives an updater that runs twice (React StrictMode)", () => {
    const state = { list: ["a", "b"] };
    const update = (fn: (list: readonly string[]) => string[]) => {
      fn(state.list);
      state.list = fn(state.list);
    };
    removeWithUndo({ label: "Deleted b", update, match: (x) => x === "b" });
    toastSpy.mock.calls[0][1].action.onClick();
    expect(state.list).toEqual(["a", "b"]);
  });

  it("puts a removed last item back at the end when the list has shrunk", () => {
    const { state, update } = listState(["a", "b", "c"]);
    removeWithUndo({ label: "Deleted c", update, match: (x) => x === "c" });
    update(() => ["a"]);
    toastSpy.mock.calls[0][1].action.onClick();
    expect(state.list).toEqual(["a", "c"]);
  });
});
