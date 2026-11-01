import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { MATURITY_DIMENSIONS } from "@/lib/constants/maturity-model";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * Maturity: the overall badge uses the same level labels as the dimension
 * pickers (Initial / Developing / Defined / Managed / Optimizing). It used
 * a second set (Ad-hoc / Emerging / Developing / Proficient / Optimizing),
 * so an all-3 team read "Developing" overall while every dimension said
 * "3 — Defined". The overall percentage runs 0-100% from all 1s to all 5s.
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
// Recharts' ResponsiveContainer needs it; jsdom doesn't ship one.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { MaturityClient } from "@/app/(tools)/maturity/maturity-client";

const renderPage = () =>
  render(
    <TooltipProvider>
      <MaturityClient />
    </TooltipProvider>
  );

// A saved assessment: only a saved one gives the team a level.
const seed = (scores: Record<string, number>) =>
  useWorkspaceStore.setState({
    maturityAssessments: [
      {
        id: "maturity:current",
        scores: {},
        targetLevel: 4,
        history: [{ id: "a1", assessedAt: "2026-10-01", scores }],
      },
    ],
  });

beforeEach(() => {
  useWorkspaceStore.setState({ maturityAssessments: [] });
});

describe("Maturity overall label", () => {
  it("names an all-3 team Defined, like its dimensions, at 50%", () => {
    seed(Object.fromEntries(MATURITY_DIMENSIONS.map((d) => [d.id, 3])));
    renderPage();
    expect(screen.getAllByText("50%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Level 3 · Defined").length).toBeGreaterThan(0);
    // Every dimension's picker names level 3 the same way.
    expect(screen.getAllByRole("radio", { name: "3 Defined" })).toHaveLength(
      MATURITY_DIMENSIONS.length
    );
    expect(screen.queryByText(/· Developing/)).toBeNull();
  });

  it("never shows the old band names", () => {
    const [first, ...rest] = MATURITY_DIMENSIONS;
    // one dimension at 5, the rest at 1: average 1.5, 13%
    seed({ [first.id]: 5, ...Object.fromEntries(rest.map((d) => [d.id, 1])) });
    renderPage();
    expect(screen.getAllByText("Level 2 · Developing").length).toBeGreaterThan(0);
    expect(screen.getAllByText("13%").length).toBeGreaterThan(0);
    for (const old of ["Ad-hoc", "Emerging", "Proficient"]) {
      expect(screen.queryByText(old)).toBeNull();
    }
  });
});
