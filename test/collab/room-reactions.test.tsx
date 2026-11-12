import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

/**
 * The reaction bar and the band reactions rise through: six named buttons,
 * an emoji per reaction with no name, decorative and click-through, and
 * still (no rise) under reduced motion.
 */

import { ReactionBar, ReactionLayer } from "@/components/collab/room-reactions";
import type { FloatingReaction } from "@/lib/realtime/room-reactions";

const REACTIONS: FloatingReaction[] = [
  { key: "a", r: 0, lane: 0.25, at: 0 },
  { key: "b", r: 2, lane: 0.75, at: 0 },
];

function setReducedMotion(on: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: on && query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

afterEach(() => {
  delete (window as { matchMedia?: unknown }).matchMedia;
});

describe("ReactionBar", () => {
  it("offers six reactions, each a named button sending its index", () => {
    const onReact = vi.fn();
    render(<ReactionBar onReact={onReact} />);
    const group = screen.getByRole("group", { name: "Send a reaction" });
    const buttons = within(group).getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "React: Thumbs up",
      "React: Applause",
      "React: Laugh",
      "React: Wow",
      "React: Love it",
      "React: Hmm",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "React: Wow" }));
    expect(onReact).toHaveBeenCalledWith(3);
  });

  it("is disabled while the room isn't open", () => {
    render(<ReactionBar onReact={() => {}} disabled />);
    for (const b of screen.getAllByRole("button")) expect(b).toBeDisabled();
  });
});

describe("ReactionLayer", () => {
  it("draws each reaction's emoji in a decorative, click-through band", () => {
    setReducedMotion(false);
    const { container } = render(<ReactionLayer reactions={REACTIONS} />);
    const band = container.querySelector("[data-reaction-layer]")!;
    expect(band).toHaveAttribute("aria-hidden", "true");
    expect(band).toHaveClass("pointer-events-none", "absolute", "overflow-hidden");
    expect(band.textContent).toBe("👍😂");
    const first = band.querySelector("[data-reaction]") as HTMLElement;
    expect(first.style.left).toBe("25%");
  });

  it("shows them still under reduced motion, spread up the band instead of rising", () => {
    setReducedMotion(true);
    const { container } = render(<ReactionLayer reactions={REACTIONS} />);
    const spans = Array.from(container.querySelectorAll("[data-reaction]")) as HTMLElement[];
    expect(spans).toHaveLength(2);
    expect(spans.map((s) => s.style.bottom)).toEqual(["13%", "38%"]);
    for (const s of spans) {
      expect(s.style.transform).toBe("");
      expect(s).toHaveClass("-translate-x-1/2");
    }
  });
});
