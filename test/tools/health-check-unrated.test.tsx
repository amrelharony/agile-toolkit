import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { HEALTH_CHECK_DIMENSIONS } from "@/lib/stores/workspace-types";

/**
 * Health check: a new check starts unrated (no "Health 100%", Save locked
 * until every dimension is rated), and "Clear All" asks first.
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

import { HealthCheckClient } from "@/app/(tools)/health-check/health-check-client";

beforeEach(() => {
  useWorkspaceStore.setState({ healthChecks: [] });
});

const score = () => screen.getByTestId("health-check-score");
const saveButton = () => screen.getByRole("button", { name: "Save Check" });

describe("Health check starts unrated", () => {
  it("shows no score and no active light, and locks Save with a reason", () => {
    render(<HealthCheckClient />);
    expect(score()).toHaveTextContent("Health: —");
    expect(score()).not.toHaveTextContent("100%");
    expect(
      screen.queryAllByRole("button", { pressed: true, name: /^(Green|Yellow|Red)$/ })
    ).toHaveLength(0);
    // Trends are not ratings: each dimension starts on "Same".
    expect(screen.getAllByRole("button", { pressed: true, name: "Same" })).toHaveLength(8);
    expect(saveButton()).toBeDisabled();
    expect(saveButton()).toHaveAccessibleDescription(/Rate all 8 dimensions .*0 of 8 rated/);
  });

  it("scores rated dimensions only and saves once all are rated", () => {
    render(<HealthCheckClient />);
    const greens = screen.getAllByRole("button", { name: /Green/ });
    const reds = screen.getAllByRole("button", { name: /Red/ });

    fireEvent.click(greens[0]);
    fireEvent.click(reds[1]);
    expect(score()).toHaveTextContent("50%");
    expect(saveButton()).toBeDisabled();

    greens.slice(2).forEach((b) => fireEvent.click(b));
    expect(saveButton()).toBeEnabled();
    fireEvent.click(saveButton());

    const doc = useWorkspaceStore.getState().healthChecks?.[0];
    expect(doc?.history).toHaveLength(1);
    expect(doc?.history[0].scores[HEALTH_CHECK_DIMENSIONS[1]].light).toBe("red");
    // The next check starts unrated again.
    expect(score()).toHaveTextContent("Health: —");
    expect(saveButton()).toBeDisabled();
  });
});

describe("Health check Clear All", () => {
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
    render(<HealthCheckClient />);
    fireEvent.click(screen.getByRole("button", { name: "Clear All" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Delete all 2 saved health checks?");
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear history" }));
    expect(useWorkspaceStore.getState().healthChecks?.[0].history).toHaveLength(0);
  });
});
