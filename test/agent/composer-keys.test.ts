/**
 * The message box's keys (design 1.3 item 8): bare Enter sends only with a
 * fine pointer, Ctrl/Cmd+Enter always sends, Shift+Enter and a touch
 * screen's Enter make a new line, nothing sends while an input method is
 * composing, and a sending key held down sends once, its repeats ignored.
 */

import { describe, expect, it } from "vitest";
import { composerKey, type ComposerKeyPress, type PointerKind } from "@/lib/agent/composer-keys";

const enter = (extra: Partial<ComposerKeyPress> = {}): ComposerKeyPress => ({
  key: "Enter",
  isComposing: false,
  keyCode: 13,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  repeat: false,
  ...extra,
});

const POINTERS: readonly PointerKind[] = ["fine", "coarse"];

describe("composerKey", () => {
  it("sends on a bare Enter with a mouse or a trackpad", () => {
    expect(composerKey(enter(), "fine")).toBe("send");
  });

  it("makes a new line on a bare Enter on a touch screen, where Send sends", () => {
    expect(composerKey(enter(), "coarse")).toBe("newline");
  });

  it.each(POINTERS)("always sends on Ctrl+Enter and Cmd+Enter (%s pointer)", (pointer) => {
    expect(composerKey(enter({ ctrlKey: true }), pointer)).toBe("send");
    expect(composerKey(enter({ metaKey: true }), pointer)).toBe("send");
    // Shift as well doesn't take the shortcut away.
    expect(composerKey(enter({ ctrlKey: true, shiftKey: true }), pointer)).toBe("send");
    expect(composerKey(enter({ metaKey: true, shiftKey: true }), pointer)).toBe("send");
  });

  it.each(POINTERS)("makes a new line on Shift+Enter (%s pointer)", (pointer) => {
    expect(composerKey(enter({ shiftKey: true }), pointer)).toBe("newline");
  });

  it.each(POINTERS)("sends nothing while an input method is composing (%s pointer)", (pointer) => {
    for (const press of [
      enter({ isComposing: true }),
      enter({ isComposing: true, ctrlKey: true }),
      enter({ isComposing: true, metaKey: true }),
      enter({ isComposing: true, shiftKey: true }),
    ]) {
      expect(composerKey(press, pointer)).toBeNull();
    }
  });

  it.each(POINTERS)(
    "sends nothing for keyCode 229, Safari's Enter that ends a composition (%s pointer)",
    (pointer) => {
      expect(composerKey(enter({ keyCode: 229 }), pointer)).toBeNull();
      expect(composerKey(enter({ keyCode: 229, ctrlKey: true }), pointer)).toBeNull();
      // Some keyboards report the key itself as "Process" with 229.
      expect(composerKey({ key: "Process", keyCode: 229 }, pointer)).toBeNull();
    }
  );

  it("sends once for a held key: its repeats are ignored, neither sent nor typed as new lines", () => {
    expect(composerKey(enter({ repeat: true }), "fine")).toBe("ignore");
    expect(composerKey(enter({ repeat: true, ctrlKey: true }), "coarse")).toBe("ignore");
    expect(composerKey(enter({ repeat: true, metaKey: true }), "fine")).toBe("ignore");
  });

  it("keeps a held new line a new line", () => {
    expect(composerKey(enter({ repeat: true, shiftKey: true }), "fine")).toBe("newline");
    expect(composerKey(enter({ repeat: true }), "coarse")).toBe("newline");
  });

  it.each(POINTERS)("leaves every other key alone (%s pointer)", (pointer) => {
    for (const key of ["a", " ", "Tab", "Escape", "ArrowUp", "Backspace"]) {
      expect(composerKey({ key }, pointer)).toBeNull();
      expect(composerKey({ key, ctrlKey: true }, pointer)).toBeNull();
    }
  });

  it("reads a DOM KeyboardEvent as it comes", () => {
    const press = new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true });
    expect(composerKey(press, "coarse")).toBe("send");
    const composing = new KeyboardEvent("keydown", { key: "Enter", isComposing: true });
    expect(composerKey(composing, "fine")).toBeNull();
  });

  it("needs only the key: a press with no modifier fields is a bare one", () => {
    expect(composerKey({ key: "Enter" }, "fine")).toBe("send");
    expect(composerKey({ key: "Enter" }, "coarse")).toBe("newline");
  });
});
