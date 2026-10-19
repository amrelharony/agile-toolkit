import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

const prefs = vi.hoisted(() => ({
  favorites: [] as string[],
  recent: [] as { id: string; usedAt: number }[],
}));
vi.mock("@/lib/tools/tool-prefs", () => ({
  useToolPrefs: () => ({
    favorites: prefs.favorites,
    recent: prefs.recent,
    isFavorite: (id: string) => prefs.favorites.includes(id),
    toggleFavorite: () => {},
    recordUse: () => {},
  }),
}));
vi.mock("@/components/shared/mood-reveal", () => ({
  MoodReveal: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {}, emitUiEvent: () => {} }));

import { ToolSections } from "@/components/home/tool-sections";
import { ContinueSection } from "@/components/home/continue-section";
import { SECTIONS } from "@/lib/constants/sections";

describe("home: tools by job", () => {
  it("lists the job sections and renders a section's cards only once it is opened", () => {
    const { container } = render(<ToolSections />);
    const summaries = Array.from(container.querySelectorAll("summary")).map((s) => s.textContent);
    for (const s of SECTIONS.filter((x) => x.id !== "library")) {
      expect(summaries.some((t) => t?.includes(s.label))).toBe(true);
    }
    expect(screen.queryByRole("link", { name: "WSJF Calculator" })).toBeNull();

    const prioritize = Array.from(container.querySelectorAll("details")).find((d) =>
      d.querySelector("summary")?.textContent?.includes("Prioritize & decide")
    )!;
    prioritize.open = true;
    fireEvent(prioritize, new Event("toggle"));
    expect(screen.getByRole("link", { name: "WSJF Calculator" })).toHaveAttribute("href", "/wsjf");
  });
});

describe("home: continue where you left off", () => {
  it("is hidden on a first visit", () => {
    prefs.favorites = [];
    prefs.recent = [];
    const { container } = render(<ContinueSection />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows recent tools and favorites for returning visitors", () => {
    prefs.recent = [{ id: "retro", usedAt: Date.now() - 2 * 60 * 60 * 1000 }];
    prefs.favorites = ["wsjf"];
    render(<ContinueSection />);
    expect(
      screen.getByRole("heading", { name: "Continue where you left off" })
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Retro Board.*2 h ago/ })).toHaveAttribute(
      "href",
      "/retro"
    );
    expect(screen.getByRole("link", { name: /WSJF Calculator/ })).toHaveAttribute("href", "/wsjf");
  });
});
