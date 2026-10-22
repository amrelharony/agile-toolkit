import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

// The visitor's "Show all tools" preference, flipped by the tests below.
const prefs = vi.hoisted(() => ({ showAllTools: false }));

vi.mock("@/lib/tools/tool-prefs", () => ({
  useToolPrefs: () => ({
    favorites: [],
    recent: [],
    showAllTools: prefs.showAllTools,
    isFavorite: () => false,
    toggleFavorite: () => {},
    recordUse: () => {},
    setShowAllTools: (on: boolean) => {
      prefs.showAllTools = on;
    },
  }),
}));

// GSAP scroll reveal has nothing to measure in jsdom.
vi.mock("@/components/shared/mood-reveal", () => ({
  MoodReveal: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

import { ToolSections } from "@/components/home/tool-sections";

describe("home tool sections", () => {
  it("leaves out a section whose tools are all on the shelf", () => {
    prefs.showAllTools = false;
    render(<ToolSections />);
    expect(screen.getByText("Run the sprint")).toBeInTheDocument();
    expect(screen.getByText("Retrospect & improve")).toBeInTheDocument();
    expect(screen.queryByText("AI product management")).toBeNull();
  });

  it("lists the shelf once Show all tools is on", () => {
    prefs.showAllTools = true;
    render(<ToolSections />);
    const ai = screen.getByText("AI product management").closest("summary");
    expect(ai).not.toBeNull();
    expect(ai?.textContent).toMatch(/14 tools$/);
  });

  it("counts only the visible tools in a mixed section", () => {
    prefs.showAllTools = false;
    const { unmount } = render(<ToolSections />);
    // "Quality & risk" keeps risk, debt and the quality trackers; the SRE and
    // security tools are shelved.
    const quality = screen.getByText("Quality & risk").closest("summary");
    expect(quality?.textContent).toMatch(/6 tools$/);
    unmount();

    prefs.showAllTools = true;
    render(<ToolSections />);
    const all = screen.getByText("Quality & risk").closest("summary");
    expect(all?.textContent).toMatch(/16 tools$/);
  });
});
