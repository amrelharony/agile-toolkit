import { describe, it, expect, vi } from "vitest";
import { defaultCanvasShortcuts, makeShortcutHandler } from "@/lib/whiteboard/keyboard";

/**
 * Regression: the zoom-in binding "Mod++" was dead. `normalize("Mod++")`
 * split on "+" and dropped the literal "+" key, producing "ctrl+" (empty
 * key) — a combo the keydown handler can never emit. So Ctrl/Cmd+"+" (and
 * the common Ctrl+Shift+"=" chord, which browsers report as the "+" key)
 * never zoomed in. normalize() now preserves a trailing "+" key.
 */

interface MockKey {
  key: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}

function press(handler: (e: KeyboardEvent) => void, k: MockKey) {
  handler({
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...k,
    target: null,
    preventDefault: () => {},
  } as unknown as KeyboardEvent);
}

describe("canvas keyboard shortcuts — zoom chords", () => {
  it("zooms in on Ctrl+=, Ctrl++ (numpad), and Ctrl+Shift+= (reported as '+')", () => {
    const zoomIn = vi.fn();
    const zoomOut = vi.fn();
    const handler = makeShortcutHandler(defaultCanvasShortcuts({ zoomIn, zoomOut }));

    press(handler, { key: "=", ctrlKey: true }); // Ctrl+=
    press(handler, { key: "+", ctrlKey: true }); // Ctrl + numpad "+"
    press(handler, { key: "+", ctrlKey: true, shiftKey: true }); // Ctrl+Shift+= → "+"
    expect(zoomIn).toHaveBeenCalledTimes(3);

    press(handler, { key: "-", ctrlKey: true }); // Ctrl+-
    expect(zoomOut).toHaveBeenCalledTimes(1);
    expect(zoomIn).toHaveBeenCalledTimes(3);
  });

  it("still routes ordinary bindings (no false matches from the '+' fix)", () => {
    const setTool = vi.fn();
    const handler = makeShortcutHandler(defaultCanvasShortcuts({ setTool }));
    press(handler, { key: "v" });
    expect(setTool).toHaveBeenCalledWith("select");
  });
});
