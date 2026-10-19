import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Tech Radar: the quadrant key under the radar sits in the same corner each
 * quadrant's blips are drawn in (it used to list Languages & Frameworks
 * top-left while drawing them top-right), and every blip carries a visible
 * number that matches the ring lists.
 */

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: () => null,
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

import { TechRadarClient } from "@/app/(tools)/tech-radar/tech-radar-client";

const CENTER = 150;
const blip = (id: string, name: string, quadrant: string) => ({
  id,
  name,
  ring: "trial",
  quadrant,
  movedAt: "2026-01-01T00:00:00.000Z",
});
const BLIPS = [
  blip("b-lang", "TypeScript", "languages_frameworks"),
  blip("b-tools", "Vitest", "tools"),
  blip("b-plat", "Postgres", "platforms"),
  blip("b-tech", "Pairing", "techniques"),
];
const LABEL: Record<string, string> = {
  languages_frameworks: "Languages & Frameworks",
  tools: "Tools",
  platforms: "Platforms",
  techniques: "Techniques",
};

beforeEach(() => {
  localStorage.setItem("agile-toolkit:tech-radar", JSON.stringify(BLIPS));
});

function cornerOf(g: Element): string {
  const c = g.querySelector("circle")!;
  const x = Number(c.getAttribute("cx"));
  const y = Number(c.getAttribute("cy"));
  return `${y < CENTER ? "top" : "bottom"}-${x < CENTER ? "left" : "right"}`;
}

describe("Tech Radar quadrant key", () => {
  it("names each quadrant in the corner its blips are drawn in", () => {
    const { container } = render(<TechRadarClient />);
    for (const b of BLIPS) {
      const g = container.querySelector(`g[data-blip-id="${b.id}"]`)!;
      expect(g, b.name).not.toBeNull();
      const cell = container.querySelector(`li[data-corner="${cornerOf(g)}"]`)!;
      expect(cell.textContent, b.name).toContain(LABEL[b.quadrant]);
    }
  });

  it("lays the key out top-left, top-right, bottom-left, bottom-right", () => {
    render(<TechRadarClient />);
    const key = screen.getByRole("list", { name: "Quadrants by position on the radar" });
    const cells = within(key).getAllByRole("listitem");
    expect(cells.map((c) => c.getAttribute("data-corner"))).toEqual([
      "top-left",
      "top-right",
      "bottom-left",
      "bottom-right",
    ]);
    // Drawing order: languages top-right, tools bottom-right, platforms
    // bottom-left, techniques top-left.
    expect(cells.map((c) => c.textContent)).toEqual([
      expect.stringContaining("Techniques"),
      expect.stringContaining("Languages & Frameworks"),
      expect.stringContaining("Platforms"),
      expect.stringContaining("Tools"),
    ]);
  });
});

describe("Tech Radar blip labels", () => {
  it("draws a visible number on each blip that matches the ring list", () => {
    const { container } = render(<TechRadarClient />);
    BLIPS.forEach((b, i) => {
      const g = container.querySelector(`g[data-blip-id="${b.id}"]`)!;
      expect(g.querySelector("text")?.textContent).toBe(String(i + 1));
      expect(g.querySelector("title")?.textContent).toBe(`${i + 1}. ${b.name} — trial`);
    });
    // The Trial list shows the same numbers next to the names.
    const row = screen.getByText("Vitest").closest(".rounded-md")!;
    expect(row.textContent).toMatch(/^2Vitest/);
  });
});
