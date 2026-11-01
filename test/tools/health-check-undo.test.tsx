import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { HEALTH_CHECK_DIMENSIONS } from "@/lib/stores/workspace-types";

/**
 * Health check: Clear all confirms with the count (see
 * health-check-unrated.test.tsx) and is undoable: Undo brings back the saved
 * checks and the check in progress.
 */

const undo = vi.hoisted(() => ({
  last: null as null | { label: string; apply: () => void; revert: () => void },
}));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { label: string; apply: () => void; revert: () => void }) => {
    undo.last = a;
    a.apply();
  },
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

const scores = Object.fromEntries(
  HEALTH_CHECK_DIMENSIONS.map((d) => [d, { light: "green", trend: "same" }])
) as never;

beforeEach(() => {
  undo.last = null;
  useWorkspaceStore.setState({
    sprints: [],
    healthChecks: [
      {
        id: "healthCheck:current",
        current: { sprintName: "Sprint 9", scores },
        history: [
          { id: "h1", sprintName: "S1", date: "2026-10-01", scores },
          { id: "h2", sprintName: "S2", date: "2026-10-08", scores },
        ],
      },
    ],
  });
});

const doc = () => useWorkspaceStore.getState().healthChecks?.[0];

describe("Health check Clear all undo", () => {
  it("brings back the saved checks and the check in progress", () => {
    render(
      <TooltipProvider>
        <HealthCheckClient />
      </TooltipProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Clear history" })
    );

    expect(doc()?.history).toHaveLength(0);
    expect(undo.last?.label).toBe("Cleared 2 saved health checks");

    act(() => undo.last!.revert());
    expect(doc()?.history.map((h) => h.sprintName)).toEqual(["S1", "S2"]);
    expect(doc()?.current.sprintName).toBe("Sprint 9");
    expect(screen.getByRole("button", { name: "Clear all" })).toBeInTheDocument();
  });
});
