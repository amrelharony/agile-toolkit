import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

/**
 * Cumulative Flow fixes:
 *   - Done ÷ Total was labelled "Cycle Efficiency"; the tiles now read work
 *     in progress, throughput and a Little's Law lead time instead.
 *   - The bands stack the conventional way, Done at the bottom, while the
 *     legend keeps workflow order.
 *   - The WIP limit line is drawn on the WIP control chart (the WIP series),
 *     not on the stacked chart, where it was measured against every item.
 */

// Recharts stand-ins that record what each chart was given.
const seen = vi.hoisted(() => ({
  areas: [] as string[],
  refLinesY: [] as number[],
  legendSorter: null as null | ((item: { value: unknown }) => number | string),
}));
vi.mock("recharts", () => {
  const Box = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Box,
    AreaChart: Box,
    LineChart: Box,
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    Line: () => null,
    ReferenceDot: () => null,
    Legend: (p: { itemSorter?: (item: { value: unknown }) => number | string }) => {
      seen.legendSorter = p.itemSorter ?? null;
      return null;
    },
    Area: (p: { name: string }) => {
      seen.areas.push(p.name);
      return null;
    },
    ReferenceLine: (p: { y?: number }) => {
      if (typeof p.y === "number") seen.refLinesY.push(p.y);
      return null;
    },
  };
});
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

import { CFDClient } from "@/app/(tools)/cumulative-flow/cfd-client";
import { useCFDStore } from "@/app/(tools)/cumulative-flow/use-cfd-store";
import { CumulativeFlowAreaChart, WipControlLineChart } from "@/app/(tools)/cumulative-flow/charts";
import { DEFAULT_COLUMNS } from "@/app/(tools)/cumulative-flow/constants";
import { typedWorkflow } from "@/app/(tools)/cumulative-flow/view";

const counts = (todo: number, doing: number, review: number, done: number) => ({
  "col-1": todo,
  "col-2": doing,
  "col-3": review,
  "col-4": done,
});

beforeEach(() => {
  seen.areas = [];
  seen.refLinesY = [];
  seen.legendSorter = null;
  useWorkspaceStore.setState({ stories: [], sprints: [], kanbanBoards: [] });
  useCFDStore.setState({
    columns: DEFAULT_COLUMNS,
    entries: [
      { id: "a", date: "2026-10-01", counts: counts(10, 3, 1, 2) },
      { id: "b", date: "2026-10-02", counts: counts(8, 4, 2, 10) },
    ],
    wipLimit: 5,
    source: "typed",
  });
});

const renderPage = () =>
  render(
    <TooltipProvider>
      <CFDClient />
    </TooltipProvider>
  );

describe("Cumulative Flow fixes", () => {
  it("no longer calls Done ÷ Total a cycle efficiency", () => {
    renderPage();
    expect(screen.queryByText("Cycle Efficiency")).not.toBeInTheDocument();
    expect(screen.getByText("Work in progress")).toBeInTheDocument();
    // Latest snapshot: 4 + 2 in progress, against the limit of 5.
    expect(screen.getByText("of 5 allowed")).toBeInTheDocument();
  });

  it("says the WIP limit is on the WIP control chart", () => {
    renderPage();
    expect(
      screen.getByText(
        "WIP limit set at 5 items — shown as a dashed line on the WIP control chart (Advanced analysis)."
      )
    ).toBeInTheDocument();
  });

  it("stacks Done at the bottom and keeps the legend in workflow order", () => {
    render(<CumulativeFlowAreaChart days={[]} stages={typedWorkflow(DEFAULT_COLUMNS).stages} />);
    // Recharts stacks in render order, first at the bottom.
    expect(seen.areas).toEqual(["Done", "In Review", "In Progress", "To Do"]);
    const sorter = seen.legendSorter!;
    const legend = ["Done", "To Do", "In Review", "In Progress"].sort(
      (a, b) => Number(sorter({ value: a })) - Number(sorter({ value: b }))
    );
    expect(legend).toEqual(["To Do", "In Progress", "In Review", "Done"]);
    // No WIP-limit line on the stacked chart.
    expect(seen.refLinesY).toEqual([]);
  });

  it("draws the WIP limit on the WIP control chart", () => {
    render(
      <WipControlLineChart
        wipSeries={[
          { date: "2026-10-01", value: 4 },
          { date: "2026-10-02", value: 6 },
        ]}
        wipLimits={null}
        wipLimit={5}
        cusumAnnotations={[]}
        signals={[]}
      />
    );
    expect(seen.refLinesY).toEqual([5]);
  });
});
