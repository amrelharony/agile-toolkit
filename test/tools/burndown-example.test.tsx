import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { EXAMPLE_SPRINT_PREFIX, exampleSprints } from "@/lib/sprints/example";
import { DEFAULT_CALENDAR } from "@/lib/sprints/calendar";
import { burnSeries, burnStatus } from "@/lib/sprints/burn";
import { seriesFor } from "@/lib/sprints/series";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { useSprintMigrationStore } from "@/lib/sprints/migration-status";
import type { Sprint } from "@/lib/stores/workspace-types";

/**
 * Burndown's example is an in-memory preview of the example sprint: it is
 * read-only, says so, offers "Start your own" and "Clear example", and
 * writes nothing (no sprints, no daily log, no history). Its typed log
 * exports as Markdown against the working-day ideal line.
 */

const spy = vi.hoisted(() => ({ logs: [] as unknown[], undos: [] as unknown[] }));

vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { apply: () => void }) => {
    spy.undos.push(a);
    a.apply();
  },
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
  useHistoryLogger: () => ({ log: (...args: unknown[]) => spy.logs.push(args) }),
}));
vi.mock("@/lib/sonification/use-sonification", () => ({
  useToolSonification: () => () => {},
}));

beforeAll(() => {
  // Recharts' ResponsiveContainer needs it; jsdom doesn't ship one.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

import { BurndownClient } from "@/app/(tools)/burndown/burndown-client";
import { burndownMarkdown } from "@/app/(tools)/burndown/markdown";

const NOW = new Date(2026, 9, 18);

beforeEach(() => {
  spy.logs = [];
  spy.undos = [];
  resetSelectedSprint();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/burndown");
  useSprintMigrationStore.setState({ status: "idle" });
  useWorkspaceStore.setState({ sprints: [], sprintSeries: [] });
});

const markdownOf = (
  sprint: Sprint,
  series: Parameters<typeof burnSeries>[0]["series"],
  today: string
) => {
  const burn = burnSeries({ sprint, series, stories: [], calendar: DEFAULT_CALENDAR, today });
  return burndownMarkdown({ sprint, burn, status: burnStatus(burn, sprint) }, NOW);
};

describe("Burndown Markdown", () => {
  it("reports the example's typed log against the working-day ideal line, then every day", () => {
    // Sunday 18 Oct: day 5 of a sprint that started on Tuesday 13 Oct.
    const { current, series } = exampleSprints("2026-10-18");
    const md = markdownOf(current, seriesFor(series, current.id), "2026-10-18");
    expect(md).toMatch(/^# Burndown — 18 Oct 2026\n/);
    expect(md).toContain(
      "**Sprint:** Sprint 5: 35 points committed over 14 days (10 working days), starting 13 Oct 2026"
    );
    expect(md).toContain("**Source:** Typed in the daily log");
    expect(md).toContain("Day 5 of 14: 16 of 40 points done, behind by 3 points");
    // Four working days are done by Sunday: the ideal is 35 × 6/10 = 21.
    expect(md).toContain(
      "**Day 5:** 24 points left, ideal 21: behind by 3 points (40% of the scope done)"
    );
    expect(md).toContain("**Scope:** The scope grew by 5 points since day 0 (35 → 40)");
    expect(md).toContain("## Scope changes");
    expect(md).toContain("- Day 3: +5 points (Refund flow added)");
    expect(md).toContain("| Day | Date | Day off | Ideal | Remaining | Added | Removed | Note |");
    expect(md).toContain("| 3 | 16 Oct 2026 |  | 24.5 | 32 | 5 |  | Refund flow added |");
    // Saturday: a day off, the ideal flat across it.
    expect(md).toContain("| 4 | 17 Oct 2026 | Weekend | 21 | 27 |  |  |  |");
    expect(md).toContain("| 5 | 18 Oct 2026 | Weekend | 21 | 24 |  |  |  |");
    expect(md).toContain("| 14 | 27 Oct 2026 |  | 0 | — |  |  |  |");
  });

  it("escapes pipes and collapses newlines in notes", () => {
    const sprint: Sprint = {
      id: "s1",
      name: "Sprint 1",
      startDate: "2026-10-14",
      endDate: "2026-10-16",
      pointsPlanned: 10,
      status: "active",
    };
    const md = markdownOf(
      sprint,
      {
        id: "s1",
        days: [
          { day: 0, remaining: 10 },
          { day: 1, remaining: 6, note: "API | DB\nmigrated" },
        ],
      },
      "2026-10-15"
    );
    expect(md).toContain("| 1 | 15 Oct 2026 |  | 5 | 6 |  |  | API \\| DB migrated |");
  });

  it("says nothing is recorded on a new sprint", () => {
    const sprint: Sprint = {
      id: "s1",
      name: "Sprint 1",
      startDate: "2026-10-18",
      endDate: "2026-10-20",
      pointsPlanned: 40,
      status: "active",
    };
    expect(markdownOf(sprint, { id: "s1" }, "2026-10-18")).toBe(
      "# Burndown — 18 Oct 2026\n\nNothing recorded yet: point the sprint's stories and move them on the board, or log the points left each day.\n"
    );
  });
});

describe("Burndown example", () => {
  const remaining = (day: number) =>
    screen.getByRole("spinbutton", { name: `Remaining points on day ${day}` });

  it("previews the example sprint read-only and writes nothing", () => {
    render(
      <TooltipProvider>
        <BurndownClient />
      </TooltipProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));

    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    expect(screen.getByText(/Example sprint: a read-only preview/)).toBeInTheDocument();
    expect(screen.getByText("Example sprint: these can't be changed.")).toBeInTheDocument();
    // The board is the source; the typed log is the fallback, still there to read.
    expect(screen.getByRole("button", { name: "From the board" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(remaining(5)).toHaveValue(24);
    expect(remaining(5)).toHaveAttribute("readonly");
    expect(screen.getByRole("textbox", { name: "Note for day 3" })).toHaveValue(
      "Refund flow added"
    );
    expect(screen.getByRole("button", { name: "Scope changed on day 3" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clear log" })).toBeDisabled();

    // Typing into the preview changes nothing.
    fireEvent.change(remaining(5), { target: { value: "10" } });
    fireEvent.blur(remaining(5));
    expect(remaining(5)).toHaveValue(24);

    // Switching to the typed log is a view, not a write.
    fireEvent.click(screen.getByRole("button", { name: "From the typed log" }));
    expect(screen.getByRole("button", { name: "From the typed log" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    const ws = useWorkspaceStore.getState();
    expect(ws.sprints).toEqual([]);
    expect(ws.sprintSeries).toEqual([]);
    expect(spy.logs).toEqual([]);
    expect(spy.undos).toEqual([]);
    expect(JSON.stringify({ ...window.localStorage })).not.toContain(EXAMPLE_SPRINT_PREFIX);

    // Back to the empty state, and "Start your own" opens the new-sprint dialog.
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(screen.getByRole("heading", { name: "No sprints yet" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    fireEvent.click(screen.getByRole("button", { name: "Start your own" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("New sprint");
  });
});
