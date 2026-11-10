import { describe, expect, it, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const nav = vi.hoisted(() => ({
  router: { push: (() => {}) as (...args: unknown[]) => void } as {
    push: (...args: unknown[]) => void;
    prefetch?: (...args: unknown[]) => void;
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => nav.router }));
vi.mock("@/lib/tools/tool-prefs", () => ({
  useToolPrefs: () => ({ favorites: [], recent: [] }),
}));

import { CommandPalette } from "@/components/layout/command-palette";
import { getToolById } from "@/lib/constants/tools";
import { notifyRouteCommitted, registerNavigator } from "@/lib/motion/page-transition";
import { skipViewTransition } from "@/lib/motion/view-transition";
import {
  flush,
  installViewTransitions,
  removeViewTransitions,
} from "../motion/fake-view-transitions";

beforeAll(() => {
  // cmdk measures and scrolls items; jsdom implements neither.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
});

beforeEach(() => {
  nav.router = { push: vi.fn(), prefetch: vi.fn() };
});

afterEach(async () => {
  skipViewTransition();
  notifyRouteCommitted("/__test-end");
  await flush();
  cleanup();
  removeViewTransitions();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** The tool path of the highlighted option. */
function highlightedPath(): string {
  const option = screen
    .getAllByRole("option")
    .find((o) => o.getAttribute("aria-selected") === "true");
  expect(option, "an option is highlighted").toBeDefined();
  const id = option!.getAttribute("data-value")!.replace(/^pinned-/, "");
  return getToolById(id)!.path;
}

describe("CommandPalette", () => {
  it("has an accessible name", () => {
    render(<CommandPalette open onOpenChange={() => {}} />);
    expect(screen.getByRole("dialog", { name: "Search tools" })).toBeInTheDocument();
  });

  it("does not list categories that have no visible tools", () => {
    render(<CommandPalette open onOpenChange={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByText("Root Cause Analysis")).toBeNull();
    expect(within(dialog).queryByText("Change Management")).toBeNull();
    expect(within(dialog).getByText("Ceremonies")).toBeInTheDocument();
  });

  it("ranks tools for task-style queries", () => {
    render(<CommandPalette open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "daily scrum" } });
    const options = screen.getAllByRole("option").map((o) => o.textContent ?? "");
    expect(options[0]).toMatch(/Standup/);
  });
});

describe("picking a tool", () => {
  it("still calls the router's push when no transition is possible, and closes", () => {
    const onOpenChange = vi.fn();
    render(<CommandPalette open onOpenChange={onOpenChange} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "daily scrum" } });
    fireEvent.click(screen.getAllByRole("option")[0]);
    expect(nav.router.push).toHaveBeenCalledWith(getToolById("standup")!.path, { scroll: true });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("cross-fades through the registered navigator when it can", async () => {
    const { start } = installViewTransitions();
    const navigator = { push: vi.fn(), replace: vi.fn() };
    const unregister = registerNavigator(navigator);
    try {
      render(<CommandPalette open onOpenChange={() => {}} />);
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "daily scrum" } });
      fireEvent.click(screen.getAllByRole("option")[0]);
      expect(start).toHaveBeenCalledTimes(1);
      await flush();
      expect(navigator.push).toHaveBeenCalledWith(getToolById("standup")!.path, { scroll: true });
      expect(nav.router.push).not.toHaveBeenCalled();
    } finally {
      unregister();
    }
  });
});

describe("loading the highlighted tool ahead", () => {
  it("prefetches it once, with kind auto, after it stays highlighted", async () => {
    vi.useFakeTimers();
    render(<CommandPalette open onOpenChange={() => {}} />);
    await act(async () => {});
    const first = highlightedPath();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(149);
    });
    expect(nav.router.prefetch).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(nav.router.prefetch).toHaveBeenCalledTimes(1);
    expect(nav.router.prefetch).toHaveBeenCalledWith(first, { kind: "auto" });

    // Arrowing on and back: the next tool once, the first not again.
    const box = screen.getByRole("combobox");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    const second = highlightedPath();
    expect(second).not.toBe(first);
    fireEvent.keyDown(box, { key: "ArrowUp" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(highlightedPath()).toBe(first);
    const calls = vi.mocked(nav.router.prefetch!).mock.calls;
    expect(calls.map((c) => c[0])).toEqual([first, second]);
    // Never a bare call (Next defaults that to full) and never full.
    for (const call of calls) expect(call[1]).toEqual({ kind: "auto" });
  });

  it("skips rows passed over quickly", async () => {
    vi.useFakeTimers();
    render(<CommandPalette open onOpenChange={() => {}} />);
    await act(async () => {});
    const box = screen.getByRole("combobox");
    for (let i = 0; i < 4; i++) {
      fireEvent.keyDown(box, { key: "ArrowDown" });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(vi.mocked(nav.router.prefetch!).mock.calls.map((c) => c[0])).toEqual([
      highlightedPath(),
    ]);
  });

  it("throws nothing and logs nothing with a router that has no prefetch", async () => {
    vi.useFakeTimers();
    nav.router = { push: vi.fn() };
    const errors = vi.spyOn(console, "error");
    render(<CommandPalette open onOpenChange={() => {}} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(errors).not.toHaveBeenCalled();
  });

  it("prefetches nothing while closed", async () => {
    vi.useFakeTimers();
    render(<CommandPalette open={false} onOpenChange={() => {}} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(nav.router.prefetch).not.toHaveBeenCalled();
  });
});
