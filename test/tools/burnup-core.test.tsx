import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint, SprintSeries } from "@/lib/stores/workspace-types";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { useSprintMigrationStore } from "@/lib/sprints/migration-status";

/**
 * Burnup gap-filling: the view's day 0 and empty days, the chart text's
 * edges, and on the page the four stat cards (completion, scope creep,
 * points done, projected finish), the scope-creep footer, rejected numbers,
 * notes, and clearing one day or the whole log. The shared-sprint paths are
 * in burnup-shared.test.
 */

const spy = vi.hoisted(() => ({
  logs: [] as Array<[string, Record<string, unknown> | undefined]>,
  last: null as null | { revert: () => void },
}));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { apply: () => void; revert: () => void }) => {
    spy.last = a;
    a.apply();
  },
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload?: Record<string, unknown>) => spy.logs.push([action, payload]),
  }),
}));
vi.mock("@/lib/sonification/use-sonification", () => ({
  useToolSonification: () => () => {},
}));

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

import { BurnupClient } from "@/app/(tools)/burnup/burnup-client";
import { burnupView } from "@/app/(tools)/burnup/view";
import { burnupChartText } from "@/app/(tools)/burnup/chart-text";
import type { BurnupChartRow } from "@/app/(tools)/burnup/charts";

const SPRINT: Sprint = {
  id: "s8",
  name: "Sprint 8",
  startDate: "2026-10-12",
  endDate: "2026-10-22",
  pointsPlanned: 30,
  status: "active",
};

const ws = () => useWorkspaceStore.getState();
const days = () => ws().sprintSeries?.find((s) => s.id === "s8")?.days ?? [];
const seed = (series: SprintSeries["days"] = []) =>
  useWorkspaceStore.setState({ sprints: [SPRINT], sprintSeries: [{ id: "s8", days: series }] });

beforeEach(() => {
  spy.logs = [];
  spy.last = null;
  resetSelectedSprint();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/burnup");
  useSprintMigrationStore.setState({ status: "idle" });
  seed();
});
afterEach(() => useWorkspaceStore.setState({ sprints: [], sprintSeries: [] }));

/* ── Pure ──────────────────────────────────────────────────────────────── */

describe("burnupView edges", () => {
  it("starts from the plan with nothing done, and leaves later days blank", () => {
    const view = burnupView(SPRINT, undefined);
    expect(view.entries).toHaveLength(11);
    expect(view.entries[0]).toMatchObject({
      scope: 30,
      completed: 0,
      typedScope: null,
      typedCompleted: null,
      derivedCompleted: null,
      scopeInForce: 30,
      stored: false,
    });
    expect(view.entries[5]).toMatchObject({ scope: null, completed: null, scopeInForce: 30 });
  });

  it("keeps a day past the end, and a typed day-0 scope over the plan", () => {
    const view = burnupView(SPRINT, {
      id: "s8",
      days: [
        { day: 0, scope: 26 },
        { day: 13, completed: 25, note: "Late finish" },
      ],
    });
    expect(view.entries[0]).toMatchObject({ scope: 26, typedScope: 26, scopeInForce: 26 });
    expect(view.entries.at(-1)).toMatchObject({
      day: 13,
      completed: 25,
      afterEnd: true,
      description: "Late finish",
    });
  });
});

describe("burnupChartText edges", () => {
  const row = (day: number, scope: number | null, completed: number | null): BurnupChartRow => ({
    day,
    scope,
    completed,
    forecast: undefined,
    band80Lower: undefined,
    band80Upper: undefined,
  });

  it("has nothing to chart without rows or scope", () => {
    expect(burnupChartText([]).summary).toBe("No sprint days to chart yet.");
    expect(burnupChartText([row(0, null, null)]).summary).toBe("No sprint days to chart yet.");
  });

  it("caps the percentage at 100 and reads 0% against a scope of 0", () => {
    expect(burnupChartText([row(0, 20, 0), row(1, 20, 24)]).summary).toBe(
      "24 of 20 points done by day 1 (100%); scope stayed at 20 points."
    );
    expect(burnupChartText([row(0, 0, 0), row(1, 0, 3)]).summary).toBe(
      "3 of 0 points done by day 1 (0%); scope stayed at 0 points."
    );
  });

  it("shows the forecast columns when there is a forecast", () => {
    const rows = [row(0, 30, 0), row(1, 30, 5), { ...row(2, 30, null), forecast: 9.94 }];
    const t = burnupChartText(rows).table;
    expect(t.columns).toEqual(["Day", "Scope", "Done", "Forecast", "80% range"]);
    expect(t.rows[2]).toEqual([2, 30, "—", 9.9, "—"]);
  });
});

/* ── The page ──────────────────────────────────────────────────────────── */

const renderBurnup = () =>
  render(
    <TooltipProvider>
      <BurnupClient />
    </TooltipProvider>
  );
const commit = (el: HTMLElement, value: string) => {
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
};
const completed = (day: number) =>
  screen.getByRole("spinbutton", { name: `Completed points on day ${day}` });
const scope = (day: number) =>
  screen.getByRole("spinbutton", { name: `Scope points on day ${day}` });
const statCard = (label: string) =>
  screen.getByText(label, { selector: "span" }).parentElement!.parentElement!;

describe("stat cards", () => {
  it("start at nothing done and no projection", () => {
    renderBurnup();
    expect(screen.getByText(/No days logged yet/)).toBeInTheDocument();
    expect(statCard("Completion")).toHaveTextContent("0%");
    expect(statCard("Scope creep")).toHaveTextContent("0pts");
    expect(statCard("Points completed")).toHaveTextContent("0/ 30 pts");
    expect(statCard("Projected done")).toHaveTextContent("—");
    expect(screen.queryByText(/Scope creep: scope grew/)).toBeNull();
  });

  it("project the finish from the last two days and show scope creep", () => {
    seed([
      { day: 2, completed: 6 },
      { day: 4, completed: 14, scope: 34 },
    ]);
    renderBurnup();
    // 8 points over 2 days: 4 a day; 20 left of 34 → 5 more days → day 9.
    expect(statCard("Projected done")).toHaveTextContent("Day 9");
    expect(statCard("Completion")).toHaveTextContent("41%");
    expect(statCard("Scope creep")).toHaveTextContent("+4pts");
    expect(statCard("Points completed")).toHaveTextContent("14/ 34 pts");
    expect(
      screen.getByText(/Scope creep: scope grew by 4 pts \(30 →\s*34\)\./)
    ).toBeInTheDocument();
  });

  it("say 'After sprint' when the pace runs past the end", () => {
    seed([
      { day: 1, completed: 1 },
      { day: 2, completed: 2 },
    ]);
    renderBurnup();
    expect(statCard("Projected done")).toHaveTextContent("After sprint");
  });

  it("call a sprint that already met its scope done on its latest day", () => {
    // Bug: with the scope met and no further progress, the rate was 0 (or the points left
    // negative), so "Projected done" read "—" for finished work. tool.burnup.compute says
    // "already met scope" is done on the last day.
    seed([
      { day: 3, completed: 30 },
      { day: 4, completed: 30 },
    ]);
    const { unmount } = renderBurnup();
    expect(statCard("Projected done")).toHaveTextContent("Day 4");
    expect(statCard("Completion")).toHaveTextContent("100%");
    unmount();

    seed([
      { day: 2, completed: 20 },
      { day: 3, completed: 32 },
    ]);
    renderBurnup();
    expect(statCard("Projected done")).toHaveTextContent("Day 3");
    expect(statCard("Completion")).toHaveTextContent("100%");
  });
});

describe("daily data", () => {
  it("ignores a negative number, and logs a day only the first time it gets one", () => {
    renderBurnup();
    commit(completed(1), "-3");
    commit(scope(1), "-3");
    expect(days()).toEqual([]);

    commit(completed(1), "5");
    commit(completed(1), "6");
    expect(days()).toEqual([{ day: 1, completed: 6 }]);
    expect(spy.logs.filter(([a]) => a === "day_logged")).toEqual([
      ["day_logged", { sprintId: "s8", day: 1, completed: 5 }],
    ]);
  });

  it("saves a note, which Burndown shares", () => {
    renderBurnup();
    commit(screen.getByRole("textbox", { name: "Note for day 2" }), "Design review");
    expect(days()).toEqual([{ day: 2, note: "Design review" }]);
    commit(screen.getByRole("textbox", { name: "Note for day 2" }), "  ");
    expect(days()).toEqual([]);
  });

  it("clears one day with Undo, and can't clear an empty one", () => {
    seed([
      { day: 1, completed: 4 },
      { day: 2, completed: 9, note: "Pairing" },
    ]);
    renderBurnup();
    expect(screen.getByRole("button", { name: "Clear day 3" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Clear day 2" }));
    expect(days()).toEqual([{ day: 1, completed: 4 }]);
    expect(spy.logs).toContainEqual(["day_removed", { sprintId: "s8", day: 2 }]);
    spy.last?.revert();
    expect(days()).toEqual([
      { day: 1, completed: 4 },
      { day: 2, completed: 9, note: "Pairing" },
    ]);
  });

  it("confirms Clear log with the count, then clears it", () => {
    seed([{ day: 1, completed: 4 }]);
    renderBurnup();
    fireEvent.click(screen.getByRole("button", { name: "Clear log" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(
      "The 1 logged day of Sprint 8 is cleared, here and in Burndown."
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear log" }));
    expect(days()).toEqual([]);
    expect(spy.logs).toContainEqual(["burnup_reset", { sprintId: "s8", days: 1 }]);
    expect(screen.getByRole("button", { name: "Clear log" })).toBeDisabled();
  });
});
