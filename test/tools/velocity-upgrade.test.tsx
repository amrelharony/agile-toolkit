import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { TooltipProvider } from "@/components/ui/tooltip";
import { isExampleId } from "@/components/tool-frame/example-data";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { CapacityPlan, Sprint, Story } from "@/lib/stores/workspace-types";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { useSprintMigrationStore } from "@/lib/sprints/migration-status";
import {
  availablePersonDays,
  capacityPlanIdFor,
  CAPACITY_PLAN_ID,
  velocityPerPersonDay,
} from "@/lib/sprints/capacity";
import { velocity } from "@/lib/sprints/metrics";

/**
 * Velocity, upgraded: the shared velocity (the last 3 finished sprints by
 * end date), the graded say/do per sprint, points per available person-day
 * from each sprint's own capacity plan, closing only through the close
 * dialog (carry-over, one Undo), new sprints only through the New sprint
 * dialog, inline errors instead of silent clamps, and the heavy statistics
 * behind their minimum samples in Advanced analysis.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn() })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
const logs = vi.hoisted(() => [] as { action: string; payload?: Record<string, unknown> }[]);
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload?: Record<string, unknown>) => logs.push({ action, payload }),
  }),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
}));
// Recharts has nothing to measure in jsdom; the charts' text is tested directly.
vi.mock("@/app/(tools)/velocity/charts", () => ({
  VelocityChart: () => null,
  ForecastChart: () => null,
}));

import { VelocityClient } from "@/app/(tools)/velocity/velocity-client";
import {
  completedPointsPatch,
  nextSprintDates,
  shouldOfferClose,
  toVelocityRows,
  velocitySummary,
} from "@/app/(tools)/velocity/view";
import { validatePoints } from "@/app/(tools)/velocity/sprint-row";
import { velocityVerdict } from "@/app/(tools)/velocity/verdict";
import { toMarkdown } from "@/app/(tools)/velocity/markdown";
import { velocityChartText } from "@/app/(tools)/velocity/chart-text";
import { changepointMarkers } from "@/app/(tools)/velocity/changepoints";
import { buildExample } from "@/app/(tools)/velocity/example";
import { velocityPrompts } from "@/app/(tools)/velocity/prompts";

/* ── Fixtures ───────────────────────────────────────────────────────── */

const TODAY = "2026-10-22";

const sprint = (over: Partial<Sprint> & Pick<Sprint, "id">): Sprint => ({
  name: over.id,
  startDate: "2026-01-05",
  endDate: "2026-01-18",
  pointsPlanned: 30,
  status: "completed",
  ...over,
});

/** N finished sprints, two weeks apart, with these completed points. */
const finishedRun = (points: readonly number[], committed = 30): Sprint[] =>
  points.map((p, i) => {
    const start = new Date(Date.UTC(2026, 0, 5 + 14 * i)).toISOString().slice(0, 10);
    const end = new Date(Date.UTC(2026, 0, 18 + 14 * i)).toISOString().slice(0, 10);
    return sprint({
      id: `f${i + 1}`,
      name: `Sprint ${i + 1}`,
      startDate: start,
      endDate: end,
      pointsPlanned: committed,
      pointsCompleted: p,
    });
  });

const capacity = (
  sprintId: string | null,
  members: { id?: string; availability: number; daysOff: number }[],
  sprintDays = 10
): CapacityPlan => ({
  id: sprintId ? capacityPlanIdFor(sprintId) : CAPACITY_PLAN_ID,
  ...(sprintId ? { sprintId } : {}),
  members: members.map((m, i) => ({
    name: `P${i}`,
    role: "Dev",
    ...m,
    id: m.id ?? `m${i}`,
  })),
  config: {
    sprintDays,
    ceremonyOverhead: 10,
    focusFactor: 0.8,
    hoursPerDay: 6,
    pointsCommitted: "",
  },
});

const ws = () => useWorkspaceStore.getState();
const stored = (id: string) => ws().sprints.find((s) => s.id === id);

const renderVelocity = () =>
  render(
    <TooltipProvider>
      <VelocityClient />
    </TooltipProvider>
  );

/** Click Undo on the newest toast. */
const undoLast = () => {
  const call = toastSpy.mock.calls.at(-1);
  const opts = call?.[1] as { action?: { onClick: () => void } } | undefined;
  expect(opts?.action).toBeTruthy();
  act(() => opts?.action?.onClick());
};

function commit(el: HTMLElement, value: string) {
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 22, 9, 0, 0));
  toastSpy.mockReset();
  logs.length = 0;
  resetSelectedSprint();
  window.localStorage.clear();
  useSprintMigrationStore.setState({ status: "idle" });
});

afterEach(() => {
  vi.useRealTimers();
  useWorkspaceStore.setState({
    sprints: [],
    sprintSeries: [],
    stories: [],
    capacityPlans: [],
    ceremonyCadences: [],
  });
});

/* ── The shared definitions ─────────────────────────────────────────── */

describe("velocity is the shared definition", () => {
  it("averages the last 3 finished sprints by end date, however they were stored", () => {
    const [a, b, c, d] = finishedRun([10, 20, 30, 40]);
    const s = velocitySummary([d, a, c, b]);
    expect(s.velocity).toMatchObject({ average: 30, count: 3, sprintIds: ["f2", "f3", "f4"] });
    // The rows follow the same order, so the table and chart read left to right.
    expect(toVelocityRows([d, a, c, b]).map((r) => r.id)).toEqual(["f1", "f2", "f3", "f4"]);
    // The rolling line is the velocity as it stood after each sprint.
    expect(s.rolling.get("f4")).toBe(30);
    expect(s.rolling.get("f1")).toBe(10);
  });

  it("leaves planned, running and pointless sprints out", () => {
    const rows = toVelocityRows([
      sprint({ id: "p", status: "planned", pointsCompleted: 12 }),
      sprint({ id: "r", status: "active", pointsCompleted: 12 }),
      sprint({ id: "x", status: "completed" }),
    ]);
    expect(rows.every((r) => !r.finished)).toBe(true);
    expect(rows.every((r) => r.sayDo === null)).toBe(true);
    expect(velocitySummary(rows.map((r) => sprint({ id: r.id }))).velocity.average).toBeNull();
  });
});

describe("graded say/do", () => {
  const graded = (completed: number, committed = 100) =>
    toVelocityRows([sprint({ id: "s", pointsPlanned: committed, pointsCompleted: completed })])[0]
      .sayDo;

  it("grades at the 110%, 90% and 70% boundaries", () => {
    expect(graded(111)?.grade).toBe("over");
    expect(graded(110)?.grade).toBe("met");
    expect(graded(90)?.grade).toBe("met");
    expect(graded(89)?.grade).toBe("close");
    expect(graded(70)?.grade).toBe("close");
    expect(graded(69)?.grade).toBe("missed");
    expect(graded(0)).toMatchObject({ grade: "missed", pct: 0 });
  });

  it("has no say/do without a commitment, instead of a 0% or a pass", () => {
    expect(graded(12, 0)).toBeNull();
    const s = velocitySummary([sprint({ id: "z", pointsPlanned: 0, pointsCompleted: 12 })]);
    expect(s.sayDo.count).toBe(0);
    expect(s.velocity.average).toBe(12);
  });

  it("is not pass/fail: over-delivery isn't 'met'", () => {
    const s = velocitySummary(finishedRun([30, 45, 27]));
    expect(s.sayDo.byGrade).toEqual({ met: 2, close: 0, missed: 0, over: 1 });
  });
});

describe("points per available person-day", () => {
  it("weighs each member's working days by their availability", () => {
    expect(
      availablePersonDays(
        capacity("s", [
          { availability: 100, daysOff: 0 },
          { availability: 50, daysOff: 2 },
          { availability: 100, daysOff: 12 },
        ])
      )
    ).toBe(14);
  });

  it("leaves the Capacity Planner's example members out", () => {
    const plan = capacity("s", [
      { availability: 100, daysOff: 0 },
      { id: "example-member-1", availability: 100, daysOff: 0 },
    ]);
    expect(availablePersonDays(plan)).toBe(10);
    expect(availablePersonDays(plan, { includeExamples: true })).toBe(20);
  });

  it("uses each sprint's own plan only, never the fallback, and skips zero person-days", () => {
    const sprints = finishedRun([20, 30, 40]);
    const plans = [
      capacity(null, [{ availability: 100, daysOff: 0 }]),
      capacity("f2", [{ availability: 100, daysOff: 0 }]),
      capacity("f3", [{ availability: 100, daysOff: 10 }]),
    ];
    const r = velocityPerPersonDay(sprints, plans);
    expect(r.perSprint).toEqual([{ sprintId: "f2", points: 30, personDays: 10, perDay: 3 }]);
    expect(r.average).toBe(3);
    expect(velocityPerPersonDay(sprints, undefined)).toEqual({
      perSprint: [],
      average: null,
      count: 0,
    });
  });

  it("is a ratio of sums over velocity's window", () => {
    const sprints = finishedRun([10, 20, 30, 40]);
    const plans = sprints.map((s, i) =>
      capacity(s.id, [{ availability: 100, daysOff: i === 3 ? 5 : 0 }])
    );
    // f2..f4: 90 points over 10 + 10 + 5 person-days.
    expect(velocityPerPersonDay(sprints, plans).average).toBe(3.6);
    expect(toVelocityRows(sprints, plans).map((r) => r.perDay)).toEqual([1, 2, 3, 8]);
  });
});

/* ── Closing and creating ───────────────────────────────────────────── */

describe("typing points never closes a sprint", () => {
  it("writes only the points", () => {
    expect(completedPointsPatch(29)).toEqual({ pointsCompleted: 29 });
    expect(completedPointsPatch(null)).toEqual({ pointsCompleted: undefined });
  });

  it("offers to close an open sprint once its end date has gone by", () => {
    const open = sprint({ id: "o", status: "active", endDate: "2026-10-21" });
    expect(shouldOfferClose(open, TODAY)).toBe(true);
    expect(shouldOfferClose({ ...open, endDate: "2026-10-22" }, TODAY)).toBe(false);
    expect(shouldOfferClose({ ...open, status: "completed" }, TODAY)).toBe(false);
    // An undated row (the old tool's) only once points were typed.
    expect(shouldOfferClose({ ...open, endDate: "" }, TODAY)).toBe(false);
    expect(shouldOfferClose({ ...open, endDate: "", pointsCompleted: 4 }, TODAY)).toBe(true);
  });

  it("asks, then closes with carry-over as one change that Undo puts back", () => {
    const ended = sprint({
      id: "s3",
      name: "Sprint 3",
      startDate: "2026-09-28",
      endDate: "2026-10-11",
      status: "active",
      pointsPlanned: 13,
    });
    const next = sprint({
      id: "s4",
      name: "Sprint 4",
      startDate: "2026-10-12",
      endDate: "2026-10-25",
      status: "active",
      pointsPlanned: 20,
    });
    const stories: Story[] = [
      { id: "st1", title: "Checkout", points: 8, status: "done", sprintId: "s3" },
      { id: "st2", title: "Refunds", points: 5, status: "in_progress", sprintId: "s3" },
    ];
    useWorkspaceStore.setState({ sprints: [ended, next], stories, sprintSeries: [] });
    renderVelocity();

    commit(screen.getByRole("spinbutton", { name: "Completed points for Sprint 3" }), "8");
    expect(stored("s3")).toMatchObject({ pointsCompleted: 8, status: "active" });
    expect(logs.at(-1)).toEqual({
      action: "sprint_updated",
      payload: { sprintId: "s3", field: "completed", value: 8 },
    });

    fireEvent.click(screen.getByRole("button", { name: "Close Sprint 3" }));
    const dialog = screen.getByRole("dialog");
    // From the board: the done story's points.
    expect(within(dialog).getByRole("spinbutton", { name: /Completed points/ })).toHaveValue(8);
    expect(within(dialog).getByText("Refunds")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("radio", { name: "Into Sprint 4" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Close sprint" }));

    expect(stored("s3")).toMatchObject({ status: "completed", pointsCompleted: 8 });
    const moved = ws().stories.find((s) => s.id === "st2");
    expect(moved?.sprintId).toBe("s4");
    expect(moved?.sprintHistory?.at(-1)).toMatchObject({
      from: "s3",
      sprintId: "s4",
      carriedOver: true,
    });
    expect(toastSpy.mock.calls.at(-1)?.[0]).toBe("Closed Sprint 3 with 8 points done");
    expect(logs.at(-1)).toMatchObject({
      action: "sprint_closed",
      payload: { sprintId: "s3", pointsCompleted: 8, carryOver: "next", moved: 1, movedTo: "s4" },
    });

    undoLast();
    expect(stored("s3")).toMatchObject({ status: "active", pointsCompleted: 8 });
    expect(ws().stories.find((s) => s.id === "st2")?.sprintId).toBe("s3");
  });

  it("says when the close replaced the points typed in the row, and Undo brings them back", () => {
    const ended = sprint({
      id: "s3",
      name: "Sprint 3",
      startDate: "2026-09-28",
      endDate: "2026-10-11",
      status: "active",
      pointsPlanned: 13,
    });
    const stories: Story[] = [
      { id: "st1", title: "Checkout", points: 8, status: "done", sprintId: "s3" },
      { id: "st2", title: "Refunds", points: 5, status: "in_progress", sprintId: "s3" },
    ];
    useWorkspaceStore.setState({ sprints: [ended], stories, sprintSeries: [] });
    renderVelocity();
    commit(screen.getByRole("spinbutton", { name: "Completed points for Sprint 3" }), "11");
    fireEvent.click(screen.getByRole("button", { name: "Close Sprint 3" }));
    const dialog = screen.getByRole("dialog");
    // The shared dialog starts from the board (8), not the 11 typed in the row.
    expect(within(dialog).getByRole("spinbutton", { name: /Completed points/ })).toHaveValue(8);
    fireEvent.click(within(dialog).getByRole("radio", { name: /Decide later/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Close sprint" }));

    expect(stored("s3")).toMatchObject({ status: "completed", pointsCompleted: 8 });
    const [label, opts] = toastSpy.mock.calls.at(-1) as [string, { description?: string }];
    expect(label).toBe("Closed Sprint 3 with 8 points done");
    expect(opts.description).toBe(
      "1 unfinished story wait in Sprint Planning. It replaces the 11 points typed here."
    );
    undoLast();
    expect(stored("s3")).toMatchObject({ status: "active", pointsCompleted: 11 });
  });

  it("says nothing extra when the close keeps the typed points", () => {
    useWorkspaceStore.setState({
      sprints: [
        sprint({
          id: "s3",
          name: "Sprint 3",
          startDate: "2026-09-28",
          endDate: "2026-10-11",
          status: "active",
          pointsCompleted: 9,
        }),
      ],
    });
    renderVelocity();
    fireEvent.click(screen.getByRole("button", { name: "Close Sprint 3" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Close sprint" })
    );
    const [, opts] = toastSpy.mock.calls.at(-1) as [string, { description?: string }];
    expect(opts.description).toBeUndefined();
  });

  it("Mark done opens the dialog instead of closing at once", () => {
    useWorkspaceStore.setState({
      sprints: [
        sprint({
          id: "run",
          name: "Sprint 9",
          startDate: "2026-10-19",
          endDate: "2026-11-01",
          status: "active",
          pointsCompleted: 6,
        }),
      ],
    });
    renderVelocity();
    // Named for its sprint, so a list of them reads apart.
    fireEvent.click(screen.getByRole("button", { name: "Mark done for Sprint 9" }));
    expect(stored("run")?.status).toBe("active");
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(stored("run")?.status).toBe("active");
  });
});

describe("points are checked before they are saved", () => {
  it("rejects negatives and non-numbers instead of clamping or reverting silently", () => {
    expect(validatePoints("-3", false)).toEqual({ ok: false, error: "Enter 0 or more points." });
    expect(validatePoints("abc", true)).toEqual({ ok: false, error: "Enter 0 or more points." });
    expect(validatePoints("", false)).toEqual({ ok: false, error: "Enter 0 or more points." });
    expect(validatePoints("", true)).toEqual({ ok: true, value: null });
    expect(validatePoints("0", false)).toEqual({ ok: true, value: 0 });
    expect(validatePoints("1e6", false)).toEqual({ ok: true, value: 1_000_000 });
  });

  it("shows the error under the field and keeps the draft; Escape puts the value back", () => {
    useWorkspaceStore.setState({ sprints: finishedRun([20]) });
    renderVelocity();
    const field = screen.getByRole("spinbutton", { name: "Committed points for Sprint 1" });
    commit(field, "-4");
    expect(stored("f1")?.pointsPlanned).toBe(30);
    expect(field).toHaveValue(-4);
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter 0 or more points.");
    fireEvent.keyDown(field, { key: "Escape" });
    expect(field).toHaveValue(30);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("new sprints come only from the New sprint dialog", () => {
  it("Commit opens it prefilled with the velocity and the next dates", () => {
    useWorkspaceStore.setState({ sprints: finishedRun([20, 30, 40]) });
    renderVelocity();
    fireEvent.click(screen.getByRole("button", { name: "Commit" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("spinbutton", { name: /Planned points/ })).toHaveValue(30);
    expect(within(dialog).getByLabelText(/First day/)).toHaveValue(TODAY);
    expect(ws().sprints).toHaveLength(3);
    fireEvent.click(within(dialog).getByRole("button", { name: "Create sprint" }));
    expect(ws().sprints.find((s) => s.name === "Sprint 4")).toMatchObject({
      pointsPlanned: 30,
      status: "active",
    });
    expect(logs.at(-1)?.action).toBe("next_sprint_planned");
  });

  it("won't open with a bad number", () => {
    useWorkspaceStore.setState({ sprints: finishedRun([20]) });
    renderVelocity();
    fireEvent.change(screen.getByRole("spinbutton", { name: /Points to commit/ }), {
      target: { value: "-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Commit" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter 0 or more points.");
    // The field that's wrong gets focus, not the button that was pressed.
    expect(screen.getByRole("spinbutton", { name: /Points to commit/ })).toHaveFocus();
  });

  it("falls back to the cadence's length when no sprint has real dates", () => {
    expect(nextSprintDates([], 14, TODAY)).toEqual({ start: TODAY, lengthDays: 14 });
    const [last] = finishedRun([20]);
    expect(nextSprintDates([last], 14, TODAY)).toEqual({ start: "2026-01-19", lengthDays: 13 });
  });
});

/* ── Results explain themselves ─────────────────────────────────────── */

describe("verdict, tiles and minimum samples", () => {
  it("says velocity, commitments met and person-days in one sentence", () => {
    const sprints = finishedRun([28, 30, 33]);
    const plans = sprints.map((s) => capacity(s.id, [{ availability: 100, daysOff: 0 }]));
    const rows = toVelocityRows(sprints, plans);
    expect(velocityVerdict(rows, velocitySummary(sprints, plans))).toBe(
      "Velocity is 30.3 points over the last 3 sprints; 3 of the last 3 sprints with a commitment met it (90–110%); 3.03 points per person-day."
    );
    expect(velocityVerdict([], velocitySummary([]))).toBe(
      "No sprints yet: add one to start tracking velocity."
    );
    const one = finishedRun([20]);
    expect(velocityVerdict(toVelocityRows(one), velocitySummary(one))).toBe(
      "Velocity is 20 points over the last sprint; the one sprint with a commitment missed it (67%). Close more sprints before planning on it."
    );
  });

  it("words each grade of a single sprint: over-delivery isn't a miss", () => {
    const say = (completed: number) => {
      const one = finishedRun([completed]);
      return velocityVerdict(toVelocityRows(one), velocitySummary(one));
    };
    expect(say(38)).toContain("the one sprint with a commitment did more than it committed (127%)");
    expect(say(30)).toContain("the one sprint with a commitment met it (100%)");
    expect(say(24)).toContain("the one sprint with a commitment came close to it (80%)");
    const unpointed = finishedRun([20], 0);
    expect(velocityVerdict(toVelocityRows(unpointed), velocitySummary(unpointed))).toContain(
      "no finished sprint had a commitment to meet"
    );
  });

  it("counts commitments met over the tile's window, and the tile, verdict and export say which", () => {
    // Four finished sprints: velocity looks at the last 3, say/do at all 4.
    const sprints = finishedRun([29, 31, 25, 30]);
    const summary = velocitySummary(sprints);
    expect(summary.velocity.count).toBe(3);
    expect(summary.sayDo).toMatchObject({ count: 4, byGrade: { met: 3, close: 1 } });
    const verdict = velocityVerdict(toVelocityRows(sprints), summary);
    expect(verdict).toContain("3 of the last 4 sprints with a commitment met it (90–110%)");
    const md = toMarkdown(toVelocityRows(sprints), new Date(2026, 9, 22), { summary, verdict });
    expect(md).toContain("**Say/do:** 3 of the last 4 sprints with a commitment met it (90–110%)");
    useWorkspaceStore.setState({ sprints });
    renderVelocity();
    expect(screen.getByText("3 of 4")).toBeInTheDocument();
    expect(
      screen.getByText(/^Last 4 sprints with a commitment, 90–110% of it/)
    ).toBeInTheDocument();
  });

  it("keeps spread, forecast, trend and change points behind their minimum samples", () => {
    useWorkspaceStore.setState({ sprints: finishedRun([20, 22, 24]) });
    renderVelocity();
    expect(
      screen.getByText("Close 2 more finished sprints to see the spread.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Close 1 more finished sprint to see a forecast of the next sprint.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Close 5 more finished sprints to see change points (CUSUM).")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Close 3 more finished sprints to see a trend test.")
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Add 3 more capacity plans for the last 3 sprints to see points per person-day."
      )
    ).toBeInTheDocument();
  });

  it("runs them once there are enough sprints", () => {
    // Mann-Kendall only calls a trend significant from 10 points.
    useWorkspaceStore.setState({
      sprints: finishedRun([20, 22, 24, 26, 28, 30, 32, 34, 36, 38]),
    });
    renderVelocity();
    expect(screen.getByText(/Mann-Kendall: velocity is trending up/)).toBeInTheDocument();
    expect(screen.queryByText(/to see the spread/)).toBeNull();
    expect(screen.queryByText(/to see a forecast/)).toBeNull();
    expect(screen.queryByText(/to see change points/)).toBeNull();
  });

  it("gates the CUSUM markers at MIN_SAMPLE.changePoint", () => {
    const seven = [10, 10, 10, 10, 10, 10, 30].map((completed, i) => ({
      name: `S${i + 1}`,
      completed,
    }));
    expect(changepointMarkers(seven)).toEqual([]);
  });

  it("says the chart in words with the shared velocity and the grade", () => {
    const rows = [
      { name: "Sprint 1", committed: 30, completed: 10, grade: "missed" as const, sayDoPct: 33 },
      { name: "Sprint 2", committed: 30, completed: 30, grade: "met" as const, sayDoPct: 100 },
    ];
    const text = velocityChartText(rows, { average: 20, count: 2 });
    expect(text.summary).toBe(
      "Velocity is 20 points over the last 2 finished sprints; Sprint 2 completed 30 of 30 committed (100%)."
    );
    expect(text.table.columns).toEqual(["Sprint", "Committed", "Completed", "Say/do"]);
    expect(text.table.rows[0]).toEqual(["Sprint 1", 30, 10, "Missed the commitment (33%)"]);
  });

  it("exports the shared numbers as Markdown", () => {
    const sprints = finishedRun([28, 30, 33]);
    const plans = [capacity("f3", [{ availability: 100, daysOff: 0 }])];
    const rows = toVelocityRows(sprints, plans);
    const md = toMarkdown(rows, new Date(2026, 9, 22), {
      summary: velocitySummary(sprints, plans),
      verdict: "Verdict line.",
    });
    expect(md).toContain("Verdict line.");
    expect(md).toContain("**Velocity:** 30.3 points");
    // One plan isn't enough to quote, as on the page: the sprint's own row still shows it.
    expect(md).toContain(
      "**Per person-day:** not enough capacity plans yet (1 of the last 3 finished sprints; needs 3)."
    );
    expect(md).not.toContain("**Per person-day:** 3.3");
    expect(md).toContain("| Sprint 3 | 30 | 33 | Met the commitment (110%) | 3.3 |  |");

    const planned = sprints.map((s) => capacity(s.id, [{ availability: 100, daysOff: 0 }]));
    expect(
      toMarkdown(toVelocityRows(sprints, planned), new Date(2026, 9, 22), {
        summary: velocitySummary(sprints, planned),
      })
    ).toContain("**Per person-day:** 3.03 points (3 sprints with a capacity plan)");
  });

  it("asks for finished sprints before plans when the velocity's window isn't full", () => {
    const sprints = finishedRun([28]);
    useWorkspaceStore.setState({
      sprints,
      capacityPlans: [capacity("f1", [{ availability: 100, daysOff: 0 }])],
    });
    renderVelocity();
    expect(
      screen.getByText("Close 2 more finished sprints to see points per person-day.")
    ).toBeInTheDocument();
    expect(screen.queryByText(/more capacity plans/)).toBeNull();
  });

  it("links to the Capacity Planner when only the plans are missing", () => {
    useWorkspaceStore.setState({ sprints: finishedRun([20, 22, 24]) });
    renderVelocity();
    expect(screen.getByRole("link", { name: "Plan capacity in Capacity Planner" })).toHaveAttribute(
      "href",
      "/capacity-planner"
    );
  });
});

/* ── AI prompts ─────────────────────────────────────────────────────── */

describe("AI prompts", () => {
  const sprints = [{ name: "Sprint 1", committed: 30, completed: 20 }];

  it("label the graded say/do and say what isn't known instead of a 0", () => {
    const prompts = velocityPrompts(sprints, {
      velocity: { average: 20, count: 1 },
      sayDo: { count: 1, met: 0, pct: 0 },
      spread: null,
      trend: "not enough sprints to say",
    });
    expect(prompts).toHaveLength(3);
    for (const p of prompts) {
      expect(p.prompt).toContain("Velocity: 20 pts/sprint (the last 1 finished sprint)");
      expect(p.prompt).toContain(
        "Met the commitment (90–110% of it): 0 of the last 1 sprint with a commitment (0%)"
      );
      expect(p.prompt).toContain("Standard deviation: not enough finished sprints yet");
      expect(p.prompt).toContain("Trend direction: not enough sprints to say");
      // The builder's own block is gone: no pass/fail label, no made-up zero.
      expect(p.prompt).not.toContain("completed ≥ committed");
      expect(p.prompt).not.toContain("Standard Deviation:");
      expect(p.prompt).toContain("## Questions");
    }
  });

  it("quote a spread once there is one, and no velocity before a sprint finishes", () => {
    const [p] = velocityPrompts(sprints, {
      velocity: { average: null, count: 0 },
      sayDo: { count: 0, met: 0, pct: null },
      spread: 2.345,
      trend: "up",
    });
    expect(p.prompt).toContain("Velocity: not known yet (no finished sprint)");
    expect(p.prompt).toContain(
      "Met the commitment (90–110% of it): no finished sprint had a commitment"
    );
    expect(p.prompt).toContain("Standard deviation: 2.3 pts");
    // No finished sprint: no prompts at all.
    expect(
      velocityPrompts([], {
        velocity: { average: null, count: 0 },
        sayDo: { count: 0, met: 0, pct: null },
        spread: null,
        trend: "up",
      })
    ).toEqual([]);
  });
});

/* ── First run ──────────────────────────────────────────────────────── */

describe("first run", () => {
  it("offers an example that shows every column and writes nothing", () => {
    renderVelocity();
    expect(screen.getByText(/No sprints yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(screen.getByText("Example data.")).toBeInTheDocument();
    expect(screen.getAllByText(/points per person-day/).length).toBeGreaterThan(0);
    expect(screen.getByText("Per person-day")).toBeInTheDocument();
    expect(screen.queryAllByRole("textbox")).toEqual([]);
    expect(ws().sprints).toEqual([]);
    expect(ws().capacityPlans ?? []).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(screen.getByText(/No sprints yet/)).toBeInTheDocument();
  });

  it("uses example ids for everything it invents", () => {
    const ex = buildExample(TODAY);
    expect(ex.sprints.every((s) => isExampleId(s.id))).toBe(true);
    expect(ex.capacityPlans.flatMap((p) => p.members).every((m) => isExampleId(m.id))).toBe(true);
    const s = velocitySummary(ex.sprints, ex.capacityPlans, { includeExamples: true });
    expect(s.perPersonDay.count).toBe(3);
    // Left out unless the page asks for them: never in the team's own numbers.
    expect(velocitySummary(ex.sprints, ex.capacityPlans).perPersonDay.count).toBe(0);
    expect(velocity(ex.sprints).count).toBe(3);
  });
});

describe("theme colours", () => {
  it("uses no hex colours in the tool's files", () => {
    const dir = path.resolve(__dirname, "../../src/app/(tools)/velocity");
    for (const name of readdirSync(dir)) {
      const src = readFileSync(path.join(dir, name), "utf8");
      expect(src, name).not.toMatch(/#[0-9a-fA-F]{3,8}\b(?![-\w])/);
      expect(src, name).not.toMatch(/rgba?\(/);
    }
  });
});
