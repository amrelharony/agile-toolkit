import { describe, expect, it, vi } from "vitest";

const toastSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));

import { undoable } from "@/lib/utils/undoable";

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
});
