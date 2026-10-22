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

  it("reflects the preference when it is already on", () => {
    prefs.showAllTools = true;
    render(<MoreToolsClient />);
    expect(
      screen.getByRole("switch", { name: "Show these tools in navigation and search" })
    ).toHaveAttribute("aria-checked", "true");
  });
});
