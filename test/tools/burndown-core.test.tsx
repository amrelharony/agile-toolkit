import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint, SprintSeries } from "@/lib/stores/workspace-types";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { useSprintMigrationStore } from "@/lib/sprints/migration-status";
import { EXAMPLE_SPRINT_PREFIX } from "@/lib/sprints/example";

/**
 * Burndown gap-filling: the day list and view edges, every series write
 * (settings, Burnup's day patch, the scope flag, clear and restore), the
 * Markdown's and chart text's edges, the shared DraftInput, and on the page
 * the stat cards, rejected numbers, notes, the scope flag, the sprint
 * settings and the dates form's validation.
 */

const spy = vi.hoisted(() => ({
  logs: [] as Array<[string, Record<string, unknown> | undefined]>,
}));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { apply: () => void }) => a.apply(),
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

import { BurndownClient } from "@/app/(tools)/burndown/burndown-client";
import { burndownView, viewDays } from "@/app/(tools)/burndown/view";
import {
  clearDay,
  clearLog,
  restoreDay,
  restoreLog,
  setPlannedPoints,
  setSprintDates,
  setSprintLength,
  setSprintStart,
  toggleScopeChange,
  writeBurndownDay,
  writeBurnupDay,
} from "@/app/(tools)/burndown/series-writes";
import { toMarkdown, type BurndownConfig, type DayEntry } from "@/app/(tools)/burndown/markdown";
import { burndownChartText } from "@/app/(tools)/burndown/chart-text";
import { DraftInput, formatPoints, shortDate } from "@/app/(tools)/burndown/sprint-shell";

const SPRINT: Sprint = {
  id: "s7",
  name: "Sprint 7",
  startDate: "2026-10-05",
  endDate: "2026-10-15",
  pointsPlanned: 40,
  status: "active",
};

const ws = () => useWorkspaceStore.getState();
const stored = (id = "s7") => ws().sprints.find((s) => s.id === id);
const days = (id = "s7") => ws().sprintSeries?.find((s) => s.id === id)?.days ?? [];
const seed = (sprints: Sprint[] = [SPRINT], series: SprintSeries[] = []) =>
  useWorkspaceStore.setState({ sprints, sprintSeries: series });

beforeEach(() => {
  spy.logs = [];
  resetSelectedSprint();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/burndown");
  useSprintMigrationStore.setState({ status: "idle" });
  seed();
});
afterEach(() => seed([], []));

/* ── View ──────────────────────────────────────────────────────────────── */

describe("viewDays", () => {
  it("lists day 0 to the end, then any later day that has something, once each", () => {
    expect(viewDays(undefined, 3)).toEqual([0, 1, 2, 3]);
    expect(
      viewDays(
        {
          id: "x",
          days: [{ day: 7, remaining: 1 }, { day: 2 }, { day: 5, note: "late" }, { day: 2.5 }],
        },
        3
      )
    ).toEqual([0, 1, 2, 3, 5, 7]);
  });
});

describe("burndownView edges", () => {
  it("shows a flagged day as a scope change, but never one past the end", () => {
    const view = burndownView(SPRINT, {
      id: "s7",
      days: [
        { day: 4, remaining: 38, scopeChange: true },
        { day: 12, remaining: 2, scopeChange: true },
      ],
    });
    expect(view.scopeChangeDays).toEqual([4]);
    expect(view.entries.find((e) => e.day === 12)).toMatchObject({
      afterEnd: true,
      scopeChange: true,
    });
  });

  it("uses the plan on day 0 only, and works out remaining from Burnup's points done", () => {
    const view = burndownView(
      { ...SPRINT, pointsPlanned: 0 },
      {
        id: "s7",
        days: [{ day: 1, completed: 3, scope: 20 }],
      }
    );
    expect(view.entries[0]).toMatchObject({ remaining: 0, source: "plan" });
    expect(view.entries[1]).toMatchObject({ remaining: 17, source: "derived" });
    expect(view.entries[2]).toMatchObject({ remaining: null, source: null, stored: false });
    // The scope Burnup typed on day 1 differs from the plan: a scope change.
    expect(view.scopeChangeDays).toEqual([1]);
  });
});

/* ── Series writes ─────────────────────────────────────────────────────── */

describe("sprint settings writes", () => {
  it("sets planned points of 0 or more on a stored sprint only", () => {
    expect(setPlannedPoints("s7", -1)).toBeNull();
    expect(setPlannedPoints("s7", Number.NaN)).toBeNull();
    expect(setPlannedPoints("missing", 5)).toBeNull();
    expect(stored()?.pointsPlanned).toBe(40);
    expect(setPlannedPoints("s7", 0)).toMatchObject({ pointsPlanned: 0 });
    expect(stored()?.pointsPlanned).toBe(0);
  });

  it("never writes an example sprint, even one that ended up stored", () => {
    const example = { ...SPRINT, id: `${EXAMPLE_SPRINT_PREFIX}1` };
    seed([SPRINT, example]);
    expect(setPlannedPoints(example.id, 10)).toBeNull();
    expect(writeBurndownDay(example.id, 1, { remaining: 5 })).toBeNull();
    expect(clearLog(example.id)).toEqual([]);
    expect(stored(example.id)?.pointsPlanned).toBe(40);
    expect(ws().sprintSeries).toEqual([]);
  });

  it("moves the end date for a new length, and the dates for a new start", () => {
    expect(setSprintLength("s7", Number.NaN)).toBeNull();
    expect(setSprintLength("s7", 14)).toMatchObject({ endDate: "2026-10-19" });
    expect(setSprintStart("s7", "2026/10/12")).toBeNull();
    expect(setSprintStart("s7", "2026-10-12")).toMatchObject({
      startDate: "2026-10-12",
      endDate: "2026-10-26",
    });
    expect(setSprintDates("s7", "2026-11-02", "2026-11-13")).toMatchObject({
      startDate: "2026-11-02",
      endDate: "2026-11-13",
    });
    expect(setSprintDates("missing", "2026-11-02", "2026-11-13")).toBeNull();
  });
});

describe("day writes", () => {
  it("Burnup's patch removes blank fields and drops an emptied day", () => {
    let write = writeBurnupDay("s7", 2, { scope: 44, completed: 6, note: "Demo" });
    expect(write).toEqual({
      before: undefined,
      after: { day: 2, scope: 44, completed: 6, note: "Demo" },
    });
    write = writeBurnupDay("s7", 2, { note: "   ", scope: null });
    expect(write?.after).toEqual({ day: 2, completed: 6 });
    writeBurnupDay("s7", 2, { completed: null });
    expect(days()).toEqual([]);
  });

  it("flips the scope flag from what is stored", () => {
    writeBurndownDay("s7", 3, { remaining: 30 });
    expect(toggleScopeChange("s7", 3)?.after).toMatchObject({ scopeChange: true });
    expect(toggleScopeChange("s7", 3)?.after).toEqual({ day: 3, remaining: 30 });
    expect(toggleScopeChange("missing", 3)).toBeNull();
  });

  it("clearing an empty day writes nothing", () => {
    seed([SPRINT], [{ id: "s7", days: [{ day: 1, remaining: 30 }] }]);
    expect(clearDay("s7", 4)).toBeUndefined();
    expect(days()).toEqual([{ day: 1, remaining: 30 }]);
    expect(clearLog("missing")).toEqual([]);
  });

  it("restoring a day keeps what was logged on it since", () => {
    seed([SPRINT], [{ id: "s7", days: [{ day: 2, remaining: 31, note: "Pairing" }] }]);
    const removed = clearDay("s7", 2)!;
    expect(days()).toEqual([]);
    writeBurndownDay("s7", 2, { remaining: 29 });
    restoreDay("s7", removed);
    expect(days()).toEqual([{ day: 2, remaining: 29, note: "Pairing" }]);
  });

  it("restoring the log keeps days logged since and fills them in from the old log", () => {
    seed(
      [SPRINT],
      [
        {
          id: "s7",
          days: [
            { day: 1, remaining: 35 },
            { day: 3, remaining: 28, note: "Old note" },
          ],
        },
      ]
    );
    const previous = clearLog("s7");
    expect(previous).toHaveLength(2);
    expect(days()).toEqual([]);
    expect(clearLog("s7")).toEqual([]);

    writeBurndownDay("s7", 3, { remaining: 27 });
    writeBurndownDay("s7", 5, { remaining: 20 });
    restoreLog("s7", previous);
    expect(days()).toEqual([
      { day: 1, remaining: 35 },
      { day: 3, remaining: 27, note: "Old note" },
      { day: 5, remaining: 20 },
    ]);
  });
});

/* ── Markdown and chart text ───────────────────────────────────────────── */

describe("toMarkdown edges", () => {
  const NOW = new Date(2026, 9, 18);
  const config: BurndownConfig = { totalPoints: 40, sprintDays: 10, sprintStartDate: "2026-10-05" };
  const e = (day: number, remaining: number | null, patch: Partial<DayEntry> = {}): DayEntry => ({
    id: `d${day}`,
    day,
    remaining,
    scopeChange: false,
    ...patch,
  });

  it("calls a sprint ahead, on track or behind against the ideal line", () => {
    const ahead = toMarkdown({ config, entries: [e(0, 40), e(2, 28)] }, NOW);
    expect(ahead).toContain(
      "**Day 2:** 28 points left, ideal 32: 4 points ahead of ideal (30% done)"
    );
    const onTrack = toMarkdown({ config, entries: [e(0, 40), e(2, 32.4)] }, NOW);
    expect(onTrack).toContain("ideal 32: on track (19% done)");
  });

  it("clamps done to 0% when scope pushed remaining past the plan", () => {
    const md = toMarkdown({ config, entries: [e(0, 40), e(1, 50, { scopeChange: true })] }, NOW);
    expect(md).toContain("**Day 1:** 50 points left, ideal 36: 14 points behind ideal (0% done)");
    expect(md).toContain("## Scope changes\n\n- Day 1\n");
  });

  it("has no trend line with one reading, and keeps a start date that isn't one", () => {
    const md = toMarkdown(
      {
        config: { totalPoints: 0, sprintDays: 0, sprintStartDate: "someday" },
        entries: [e(0, null, { description: "Kick-off" })],
      },
      NOW
    );
    expect(md).toContain("**Sprint:** 0 points over 0 days, starting someday");
    expect(md).not.toContain("**Day");
    expect(md).toContain("| 0 | 0 | — |  | Kick-off |");
  });

  it("uses the singular for one point and one day", () => {
    // Bug: the header read "1 points over 1 days".
    const md = toMarkdown(
      {
        config: { totalPoints: 1, sprintDays: 1, sprintStartDate: "2026-10-05" },
        entries: [e(0, 1), e(1, 0)],
      },
      NOW
    );
    expect(md).toContain("**Sprint:** 1 point over 1 day, starting 5 Oct 2026");
  });

  it("sorts the days it is given", () => {
    const md = toMarkdown({ config, entries: [e(2, 30), e(0, 40), e(1, 36)] }, NOW);
    const table = md.split("## Daily progress")[1];
    expect(table.indexOf("| 0 |")).toBeLessThan(table.indexOf("| 1 |"));
    expect(table.indexOf("| 1 |")).toBeLessThan(table.indexOf("| 2 |"));
    expect(md).toContain("**Day 2:** 30 points left");
  });
});

describe("burndownChartText edges", () => {
  it("has a sentence for no days, and for one reading after day 0", () => {
    expect(burndownChartText([]).summary).toBe("No sprint days to chart yet.");
    expect(
      burndownChartText([
        { day: 0, ideal: 40, actual: null },
        { day: 1, ideal: 36, actual: 36.3 },
        { day: 2, ideal: 32, actual: null },
      ]).summary
    ).toBe("36.3 points remaining on day 1; on the ideal line.");
    expect(
      burndownChartText([
        { day: 0, ideal: 40, actual: null },
        { day: 1, ideal: 36, actual: 1 },
      ]).summary
    ).toBe("1 point remaining on day 1; 35 points ahead of the ideal line.");
  });
});

/* ── Shared shell pieces ───────────────────────────────────────────────── */

describe("shortDate and formatPoints", () => {
  it("returns nothing for a missing or broken date and one decimal for points", () => {
    expect(shortDate("")).toBe("");
    expect(shortDate(null)).toBe("");
    expect(shortDate("16/10/2026")).toBe("");
    expect(shortDate("2026-10-16")).not.toBe("");
    expect(formatPoints(12)).toBe("12");
    expect(formatPoints(12.345)).toBe("12.3");
    expect(formatPoints(-0.04)).toBe("0");
  });
});

describe("DraftInput", () => {
  it("commits once on Enter or blur, only when changed; Escape drops the draft", () => {
    const onCommit = vi.fn();
    render(<DraftInput aria-label="Points" value="5" onCommit={onCommit} />);
    const input = screen.getByLabelText("Points");

    fireEvent.change(input, { target: { value: "7" } });
    expect(input).toHaveValue("7");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue("5");
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "8" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("8");
  });

  it("ignores typing when read-only", () => {
    const onCommit = vi.fn();
    render(<DraftInput aria-label="Points" value="5" readOnly onCommit={onCommit} />);
    const input = screen.getByLabelText("Points");
    fireEvent.change(input, { target: { value: "9" } });
    fireEvent.blur(input);
    expect(input).toHaveValue("5");
    expect(onCommit).not.toHaveBeenCalled();
  });
});

/* ── The page ──────────────────────────────────────────────────────────── */

const renderBurndown = () =>
  render(
    <TooltipProvider>
      <BurndownClient />
    </TooltipProvider>
  );
const remaining = (day: number) =>
  screen.getByRole("spinbutton", { name: `Remaining points on day ${day}` });
const commit = (el: HTMLElement, value: string) => {
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
};
const statCard = (label: string) =>
  screen.getByText(label, { selector: "span" }).parentElement!.parentElement!;

describe("Burndown page", () => {
  it("reads ahead of ideal from the latest day", () => {
    seed([SPRINT], [{ id: "s7", days: [{ day: 1, remaining: 30 }] }]);
    renderBurndown();
    expect(statCard("Planned points")).toHaveTextContent("40pts");
    expect(statCard("Variance from ideal")).toHaveTextContent("+6pts");
    expect(statCard("Completion rate")).toHaveTextContent("25%");
    expect(statCard("Trend")).toHaveTextContent("Ahead of ideal");
  });

  it("reads behind ideal, with a negative variance", () => {
    seed([SPRINT], [{ id: "s7", days: [{ day: 2, remaining: 38 }] }]);
    renderBurndown();
    expect(statCard("Variance from ideal")).toHaveTextContent("-6pts");
    expect(statCard("Completion rate")).toHaveTextContent("5%");
    expect(statCard("Trend")).toHaveTextContent("Behind ideal");
  });

  it("ignores a negative remaining and clears a day's number when emptied", () => {
    seed([SPRINT], [{ id: "s7", days: [{ day: 1, remaining: 30, note: "Kick-off" }] }]);
    renderBurndown();
    commit(remaining(2), "-5");
    expect(days()).toEqual([{ day: 1, remaining: 30, note: "Kick-off" }]);
    commit(remaining(1), "");
    expect(days()).toEqual([{ day: 1, note: "Kick-off" }]);
    expect(spy.logs.map((l) => l[0])).not.toContain("day_logged");
  });

  it("saves a note and flags a scope change on a day", () => {
    renderBurndown();
    commit(screen.getByRole("textbox", { name: "Note for day 3" }), "Refund flow added");
    expect(days()).toEqual([{ day: 3, note: "Refund flow added" }]);

    fireEvent.click(screen.getByRole("button", { name: /Mark change\s*on day 3/ }));
    expect(days()).toEqual([{ day: 3, note: "Refund flow added", scopeChange: true }]);
    expect(spy.logs).toContainEqual([
      "scope_changed",
      { sprintId: "s7", day: 3, scopeChange: true, scope: null },
    ]);
    expect(screen.getByRole("button", { name: /Scope changed\s*on day 3/ })).toBeInTheDocument();
  });

  it("labels a day logged past the sprint's end", () => {
    seed([SPRINT], [{ id: "s7", days: [{ day: 12, remaining: 3 }] }]);
    renderBurndown();
    expect(remaining(12)).toHaveValue(3);
    expect(screen.getByText(/, after the end$/)).toBeInTheDocument();
  });
});

describe("sprint settings on the page", () => {
  it("ignores negative planned points and saves a real number", () => {
    renderBurndown();
    const points = screen.getByLabelText("Planned points");
    commit(points, "-4");
    expect(stored()?.pointsPlanned).toBe(40);
    commit(points, "45");
    expect(stored()?.pointsPlanned).toBe(45);
    expect(spy.logs).toContainEqual(["config_updated", { sprintId: "s7", totalPoints: 45 }]);
  });

  it("keeps the length between 1 and 90 days", () => {
    renderBurndown();
    commit(screen.getByLabelText("Length (days)"), "120");
    expect(stored()?.endDate).toBe("2027-01-03");
    commit(screen.getByLabelText("Length (days)"), "0");
    expect(stored()?.endDate).toBe("2026-10-06");
    expect(spy.logs).toContainEqual(["config_updated", { sprintId: "s7", sprintDays: 1 }]);
  });

  it("moves the start and keeps the length", () => {
    renderBurndown();
    fireEvent.change(screen.getByLabelText("First day"), { target: { value: "2026-10-12" } });
    expect(stored()).toMatchObject({ startDate: "2026-10-12", endDate: "2026-10-22" });
    expect(spy.logs).toContainEqual([
      "config_updated",
      { sprintId: "s7", sprintStartDate: "2026-10-12" },
    ]);
  });
});

describe("the dates form", () => {
  it("asks for both days, the last after the first", () => {
    seed([{ ...SPRINT, startDate: "2020-01-03", endDate: "" }]);
    renderBurndown();
    const first = screen.getByLabelText(/^First day/);
    const last = screen.getByLabelText(/^Last day/);
    fireEvent.change(first, { target: { value: "2026-10-10" } });
    fireEvent.change(last, { target: { value: "2026-10-10" } });
    fireEvent.click(screen.getByRole("button", { name: "Save dates" }));
    expect(screen.getByText("The last day comes after the first.")).toBeInTheDocument();
    expect(stored()?.endDate).toBe("");

    fireEvent.change(first, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save dates" }));
    expect(screen.getByText("Pick the first day of the sprint.")).toBeInTheDocument();
    expect(stored()?.startDate).toBe("2020-01-03");
  });
});
