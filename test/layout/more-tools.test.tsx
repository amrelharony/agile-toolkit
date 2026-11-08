import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

const prefs = vi.hoisted(() => ({ showAllTools: false, setShowAllTools: vi.fn() }));

vi.mock("@/lib/tools/tool-prefs", () => ({
  useToolPrefs: () => ({
    favorites: [],
    recent: [],
    showAllTools: prefs.showAllTools,
    isFavorite: () => false,
    toggleFavorite: () => {},
    recordUse: () => {},
    setShowAllTools: prefs.setShowAllTools,
  }),
}));

import { MoreToolsClient } from "@/app/(meta)/more-tools/more-tools-client";

describe("More tools page", () => {
  it("lists every shelved tool under its registry category", () => {
    render(<MoreToolsClient />);
    expect(screen.getByRole("heading", { level: 1, name: "More tools" })).toBeInTheDocument();

    const ai = screen.getByRole("region", { name: /AI \/ LLM Product Management/ });
    expect(within(ai).getByText("Model Card Builder")).toBeInTheDocument();
    expect(within(ai).getAllByRole("link")).toHaveLength(14);

    expect(screen.getByRole("region", { name: /Security & Compliance/ })).toBeInTheDocument();
    // The Scrum core never appears here.
    expect(screen.queryByText("Retro Board")).toBeNull();
    expect(screen.queryByText("Planning Poker")).toBeNull();
  });

  it("offers one switch that shows the shelf everywhere", () => {
    prefs.showAllTools = false;
    render(<MoreToolsClient />);
    const toggle = screen.getByRole("switch", {
      name: "Show these tools in navigation and search",
    });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    expect(prefs.setShowAllTools).toHaveBeenCalledWith(true);
  });

  it("has a chip per category that jumps to its heading", () => {
    const { container } = render(<MoreToolsClient />);
    const nav = screen.getByRole("navigation", { name: "Jump to a category" });
    const chips = within(nav).getAllByRole("link");
    // The sideways scroller is a containing block, so the chips' sr-only
    // counts (position: absolute) can't escape it and widen the page.
    const scroller = nav.querySelector("ul")!;
    expect(scroller).toHaveClass("relative", "overflow-x-auto");
    const headings = Array.from(container.querySelectorAll("section > h2"));
    expect(chips).toHaveLength(headings.length);
    expect(chips.length).toBeGreaterThan(1);

    chips.forEach((chip, i) => {
      const href = chip.getAttribute("href")!;
      expect(href).toMatch(/^#shelf-[a-z0-9-]+$/);
      const target = document.getElementById(href.slice(1));
      // The chip leads to its own category's heading, in page order.
      expect(target).toBe(headings[i]);
      expect(target).toHaveClass("scroll-mt-20");
      expect(chip.textContent).toContain(target!.firstChild!.textContent!);
    });

    const ai = within(nav).getByRole("link", { name: /AI \/ LLM Product Management/ });
    expect(ai).toHaveAccessibleName("AI / LLM Product Management 14 tools");
    // A touch-size chip; the row scrolls sideways instead of widening the page.
    expect(ai).toHaveClass("pointer-coarse:min-h-11", "whitespace-nowrap");
    expect(within(nav).getByRole("list")).toHaveClass("overflow-x-auto");
    // Desktop keeps the page as it was.
    expect(nav).toHaveClass("lg:hidden");
  });

  it("keeps a heading's count in one piece, so 'tools' never wraps alone", () => {
    render(<MoreToolsClient />);
    const ai = screen.getByRole("heading", { level: 2, name: /AI \/ LLM Product Management/ });
    const count = within(ai).getByText("14 tools");
    expect(count).toHaveClass("whitespace-nowrap", "inline-block");
  });

  it("reflects the preference when it is already on", () => {
    prefs.showAllTools = true;
    render(<MoreToolsClient />);
    expect(
      screen.getByRole("switch", { name: "Show these tools in navigation and search" })
    ).toHaveAttribute("aria-checked", "true");
  });
});
