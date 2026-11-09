import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

/**
 * A toast's action (Undo, View…) and cancel buttons are sonner's compact
 * 24 px / 12 px button by default. Undo is the only way back from a delete,
 * so on touch screens both get a 44 px target and 14 px text; mouse and
 * trackpad keep the compact button.
 */

vi.mock("@/lib/sonification/emit", () => ({ emitUiEvent: () => undefined }));

import { Toaster } from "@/components/ui/sonner";
import { undoable } from "@/lib/utils/undoable";

const TOUCH = [
  "pointer-coarse:min-h-11",
  "pointer-coarse:min-w-11",
  // Sonner's own button rule ties with a group-[.toast]: class and is
  // injected after the app's CSS, so these two must be !important.
  "pointer-coarse:!px-4",
  "pointer-coarse:!text-sm",
];

/** Utilities that change a button's box or text size. */
const SIZE_UTILITY =
  /^(?:(?:min-|max-)?[hw]|size|p[xytrblse]?|leading)-|^text-(?:xs|sm|base|lg|\d*xl|\[\d[^\]]*\])$/;

/**
 * True for a sizing class that would also apply to a mouse: any variant chain
 * (`group-[.toast]:`, `hover:`…) is stripped before matching, along with the
 * `!` modifier, and only a chain that includes `pointer-coarse` counts as
 * touch-only.
 */
function sizesForMouse(cls: string): boolean {
  const parts = cls.split(":");
  const utility = parts.pop()!.replace(/^!/, "");
  return SIZE_UTILITY.test(utility) && !parts.includes("pointer-coarse");
}

function classes(el: HTMLElement): string[] {
  return el.className.split(/\s+/).filter(Boolean);
}

afterEach(() => {
  act(() => {
    toast.dismiss();
  });
});

describe("sizesForMouse", () => {
  // Guards the guard: the desktop test below is only as good as this matcher.
  it.each([
    "text-sm",
    "!text-sm",
    "text-xs",
    "text-[13px]",
    "min-h-11",
    "!px-4",
    "group-[.toast]:min-h-11",
    "group-[.toast]:px-4",
    "group-[.toast]:!text-sm",
    "hover:h-8",
    "size-11",
  ])("flags %s, which would resize the button for a mouse", (cls) => {
    expect(sizesForMouse(cls)).toBe(true);
  });

  it.each([
    "pointer-coarse:min-h-11",
    "pointer-coarse:!px-4",
    "pointer-coarse:!text-sm",
    "group-[.toast]:pointer-coarse:min-w-11",
    "group-[.toast]:text-primary-foreground",
    "group-[.toast]:bg-primary",
    "text-muted-foreground",
  ])("lets %s through", (cls) => {
    expect(sizesForMouse(cls)).toBe(false);
  });
});

describe("Toaster buttons", () => {
  it("gives the action and cancel buttons a touch-sized target", async () => {
    render(<Toaster />);
    act(() => {
      toast("Deleted “Late standups”", {
        action: { label: "Undo", onClick: () => {} },
        cancel: { label: "Keep", onClick: () => {} },
      });
    });

    const action = await screen.findByRole("button", { name: "Undo" });
    const cancel = await screen.findByRole("button", { name: "Keep" });
    for (const button of [action, cancel]) {
      expect(classes(button)).toEqual(expect.arrayContaining(TOUCH));
    }
    // The colours stay as they were.
    expect(classes(action)).toEqual(
      expect.arrayContaining([
        "group-[.toast]:bg-primary",
        "group-[.toast]:text-primary-foreground",
      ])
    );
    expect(classes(cancel)).toEqual(
      expect.arrayContaining(["group-[.toast]:bg-muted", "group-[.toast]:text-muted-foreground"])
    );
  });

  it("only resizes on a coarse pointer, so the desktop button is unchanged", async () => {
    render(<Toaster />);
    act(() => {
      toast("Moved to Done", {
        action: { label: "View", onClick: () => {} },
        cancel: { label: "Dismiss", onClick: () => {} },
      });
    });

    for (const name of ["View", "Dismiss"]) {
      const button = await screen.findByRole("button", { name });
      const unscoped = classes(button).filter(sizesForMouse);
      expect(unscoped).toEqual([]);
    }
  });

  it("applies to the Undo button undoable() shows after a delete", async () => {
    render(<Toaster />);
    const revert = vi.fn();
    act(() => {
      undoable({ label: "Deleted “Rotate the release captain”", apply: () => {}, revert });
    });

    const undo = await screen.findByRole("button", { name: "Undo" });
    expect(classes(undo)).toEqual(expect.arrayContaining(TOUCH));
    act(() => {
      undo.click();
    });
    expect(revert).toHaveBeenCalledTimes(1);
  });
});
