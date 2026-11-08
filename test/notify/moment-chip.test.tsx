import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MomentChip, momentChipPosition } from "@/components/notify/moment-chip";
import {
  CHIP_MS,
  __resetMomentsForTests,
  previewMoment,
  useMomentStore,
} from "@/lib/notify/moment-scheduler";
import { useActivityUiStore } from "@/lib/stores/activity-ui-store";
import { useMascotStore } from "@/lib/agent/mascot/store";
import { PHONE_MEDIA_QUERY } from "@/lib/layout/breakpoints";

/**
 * The moment chip beside Amr: its copy, the ~4 s fade (held while hovered),
 * tap → Activity, X and swipe to dismiss, its place by Amr's corner on
 * phones and desktop, and no animation under reduced motion.
 */

const h = vi.hoisted(() => ({ phone: false }));

beforeAll(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === PHONE_MEDIA_QUERY ? h.phone : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
});

beforeEach(() => {
  h.phone = false;
  __resetMomentsForTests();
  useActivityUiStore.setState({ activityOpen: false, trophyOpen: false });
  useMascotStore.getState().reset();
});

afterEach(() => {
  vi.useRealTimers();
});

function show(): void {
  act(() => {
    useMomentStore.setState({
      current: {
        id: "m1",
        title: "Level 8",
        kind: "level-up",
        rarity: "rare",
        icon: "TrendingUp",
        at: Date.now(),
      },
    });
  });
}

describe("MomentChip", () => {
  it("keeps an empty live region between moments, so the chip is announced when it appears", () => {
    render(<MomentChip />);
    const region = screen.getByRole("status");
    expect(region).toBeEmptyDOMElement();
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region.className).toContain("pointer-events-none");
    show();
    // The same node now holds the chip (not a freshly inserted region).
    expect(screen.getByRole("status")).toBe(region);
    expect(region).toHaveTextContent("Level 8 · tap to see");
  });

  it("reads 'Level 8 · tap to see' as a status, and fades after about 4 s", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    render(<MomentChip />);
    show();
    const chip = screen.getByRole("status");
    expect(chip).toHaveTextContent("Level 8 · tap to see");
    act(() => vi.advanceTimersByTime(CHIP_MS - 1));
    expect(chip).not.toBeEmptyDOMElement();
    act(() => vi.advanceTimersByTime(1));
    expect(chip).toBeEmptyDOMElement();
  });

  it("stays while the pointer is on it", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    render(<MomentChip />);
    show();
    const tap = screen.getByRole("button", { name: /tap to see/ });
    fireEvent.pointerEnter(tap);
    act(() => vi.advanceTimersByTime(CHIP_MS * 3));
    expect(screen.getByRole("status")).not.toBeEmptyDOMElement();
    fireEvent.pointerLeave(tap);
    act(() => vi.advanceTimersByTime(CHIP_MS));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("a tap opens Activity and closes the chip", () => {
    render(<MomentChip />);
    show();
    fireEvent.click(screen.getByRole("button", { name: /Level 8 · tap to see/ }));
    expect(useActivityUiStore.getState().activityOpen).toBe(true);
    expect(useMomentStore.getState().current).toBeNull();
  });

  it("the X (44 px) closes it without opening Activity", () => {
    render(<MomentChip />);
    show();
    const x = screen.getByRole("button", { name: "Dismiss" });
    expect(x.className).toContain("h-11");
    expect(x.className).toContain("w-11");
    fireEvent.click(x);
    expect(useMomentStore.getState().current).toBeNull();
    expect(useActivityUiStore.getState().activityOpen).toBe(false);
  });

  it("a sideways swipe closes it; a tap-sized move doesn't", () => {
    render(<MomentChip />);
    show();
    const chip = screen.getByRole("button", { name: /tap to see/ });
    fireEvent.pointerDown(chip, { clientX: 100 });
    fireEvent.pointerUp(chip, { clientX: 110 });
    expect(useMomentStore.getState().current).not.toBeNull();
    fireEvent.pointerDown(chip, { clientX: 100 });
    fireEvent.pointerUp(chip, { clientX: 160 });
    expect(useMomentStore.getState().current).toBeNull();
  });

  it("has no animation under reduced motion and never exceeds the screen", () => {
    render(<MomentChip />);
    show();
    const cls = document.querySelector("[data-moment-chip]")!.className;
    expect(cls).toContain("motion-reduce:animate-none");
    expect(cls).toMatch(/motion-safe:animate-in/);
    expect(cls).not.toMatch(/(?<!motion-safe:)animate-in/);
    const region = screen.getByRole("status").className;
    expect(region).toContain("max-w-[min(18rem,calc(100vw-32px))]");
    expect(region).toContain("z-[55]");
  });

  it("phones: just above Amr's band on his side", () => {
    h.phone = true;
    useMascotStore.getState().setCorner("bottomLeft");
    render(<MomentChip />);
    show();
    const style = screen.getByRole("status").style;
    expect(style.position).toBe("fixed");
    expect(style.bottom).toContain("--amr-band-bottom");
    expect(style.left).toBe("16px");
  });

  it("previewMoment() shows it", () => {
    render(<MomentChip />);
    act(() => previewMoment());
    expect(screen.getByRole("status")).toHaveTextContent("Level 8 · tap to see");
  });
});

describe("momentChipPosition", () => {
  it.each([
    ["bottomRight", true, { right: 16 }, "bottom", "--amr-band-bottom"],
    ["topRight", true, { right: 16 }, "top", "--amr-band-top"],
    ["bottomLeft", false, { left: 156 }, "bottom", null],
    ["topLeft", false, { left: 156 }, "top", "--header-h"],
  ] as const)("%s (phone %s)", (corner, phone, side, edge, variable) => {
    const pos = momentChipPosition(corner, phone) as Record<string, unknown>;
    expect(pos).toMatchObject(side);
    expect(pos[edge]).toBeDefined();
    expect(pos[edge === "top" ? "bottom" : "top"]).toBeUndefined();
    if (variable) expect(String(pos[edge])).toContain(variable);
  });
});
