import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

// Stateful stand-in for the cloud-persisted prefs hook.
vi.mock("@/lib/tools/tool-prefs", () => ({
  useToolPrefs: () => {
    const [favorites, setFavorites] = useState<string[]>([]);
    return {
      favorites,
      recent: [],
      isFavorite: (id: string) => favorites.includes(id),
      toggleFavorite: (id: string) =>
        setFavorites((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id])),
      recordUse: () => {},
    };
  },
}));

import { ToolCard } from "@/components/shared/tool-card";

describe("ToolCard", () => {
  it("keeps the favourite toggle outside the card link (no nested interactive)", () => {
    render(
      <ToolCard
        href="/retro"
        icon={<span>R</span>}
        title="Retrospective"
        description="Run a retro"
        tags={["team"]}
        toolId="retro"
      />
    );
    const link = screen.getByRole("link", { name: "Retrospective" });
    expect(link).toHaveAttribute("href", "/retro");
    const star = screen.getByRole("button", { name: "Add Retrospective to favorites" });
    expect(star).toHaveAttribute("aria-pressed", "false");
    expect(link.contains(star)).toBe(false);
    expect(star.closest("a")).toBeNull();

    fireEvent.click(star);
    expect(
      screen.getByRole("button", { name: "Remove Retrospective from favorites" })
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("renders no favourite toggle without a toolId", () => {
    render(<ToolCard href="/x" icon={null} title="X" description="d" />);
    expect(screen.getByRole("link", { name: "X" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
