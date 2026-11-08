import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, fireEvent, render, renderHook } from "@testing-library/react";
import { useOpenedOnce } from "@/hooks/use-opened-once";
import { useCommandPaletteShortcut } from "@/components/layout/use-command-palette-shortcut";

/**
 * Every page pays for what the app shell imports statically: it's in the
 * first download and it all hydrates before the page responds. These stay
 * behind next/dynamic and mount only when something needs them.
 */
const SHELL = "src/components/layout/app-shell.tsx";
const DEFERRED = [
  "./command-palette",
  "@/components/layout/command-palette",
  "@/components/gamification/trophy-case",
  "@/lib/holiday/engine",
  "@/components/ai/llm-settings-dialog",
];

function staticImports(file: string): string[] {
  const src = readFileSync(path.join(process.cwd(), file), "utf8");
  return Array.from(src.matchAll(/^import[^;]*?from\s+["']([^"']+)["']/gm)).map((m) => m[1]);
}

describe("the app shell's first download", () => {
  it.each(DEFERRED)("does not statically import %s", (spec) => {
    expect(staticImports(SHELL)).not.toContain(spec);
  });

  it("loads them with next/dynamic instead", () => {
    const src = readFileSync(path.join(process.cwd(), SHELL), "utf8");
    for (const spec of ["./command-palette", "@/components/gamification/trophy-case"]) {
      expect(src).toContain(`import("${spec}")`);
    }
    expect(src).toContain('import("@/lib/holiday/engine")');
  });

  it("leaves the palette's own file without a second Ctrl/Cmd+K listener", () => {
    // Two listeners would toggle it open and shut on one key press.
    const src = readFileSync(
      path.join(process.cwd(), "src/components/layout/command-palette.tsx"),
      "utf8"
    );
    expect(src).not.toMatch(/addEventListener\(\s*["']keydown["']/);
  });
});

describe("useOpenedOnce", () => {
  it("is false until the first open, then stays true", () => {
    const { result, rerender } = renderHook(({ open }) => useOpenedOnce(open), {
      initialProps: { open: false },
    });
    expect(result.current).toBe(false);
    rerender({ open: true });
    expect(result.current).toBe(true);
    rerender({ open: false });
    expect(result.current).toBe(true);
  });

  it("is true from the first render when it starts open", () => {
    const { result } = renderHook(() => useOpenedOnce(true));
    expect(result.current).toBe(true);
  });
});

describe("useCommandPaletteShortcut", () => {
  function Probe({ toggle }: { toggle: () => void }) {
    useCommandPaletteShortcut(toggle);
    return null;
  }

  it.each([
    [{ key: "k", ctrlKey: true }],
    [{ key: "k", metaKey: true }],
    [{ key: "K", ctrlKey: true }],
    [{ key: "л", code: "KeyK", ctrlKey: true }],
  ])("toggles on %o and keeps the browser's own shortcut out", (init) => {
    const toggle = vi.fn();
    render(<Probe toggle={toggle} />);
    const event = new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true });
    act(() => {
      document.dispatchEvent(event);
    });
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("ignores K without a modifier, other keys, and keydowns with no key", () => {
    const toggle = vi.fn();
    render(<Probe toggle={toggle} />);
    fireEvent.keyDown(document, { key: "k" });
    fireEvent.keyDown(document, { key: "j", ctrlKey: true });
    // Autofill fires keydowns that carry no key.
    document.dispatchEvent(new Event("keydown"));
    expect(toggle).not.toHaveBeenCalled();
  });

  it("stops listening when the shell unmounts", () => {
    const toggle = vi.fn();
    const { unmount } = render(<Probe toggle={toggle} />);
    unmount();
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(toggle).not.toHaveBeenCalled();
  });
});
