import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { HEALTH_CHECK_DIMENSIONS } from "@/lib/stores/workspace-types";

/**
 * Health check: a new check starts unrated (no "Health 100%", Save refused
 * with the dimensions still to rate), the ratings live in the stored draft
 * (a reload keeps them, greens included), and "Clear all" asks first.
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

beforeEach(() => {
  useWorkspaceStore.setState({ healthChecks: [], sprints: [] });
});

const renderPage = () =>
  render(
    <TooltipProvider>
      <HealthCheckClient />
    </TooltipProvider>
  );
const score = () => screen.getByTestId("health-check-score");
const saveButton = () => screen.getByRole("button", { name: "Save check" });
const light = (dim: string, l: string) =>
  within(screen.getByRole("group", { name: new RegExp(`^${dim} status`) })).getByRole("button", {
    name: l,
  });

describe("Health check starts unrated", () => {
  it("shows no score and no active light, and refuses to save with the reason", () => {
    renderPage();
    expect(score()).toHaveTextContent("Health: —");
    expect(score()).not.toHaveTextContent("100%");
    expect(
      screen.queryAllByRole("button", { pressed: true, name: /^(Green|Yellow|Red)$/ })
    ).toHaveLength(0);
    // No trend to pick: it is derived.
    expect(screen.queryAllByRole("button", { name: "Same" })).toHaveLength(0);
    expect(screen.getByText(/0 of 8 dimensions rated/)).toBeInTheDocument();
    fireEvent.click(saveButton());
    expect(screen.getByRole("alert")).toHaveTextContent(/Rate these 8 dimensions before saving/);
    expect(useWorkspaceStore.getState().healthChecks?.[0]?.history ?? []).toHaveLength(0);
  });

  it("scores rated dimensions only, keeps greens rated after a reload, and saves once all are rated", () => {
    const { unmount } = renderPage();
    fireEvent.click(light(HEALTH_CHECK_DIMENSIONS[0], "Green"));
    fireEvent.click(light(HEALTH_CHECK_DIMENSIONS[1], "Red"));
    expect(score()).toHaveTextContent("50%");

    // A remount (a reload) still has both, the green included.
    unmount();
    renderPage();
    expect(score()).toHaveTextContent("50%");
    expect(light(HEALTH_CHECK_DIMENSIONS[0], "Green")).toHaveAttribute("aria-pressed", "true");

    HEALTH_CHECK_DIMENSIONS.slice(2).forEach((d) => fireEvent.click(light(d, "Green")));
    fireEvent.click(saveButton());

    const doc = useWorkspaceStore.getState().healthChecks?.[0];
    expect(doc?.history).toHaveLength(1);
    expect(doc?.history[0].scores[HEALTH_CHECK_DIMENSIONS[1]].light).toBe("red");
    // The next check starts unrated again.
    expect(score()).toHaveTextContent("Health: —");
  });
});

describe("Health check Clear all", () => {
  it("confirms with the saved-check count", () => {
    const scores = Object.fromEntries(
      HEALTH_CHECK_DIMENSIONS.map((d) => [d, { light: "green", trend: "same" }])
    ) as never;
    useWorkspaceStore.setState({
      healthChecks: [
        {
          id: "healthCheck:current",
          current: { sprintName: "", scores },
          history: [
            { id: "h1", sprintName: "S1", date: "2026-10-01", scores },
            { id: "h2", sprintName: "S2", date: "2026-10-08", scores },
          ],
        },
      ],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Delete all 2 saved health checks?");
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear history" }));
    expect(useWorkspaceStore.getState().healthChecks?.[0].history).toHaveLength(0);
  });
});
