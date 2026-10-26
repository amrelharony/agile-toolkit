import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { HEALTH_CHECK_DIMENSIONS, type HealthCheck } from "@/lib/stores/workspace-types";
import { emptyHealthCheck, withRating } from "@/lib/health-check/score";

/**
 * Health check: "Load an example" shows three saved checks and a rated
 * check in progress as a read-only preview (nothing reaches the
 * workspace), "Clear example" goes back to the team's own check, an older
 * build's example rows can still be cleared, and the checks export as
 * Markdown with yellow counting half.
 */

vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { apply: () => void }) => a.apply(),
  removeWithUndo: () => undefined,
}));
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
vi.mock("@/app/(tools)/health-check/charts", () => ({ HealthTrendChart: () => null }));
// Recharts' ResponsiveContainer needs it; jsdom doesn't ship one.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { HealthCheckClient } from "@/app/(tools)/health-check/health-check-client";
import { buildExample } from "@/app/(tools)/health-check/example";
import { toMarkdown } from "@/app/(tools)/health-check/markdown";

const NOW = new Date(2026, 9, 18);
const notice = () => screen.queryByText("Example data.");
const score = () => screen.getByTestId("health-check-score");
const allGreen = Object.fromEntries(
  HEALTH_CHECK_DIMENSIONS.map((d) => [d, { light: "green", trend: "same" }])
) as never;
const renderPage = () =>
  render(
    <TooltipProvider>
      <HealthCheckClient />
    </TooltipProvider>
  );

beforeEach(() => {
  useWorkspaceStore.setState({ healthChecks: [], sprints: [] });
});

describe("Health check Markdown", () => {
  it("shows the check in progress per dimension, then the history side by side", () => {
    const md = toMarkdown(buildExample(NOW), { now: NOW, includeExamples: true });
    expect(md).toMatch(/^# Squad Health Check — 18 Oct 2026\n/);
    expect(md).toContain("## Current check: Sprint 15");
    expect(md).toContain("**Health:** 72% (green 1, yellow ½, red 0; all 9 dimensions rated)");
    expect(md).toContain("| Dimension | Status | Trend | Votes (G/Y/R) | Note |");
    expect(md).toContain(
      "| Easy to Release | 🟢 Green | ↑ Up | 6/1/0 | The new pipeline ships every merge to staging. |"
    );
    expect(md).toContain("## History");
    expect(md).toContain(
      "| Dimension | Sprint 12 (2026-09-06) | Sprint 13 (2026-09-20) | Sprint 14 (2026-10-04) |"
    );
    expect(md).toContain("| Easy to Release | 🔴 Red | 🔴 Red | 🟡 Yellow |");
    // Yellow counts half: 4 green and 4 yellow of 9 is 67%, not the old 50%.
    expect(md).toContain("| **Health** | **67%** | **61%** | **50%** |");
  });

  it("marks the dimensions not rated yet", () => {
    const d = withRating(emptyHealthCheck(), "Fun", "yellow");
    const md = toMarkdown(d, { now: NOW });
    expect(md).toContain("**Health:** 50% (green 1, yellow ½, red 0; 1 of 8 rated so far)");
    expect(md).toContain("| Fun | 🟡 Yellow | First check | — | — |");
    expect(md).toContain("| Teamwork | Not rated | — | — | — |");
    expect(md).not.toContain("## History");
  });

  it("escapes pipes in sprint names", () => {
    const d: HealthCheck = {
      ...withRating(emptyHealthCheck(), "Fun", "green"),
      history: [{ id: "h1", sprintName: "S1 | patch", date: "2026-10-01", scores: allGreen }],
    };
    d.current.sprintName = "S2 | hotfix";
    const md = toMarkdown(d, { now: NOW });
    expect(md).toContain("## Current check: S2 \\| hotfix");
    expect(md).toContain("| Dimension | S1 \\| patch (2026-10-01) |");
  });

  it("says there are no checks yet", () => {
    expect(toMarkdown(emptyHealthCheck(), { now: NOW })).toBe(
      "# Squad Health Check — 18 Oct 2026\n\nNo health checks yet.\n"
    );
  });
});

describe("Health check example", () => {
  it("previews without writing, and Clear example goes back to a blank tool", () => {
    renderPage();
    expect(notice()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(notice()).toBeInTheDocument();
    expect(useWorkspaceStore.getState().healthChecks).toEqual([]);
    // Every example dimension is rated, greens included.
    expect(score()).toHaveTextContent("72%");
    expect(screen.getAllByText("Sprint 14").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(notice()).toBeNull();
    expect(score()).toHaveTextContent("—");
    expect(screen.getByRole("button", { name: "Load an example" })).toBeInTheDocument();
  });

  it("keeps the team's own check in progress while the example shows", () => {
    useWorkspaceStore.setState({ healthChecks: [withRating(emptyHealthCheck(), "Fun", "red")] });
    renderPage();
    // Something is rated, so the tool isn't blank: no example on offer.
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();
    expect(score()).toHaveTextContent("0%");
  });

  it("clears an older build's example checks from the workspace, keeping the team's own", () => {
    useWorkspaceStore.setState({
      healthChecks: [
        {
          ...emptyHealthCheck(),
          history: [
            {
              id: "example-check-1",
              sprintName: "Sprint 12",
              date: "2026-09-06",
              scores: allGreen,
            },
            { id: "h1", sprintName: "S1", date: "2026-10-01", scores: allGreen },
          ],
        },
      ],
    });
    renderPage();
    expect(notice()).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(useWorkspaceStore.getState().healthChecks?.[0].history.map((h) => h.id)).toEqual(["h1"]);
    expect(notice()).toBeNull();
  });

  it("doesn't offer the example once there are saved checks", () => {
    useWorkspaceStore.setState({
      healthChecks: [
        {
          ...emptyHealthCheck(),
          history: [{ id: "h1", sprintName: "S1", date: "2026-10-01", scores: allGreen }],
        },
      ],
    });
    renderPage();
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();
    expect(notice()).toBeNull();
  });
});
