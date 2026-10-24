import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint, SprintSeries } from "@/lib/stores/workspace-types";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { useSprintMigrationStore } from "@/lib/sprints/migration-status";

/**
 * The tools wire their charts' text alternatives: each chart is a figure
 * named by its heading, described by a summary of the plotted data, with a
 * "View as table" toggle. Burnup goes through ChartCard; the cumulative flow
 * charts sit in cards of their own and use ChartFigure.
 */

vi.mock("recharts", () => {
  const Box = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  const Nothing = () => null;
  return {
    ResponsiveContainer: Box,
    AreaChart: Box,
    LineChart: Box,
    ComposedChart: Box,
    CartesianGrid: Nothing,
    XAxis: Nothing,
    YAxis: Nothing,
    Tooltip: Nothing,
    Legend: Nothing,
    Line: Nothing,
    Area: Nothing,
    ReferenceLine: Nothing,
    ReferenceArea: Nothing,
    ReferenceDot: Nothing,
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
vi.mock("@/lib/sonification/use-sonification", () => ({
  useToolSonification: () => () => {},
}));

import { BurnupClient } from "@/app/(tools)/burnup/burnup-client";
import { CFDClient } from "@/app/(tools)/cumulative-flow/cfd-client";
import { useCFDStore } from "@/app/(tools)/cumulative-flow/use-cfd-store";
import { DEFAULT_COLUMNS } from "@/app/(tools)/cumulative-flow/constants";

const SPRINT: Sprint = {
  id: "s-active",
  name: "Sprint 8",
  startDate: "2026-10-12",
  endDate: "2026-10-22",
  pointsPlanned: 30,
  status: "active",
};
const LOG: SprintSeries = {
  id: "s-active",
  days: [
    { day: 1, completed: 4 },
    { day: 2, completed: 11 },
  ],
};

const counts = (todo: number, doing: number, review: number, done: number) => ({
  "col-1": todo,
  "col-2": doing,
  "col-3": review,
  "col-4": done,
});

beforeEach(() => {
  resetSelectedSprint();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
  useSprintMigrationStore.setState({ status: "idle" });
  useWorkspaceStore.setState({ sprints: [SPRINT], sprintSeries: [LOG] });
  // Eight typed snapshots: the WIP control chart (under Advanced analysis)
  // draws from MIN_SAMPLE.changePoint points.
  useCFDStore.setState({
    columns: DEFAULT_COLUMNS,
    entries: [
      { id: "a", date: "2026-10-01", counts: counts(10, 3, 1, 2) },
      { id: "b", date: "2026-10-02", counts: counts(8, 4, 2, 10) },
      { id: "c", date: "2026-10-03", counts: counts(8, 3, 2, 11) },
      { id: "d", date: "2026-10-04", counts: counts(7, 3, 2, 12) },
      { id: "e", date: "2026-10-05", counts: counts(7, 4, 2, 13) },
      { id: "f", date: "2026-10-06", counts: counts(7, 2, 2, 14) },
      { id: "g", date: "2026-10-07", counts: counts(6, 3, 2, 15) },
      { id: "h", date: "2026-10-08", counts: counts(5, 4, 2, 16) },
    ],
    wipLimit: null,
    source: "typed",
  });
});

describe("Burnup chart text alternative", () => {
  it("describes the plotted burnup and tables it on demand", () => {
    render(
      <TooltipProvider>
        <BurnupClient />
      </TooltipProvider>
    );
    const figure = screen.getByRole("figure", { name: "Burnup chart" });
    // The sprint has weekends, shaded now that the chart counts working days.
    expect(figure).toHaveAccessibleDescription(
      "11 of 30 points done by day 2 (37%); scope stayed at 30 points. Days off are shaded."
    );

    const toggle = within(figure).getByRole("button", { name: "View as table" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const table = within(figure).getByRole("table", {
      name: "Scope and points done by sprint day",
    });
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((th) => th.textContent);
    expect(headers.slice(0, 3)).toEqual(["Day", "Scope", "Done"]);
    // Day 2's row: scope 30, 11 done.
    const day2 = within(table).getAllByRole("row")[3];
    expect(Array.from(day2.children, (c) => c.textContent).slice(0, 3)).toEqual(["2", "30", "11"]);
  });
});

describe("Cumulative flow chart text alternatives", () => {
  const renderCfd = () =>
    render(
      <TooltipProvider>
        <CFDClient />
      </TooltipProvider>
    );

  it("names both charts by their headings and describes them", () => {
    renderCfd();
    expect(screen.getByRole("figure", { name: "Flow Diagram" })).toHaveAccessibleDescription(
      "Done rose from 2 to 16 items between 2026-10-01 and 2026-10-08; 6 items in progress on the last day."
    );
    expect(screen.getByRole("figure", { name: /WIP control chart/ })).toHaveAccessibleDescription(
      "WIP rose from 4 to 6 over 8 snapshots, ranging from 4 to 6."
    );
  });

  it("swaps the flow diagram for a table of the snapshots", () => {
    renderCfd();
    const figure = screen.getByRole("figure", { name: "Flow Diagram" });
    fireEvent.click(within(figure).getByRole("button", { name: "View as table" }));
    const table = within(figure).getByRole("table", { name: "Items in each stage by date" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((th) => th.textContent)
    ).toEqual(["Date", "To Do", "In Progress", "In Review", "Done"]);
    expect(
      within(table)
        .getAllByRole("rowheader")
        .map((th) => th.textContent)
    ).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
    ]);
  });
});
