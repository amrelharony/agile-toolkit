import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { MATURITY_DIMENSIONS } from "@/lib/constants/maturity-model";

/**
 * Maturity: the overall badge uses the same level labels as the dimension
 * sliders (Initial / Developing / Defined / Managed / Optimizing). It used
 * a second set (Ad-hoc / Emerging / Developing / Proficient / Optimizing),
 * so an all-3 team read "Developing" overall while every slider said
 * "3 — Defined".
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

const seed = (scores: Record<string, number>) =>
  useWorkspaceStore.setState({
    maturityAssessments: [{ id: "maturity:current", scores, targetLevel: 4 }],
  });

beforeEach(() => {
  useWorkspaceStore.setState({ maturityAssessments: [] });
});

describe("Maturity overall label", () => {
  it("names an all-3 team Defined, like its sliders", () => {
    seed(Object.fromEntries(MATURITY_DIMENSIONS.map((d) => [d.id, 3])));
    render(<MaturityClient />);
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.getByText("Level 3 · Defined")).toBeInTheDocument();
    expect(screen.getAllByText("3 — Defined")).toHaveLength(MATURITY_DIMENSIONS.length);
    // "Developing" only appears in the radar key, as level 2.
    expect(screen.queryByText(/· Developing/)).toBeNull();
  });

  it("never shows the old band names", () => {
    const [first, ...rest] = MATURITY_DIMENSIONS;
    // one dimension at 5, the rest at 1: average 1.5, 30%
    seed({ [first.id]: 5, ...Object.fromEntries(rest.map((d) => [d.id, 1])) });
    render(<MaturityClient />);
    expect(screen.getByText("Level 2 · Developing")).toBeInTheDocument();
    for (const old of ["Ad-hoc", "Emerging", "Proficient"]) {
      expect(screen.queryByText(old)).toBeNull();
    }
  });
});
