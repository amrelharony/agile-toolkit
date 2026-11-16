/**
 * The rail's right edge, for Amr (end-to-end check of the chat revamp): from
 * md the rail is in the page flow and paints over fixed things at the left
 * edge, so Amr, his panel, his bubble and the moment chip in a left corner
 * stood under it. The sidebar now keeps its right edge on <html> as
 * --app-rail (lib/layout/amr-sheet), as it pins, widens under a mouse or
 * meets a notch, and says so on the document each time; below md, while it
 * isn't drawn, and once it is gone, the variable is not there. jsdom has no
 * layout: the aside's box follows its width class here, and the
 * ResizeObserver is a stand-in that reports when told to.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/retro",
  useRouter: () => ({ push: () => {} }),
}));
vi.mock("@/lib/tools/tool-prefs", () => ({
  useToolPrefs: () => ({
    favorites: [],
    recent: [],
    showAllTools: false,
    isFavorite: () => false,
    toggleFavorite: () => {},
    recordUse: () => {},
    setShowAllTools: () => {},
  }),
}));
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {} }));

import { Sidebar } from "@/components/layout/sidebar";
import { APP_RAIL_EVENT, APP_RAIL_VAR } from "@/lib/layout/amr-sheet";

/** The ResizeObservers the sidebar made, and what each one watches. */
const observers: StubObserver[] = [];
class StubObserver {
  targets: { el: Element; options?: ResizeObserverOptions }[] = [];
  disconnected = false;
  constructor(private readonly callback: ResizeObserverCallback) {
    observers.push(this);
  }
  observe(el: Element, options?: ResizeObserverOptions) {
    this.targets.push({ el, options });
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
  /** The box it watches changed (a width transition's frame, a pin, a notch). */
  fire() {
    act(() => this.callback([], this as unknown as ResizeObserver));
  }
}

/** Whether the page is md and wider, as the sidebar's media query reads it. */
let desktop = true;
/** A notch's inset on the left: the rail grows by it (pl-safe and its width). */
let notch = 0;
/** The rail is drawn (presentation mode hides the app's chrome). */
let drawn = true;

const aside = () => screen.getByRole("complementary", { name: "Primary navigation" });
const rail = () => document.documentElement.style.getPropertyValue(APP_RAIL_VAR);
const latest = () => observers[observers.length - 1];

beforeEach(() => {
  window.localStorage.clear();
  observers.length = 0;
  desktop = true;
  notch = 0;
  drawn = true;
  vi.stubGlobal("ResizeObserver", StubObserver);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("min-width: 768px") ? desktop : false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
  // The aside's box as its width class lays it out: 4rem as a rail, 16rem
  // open, and the left inset on top of either; nothing while it isn't drawn.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement
  ) {
    const open = (this.getAttribute("class") ?? "").includes("md:w-[calc(16rem");
    const width = !drawn ? 0 : (open ? 256 : 64) + notch;
    return {
      left: 0,
      top: 0,
      width,
      height: drawn ? 768 : 0,
      x: 0,
      y: 0,
      right: width,
      bottom: drawn ? 768 : 0,
      toJSON: () => ({}),
    } as DOMRect;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.documentElement.style.removeProperty(APP_RAIL_VAR);
});

describe("the rail's right edge, kept for Amr from md", () => {
  it("is the rail's 64 px, watched on its border box (its padding holds the notch's inset)", () => {
    render(<Sidebar />);
    expect(observers).toHaveLength(1);
    expect(latest().targets).toEqual([{ el: aside(), options: { box: "border-box" } }]);
    latest().fire();
    expect(rail()).toBe("64px");
  });

  it("follows a hover-expand and its end, telling the document each time", () => {
    const told = vi.fn();
    document.addEventListener(APP_RAIL_EVENT, told);
    try {
      render(<Sidebar />);
      latest().fire();
      expect(rail()).toBe("64px");
      expect(told).toHaveBeenCalledTimes(1);

      // A mouse over the rail: it widens to 256 px (each frame of its
      // transition is a resize the observer reports).
      fireEvent.pointerEnter(aside(), { pointerType: "mouse" });
      expect(aside().className).toContain("md:w-[calc(16rem");
      latest().fire();
      expect(rail()).toBe("256px");
      expect(told).toHaveBeenCalledTimes(2);

      fireEvent.pointerLeave(aside(), { pointerType: "mouse" });
      latest().fire();
      expect(rail()).toBe("64px");
      expect(told).toHaveBeenCalledTimes(3);
    } finally {
      document.removeEventListener(APP_RAIL_EVENT, told);
    }
  });

  it("holds still under a mouse that arrives with a button held (Amr carried past it)", () => {
    render(<Sidebar />);
    latest().fire();
    expect(rail()).toBe("64px");

    // A drag overshooting onto the rail: it stays a rail (its box, and so the
    // edge Amr read when the carry began, is still 64 px as he is dropped).
    fireEvent.pointerEnter(aside(), { pointerType: "mouse", buttons: 1 });
    expect(aside().className).toContain("md:w-[calc(4rem");
    expect(aside().className).not.toContain("md:w-[calc(16rem");
    latest().fire();
    expect(rail()).toBe("64px");

    // With the button let go, the next visit widens it as before.
    fireEvent.pointerLeave(aside(), { pointerType: "mouse" });
    fireEvent.pointerEnter(aside(), { pointerType: "mouse", buttons: 0 });
    expect(aside().className).toContain("md:w-[calc(16rem");
    latest().fire();
    expect(rail()).toBe("256px");
  });

  it("is 256 px pinned open, and follows the chevron back to the rail", () => {
    window.localStorage.setItem("agile-toolkit:sidebar:collapsed:v2", "false");
    render(<Sidebar />);
    latest().fire();
    expect(rail()).toBe("256px");
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    latest().fire();
    expect(rail()).toBe("64px");
  });

  it("counts a notch's inset in once: the rail's own width includes it", () => {
    notch = 47;
    window.localStorage.setItem("agile-toolkit:sidebar:collapsed:v2", "false");
    render(<Sidebar />);
    latest().fire();
    expect(rail()).toBe("303px");
  });

  it("is not there while the rail isn't drawn (presentation mode)", () => {
    render(<Sidebar />);
    latest().fire();
    expect(rail()).toBe("64px");
    drawn = false;
    latest().fire();
    expect(rail()).toBe("");
  });

  it("is taken off when the sidebar goes (a route without the app's chrome)", () => {
    const view = render(<Sidebar />);
    latest().fire();
    expect(rail()).toBe("64px");
    const observer = latest();
    view.unmount();
    expect(rail()).toBe("");
    expect(observer.disconnected).toBe(true);
  });

  it("is never there below md, where the drawer is off the screen", () => {
    desktop = false;
    render(<Sidebar />);
    expect(observers).toHaveLength(0);
    expect(rail()).toBe("");
    // The drawer opening over the page doesn't move Amr either.
    cleanup();
    render(<Sidebar mobileOpen onClose={() => {}} />);
    expect(observers).toHaveLength(0);
    expect(rail()).toBe("");
  });

  it("is not there without a ResizeObserver: Amr keeps the screen's edge", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    render(<Sidebar />);
    expect(rail()).toBe("");
  });
});
