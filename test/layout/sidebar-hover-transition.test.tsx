/**
 * The rail during a page change. Collapsing the hover-opened rail while the
 * browser holds the old picture would swap a wide rail for a thin one in the
 * middle of the cross-fade, so a pointer-leave during a running change waits
 * for it to end, and collapses only if the pointer has not come back. The
 * open phone menu is a zone whose links change pages instantly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: () => {} }),
}));
vi.mock("@/lib/tools/tool-prefs", () => ({
  useToolPrefs: () => ({ favorites: [], recent: [] }),
}));
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {} }));

import { Sidebar } from "@/components/layout/sidebar";
import {
  isPageTransitionRunning,
  notifyRouteCommitted,
  pushWithTransition,
  registerNavigator,
} from "@/lib/motion/page-transition";
import { skipViewTransition } from "@/lib/motion/view-transition";
import {
  flush,
  installViewTransitions,
  removeViewTransitions,
} from "../motion/fake-view-transitions";

const WIDE = "md:w-[calc(16rem+env(safe-area-inset-left))]";
const RAIL = "md:w-[calc(4rem+env(safe-area-inset-left))]";

const aside = () => screen.getByRole("complementary", { name: "Primary navigation" });
const classes = () => (aside().getAttribute("class") ?? "").split(/\s+/);

let unregister = () => {};

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
  unregister = registerNavigator({ push: vi.fn(), replace: vi.fn() });
});

afterEach(async () => {
  skipViewTransition();
  notifyRouteCommitted("/__test-end");
  await flush();
  unregister();
  cleanup();
  removeViewTransitions();
});

/** Opens the collapsed rail by mouse hover, then starts a page change. */
async function hoverThenChange() {
  const browser = installViewTransitions();
  render(<Sidebar />);
  expect(classes()).toContain(RAIL);
  fireEvent.pointerEnter(aside(), { pointerType: "mouse" });
  expect(classes()).toContain(WIDE);
  expect(pushWithTransition("/kanban")).toBe(true);
  await flush();
  expect(isPageTransitionRunning()).toBe(true);
  return browser;
}

async function finish(made: { endAnimation: () => void }[]) {
  await act(async () => {
    notifyRouteCommitted("/kanban");
    await flush();
    made[0].endAnimation();
    await flush();
  });
  expect(isPageTransitionRunning()).toBe(false);
}

describe("the hover-opened rail during a page change", () => {
  it("does not collapse on a pointer-leave while the change runs", async () => {
    await hoverThenChange();
    fireEvent.pointerLeave(aside(), { pointerType: "mouse" });
    expect(classes()).toContain(WIDE);
  });

  it("collapses once the change ends, when the pointer has left", async () => {
    const { made } = await hoverThenChange();
    fireEvent.pointerLeave(aside(), { pointerType: "mouse" });
    await finish(made);
    expect(classes()).toContain(RAIL);
  });

  it("stays open after the change when the pointer came back", async () => {
    const { made } = await hoverThenChange();
    fireEvent.pointerLeave(aside(), { pointerType: "mouse" });
    fireEvent.pointerEnter(aside(), { pointerType: "mouse" });
    await finish(made);
    expect(classes()).toContain(WIDE);
  });

  it("collapses at once when no change runs, as before", () => {
    render(<Sidebar />);
    fireEvent.pointerEnter(aside(), { pointerType: "mouse" });
    expect(classes()).toContain(WIDE);
    fireEvent.pointerLeave(aside(), { pointerType: "mouse" });
    expect(classes()).toContain(RAIL);
  });

  it("collapses after a change that hit the cap", async () => {
    vi.useFakeTimers();
    try {
      await hoverThenChange();
      fireEvent.pointerLeave(aside(), { pointerType: "mouse" });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(150);
      });
      expect(isPageTransitionRunning()).toBe(false);
      expect(classes()).toContain(RAIL);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the phone menu", () => {
  it("is a data-vt-instant zone only while open", () => {
    const { rerender } = render(<Sidebar mobileOpen={false} />);
    expect(aside()).not.toHaveAttribute("data-vt-instant");
    rerender(<Sidebar mobileOpen />);
    expect(aside()).toHaveAttribute("data-vt-instant", "");
    rerender(<Sidebar mobileOpen={false} />);
    expect(aside()).not.toHaveAttribute("data-vt-instant");
  });

  it("changes pages instantly from a link in the open menu", () => {
    const { start } = installViewTransitions();
    render(<Sidebar mobileOpen onClose={() => {}} />);
    const link = screen.getByRole("link", { name: "Sprint" });
    // Left to next/link and the browser; jsdom's own navigation is stopped after.
    let reached = false;
    const stop = (e: Event) => {
      reached = !e.defaultPrevented;
      e.preventDefault();
    };
    window.addEventListener("click", stop);
    fireEvent.click(link);
    window.removeEventListener("click", stop);
    expect(reached).toBe(true);
    expect(start).not.toHaveBeenCalled();
  });
});
