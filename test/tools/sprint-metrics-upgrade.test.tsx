import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { isExampleId } from "@/components/tool-frame/example-data";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint, SprintSeries, Story, StorySprintChange } from "@/lib/stores/workspace-types";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { useSprintMigrationStore } from "@/lib/sprints/migration-status";
import {
  DEFAULT_TREND_WINDOW,
  sprintCarryOver,
  sprintScope,
  sprintTrends,
  trendTests,
} from "@/lib/sprints/trends";

/**
 * Sprint Metrics, upgraded into the cross-sprint trend view: say/do,
 * carry-over and scope churn over the last N finished sprints (velocity's
 * order), each number with its source, statistics behind their minimum
 * samples, a window remembered per browser, and an example in memory.
 */

const logs = vi.hoisted(() => [] as { action: string; payload?: Record<string, unknown> }[]);
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload?: Record<string, unknown>) => logs.push({ action, payload }),
  }),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
}));
vi.mock("@/app/(tools)/sprint-metrics/charts", () => ({
  SayDoChart: () => null,
  ChurnChart: () => null,
}));

import { SprintMetricsClient } from "@/app/(tools)/sprint-metrics/sprint-metrics-client";
import { buildExample } from "@/app/(tools)/sprint-metrics/example";
import { trendVerdict } from "@/app/(tools)/sprint-metrics/verdict";
import { toMarkdown } from "@/app/(tools)/sprint-metrics/markdown";
import {
  WINDOW_KEY,
  carryOverText,
  churnChartText,
  churnPoints,
  normalizeWindow,
  sayDoChartText,
  scopeText,
  sourcesText,
} from "@/app/(tools)/sprint-metrics/view";

/* ── Fixtures ───────────────────────────────────────────────────────── */

/** Sprint n runs two weeks from 5 Jan + 14(n−1) days. */
const sprint = (n: number, over: Partial<Sprint> = {}): Sprint => {
  const start = new Date(Date.UTC(2026, 0, 5 + 14 * (n - 1))).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(2026, 0, 18 + 14 * (n - 1))).toISOString().slice(0, 10);
  return {
    id: `s${n}`,
    name: `Sprint ${n}`,
    startDate: start,
    endDate: end,
    pointsPlanned: 30,
    pointsCompleted: 30,
    status: "completed",
    ...over,
  };
};
/** Noon on day `d` of sprint n, local. */
const on = (n: number, d: number) => {
  const t = new Date(2026, 0, 5 + 14 * (n - 1) + d, 12, 0, 0);
  return t.toISOString();
};
const move = (over: Partial<StorySprintChange> & { at: string }): StorySprintChange => over;
const story = (id: string, over: Partial<Story> = {}): Story => ({
  id,
  title: id,
  points: 3,
  status: "done",
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 22, 9, 0, 0));
  logs.length = 0;
  window.localStorage.clear();
  resetSelectedSprint();
  useSprintMigrationStore.setState({ status: "idle" });
});
afterEach(() => {
  vi.useRealTimers();
  useWorkspaceStore.setState({ sprints: [], sprintSeries: [], stories: [] });
});

/* ── The window ─────────────────────────────────────────────────────── */

describe("the window", () => {
  const run = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => sprint(n));

  it("takes the latest N finished sprints by end date, oldest first, however stored", () => {
    const stored = [...run].reverse();
    const t = sprintTrends({ sprints: stored, stories: [], window: 3 });
    expect(t.rows.map((r) => r.sprint.id)).toEqual(["s6", "s7", "s8"]);
    expect(t).toMatchObject({ window: 3, finishedCount: 8 });
    expect(sprintTrends({ sprints: stored, stories: [], window: null }).rows).toHaveLength(8);
    expect(
      sprintTrends({ sprints: stored, stories: [], window: Number.POSITIVE_INFINITY }).window
    ).toBeNull();
    // The default is six (MIN_SAMPLE.trend); a bad window falls back to it.
    expect(DEFAULT_TREND_WINDOW).toBe(6);
    expect(sprintTrends({ sprints: stored, stories: [], window: 0 }).rows).toHaveLength(6);
    expect(sprintTrends({ sprints: stored, stories: [] }).rows).toHaveLength(6);
  });

  it("counts only finished sprints, and leaves the preview examples out", () => {
    const t = sprintTrends({
      sprints: [
        sprint(1),
        sprint(2, { status: "active", pointsCompleted: 20 }),
        sprint(3, { pointsCompleted: undefined }),
        sprint(4, { id: "example-preview-sprint-1" }),
      ],
      stories: [],
    });
    expect(t.rows.map((r) => r.sprint.id)).toEqual(["s1"]);
    expect(t.finishedCount).toBe(1);
  });

  it("is remembered per browser as one of the options", () => {
    expect(normalizeWindow(12)).toBe(12);
    expect(normalizeWindow("all")).toBe("all");
    expect(normalizeWindow(7)).toBe(6);
    expect(normalizeWindow("{oops")).toBe(6);
    expect(normalizeWindow(undefined)).toBe(6);
  });
});

/* ── Say/do ─────────────────────────────────────────────────────────── */

describe("say/do", () => {
  it("grades each sprint and counts the grades over the window", () => {
    const t = sprintTrends({
      sprints: [
        sprint(1, { pointsCompleted: 33 }), // 110%: met
        sprint(2, { pointsCompleted: 34 }), // 113%: over
        sprint(3, { pointsCompleted: 21 }), // 70%: close
        sprint(4, { pointsCompleted: 20 }), // 67%: missed
        sprint(5, { pointsPlanned: 0, pointsCompleted: 8 }), // nothing committed
      ],
      stories: [],
    });
    expect(t.rows.map((r) => r.sayDo?.grade ?? null)).toEqual([
      "met",
      "over",
      "close",
      "missed",
      null,
    ]);
    expect(t.sayDo).toEqual({ considered: 4, met: 1, close: 1, missed: 1, over: 1, meanPct: 90 });
  });

  it("quotes no mean below MIN_SAMPLE.average", () => {
    const t = sprintTrends({ sprints: [sprint(1), sprint(2)], stories: [] });
    expect(t.sayDo).toMatchObject({ considered: 2, met: 2, meanPct: null });
    expect(t.carryOver.meanPoints).toBeNull();
    expect(t.churn.meanPct).toBeNull();
  });
});

/* ── Carry-over ─────────────────────────────────────────────────────── */

describe("carry-over", () => {
  const s1 = sprint(1);

  it("reads the stories' moves: carried at the close, moved out after the end, still open", () => {
    const stories = [
      // Carried by the close dialog (at the close, on the last day).
      story("a", {
        points: 5,
        status: "in_progress",
        sprintId: "s2",
        sprintHistory: [
          move({ sprintId: "s1", at: on(1, 0), points: 5 }),
          move({ from: "s1", sprintId: "s2", at: on(1, 13), points: 5, carriedOver: true }),
        ],
      }),
      // Left with the sprint, then planned into the next one later.
      story("b", {
        points: 3,
        status: "todo",
        sprintId: "s2",
        sprintHistory: [
          move({ sprintId: "s1", at: on(1, 0), points: 3 }),
          move({ from: "s1", sprintId: "s2", at: on(1, 15), points: 3 }),
        ],
      }),
      // Still open in the closed sprint.
      story("c", { points: 2, status: "review", sprintId: "s1" }),
      // Done in it: not carried.
      story("d", { points: 8, status: "done", sprintId: "s1" }),
    ];
    expect(sprintCarryOver(s1, stories)).toEqual({
      count: 3,
      points: 10,
      pct: 33,
      source: "history",
    });
  });

  it("weighs a move by its recorded points, else the story's points now", () => {
    const stories = [
      story("a", {
        points: 8,
        sprintId: "s2",
        sprintHistory: [move({ from: "s1", sprintId: "s2", at: on(1, 13), carriedOver: true })],
      }),
      story("b", {
        points: 8,
        sprintId: "s2",
        sprintHistory: [
          move({ from: "s1", sprintId: "s2", at: on(1, 13), carriedOver: true, points: 2 }),
        ],
      }),
    ];
    expect(sprintCarryOver(s1, stories).points).toBe(10);
  });

  it("falls back to the stories left in it, then the numbers, then nothing", () => {
    const left = [story("o", { points: 4, status: "todo", sprintId: "s1" })];
    expect(sprintCarryOver(s1, left)).toMatchObject({ count: 1, points: 4, source: "stories" });
    expect(sprintCarryOver({ ...s1, pointsCompleted: 26 }, [])).toEqual({
      count: null,
      points: 4,
      pct: 13,
      source: "numbers",
    });
    // Over-delivered: nothing left over by the numbers.
    expect(sprintCarryOver({ ...s1, pointsCompleted: 34 }, []).points).toBe(0);
    expect(sprintCarryOver({ ...s1, pointsPlanned: 0 }, [])).toEqual({
      count: null,
      points: null,
      pct: null,
      source: "none",
    });
  });
});

/* ── Scope churn ────────────────────────────────────────────────────── */

describe("scope churn", () => {
  const s1 = sprint(1);

  it("counts what joined or left after day 0, never the plan or the close", () => {
    const stories = [
      // Planned on the first day: the plan.
      story("plan", {
        points: 5,
        sprintId: "s1",
        sprintHistory: [move({ sprintId: "s1", at: on(1, 0), points: 5 })],
      }),
      // Planned before the start: the plan too.
      story("early", {
        points: 2,
        sprintId: "s1",
        sprintHistory: [move({ sprintId: "s1", at: on(1, -3), points: 2 })],
      }),
      // Joined on day 4: added.
      story("added", {
        points: 3,
        sprintId: "s1",
        sprintHistory: [move({ sprintId: "s1", at: on(1, 4), points: 3 })],
      }),
      // Created in the sprint on day 6: added.
      story("new", {
        points: 1,
        sprintId: "s1",
        sprintHistory: [move({ sprintId: "s1", at: on(1, 6) })],
      }),
      // Carried in from an earlier sprint mid-way: part of the plan, not added.
      story("carried-in", {
        points: 4,
        sprintId: "s1",
        sprintHistory: [
          move({ sprintId: "s1", from: "s0", at: on(1, 2), points: 4, carriedOver: true }),
        ],
      }),
      // Dropped on day 5: removed.
      story("dropped", {
        points: 2,
        status: "backlog",
        sprintHistory: [
          move({ sprintId: "s1", at: on(1, 0), points: 2 }),
          move({ from: "s1", at: on(1, 5), points: 2 }),
        ],
      }),
      // Carried out at the close: carry-over, not a removal.
      story("carried-out", {
        points: 6,
        sprintId: "s2",
        sprintHistory: [
          move({ sprintId: "s1", at: on(1, 0), points: 6 }),
          move({ from: "s1", sprintId: "s2", at: on(1, 13), points: 6, carriedOver: true }),
        ],
      }),
    ];
    expect(sprintScope(s1, stories, undefined)).toEqual({
      added: 4,
      removed: 2,
      net: 2,
      churnPct: 20,
      source: "history",
    });
  });

  it("falls back to the daily log's scope readings, then says it isn't recorded", () => {
    const series: SprintSeries = {
      id: "s1",
      days: [
        { day: 3, scope: 36 },
        { day: 6, scope: 33 },
        { day: 7, remaining: 20 },
      ],
    };
    // +6, then −3, against 30 committed.
    expect(sprintScope(s1, [], series)).toEqual({
      added: 6,
      removed: 3,
      net: 3,
      churnPct: 30,
      source: "log",
    });
    // Burndown's flagged scope change, from the rise in remaining.
    const burndown: SprintSeries = {
      id: "s1",
      days: [
        { day: 0, remaining: 30 },
        { day: 2, remaining: 34, scopeChange: true },
      ],
    };
    expect(sprintScope(s1, [], burndown)).toMatchObject({ added: 4, source: "log" });
    expect(sprintScope(s1, [], undefined)).toEqual({
      added: 0,
      removed: 0,
      net: 0,
      churnPct: null,
      source: "none",
    });
  });

  it("doesn't take carry-overs alone as a record of the scope: the log answers", () => {
    const carriedIn = [
      story("in", {
        sprintId: "s1",
        sprintHistory: [move({ sprintId: "s1", from: "s0", at: on(1, 0), carriedOver: true })],
      }),
    ];
    const series: SprintSeries = { id: "s1", days: [{ day: 3, scope: 33 }] };
    expect(sprintScope(s1, carriedIn, series)).toMatchObject({ added: 3, source: "log" });
    expect(sprintScope(s1, carriedIn, undefined).source).toBe("none");
    // The carry-over is still read from the moves.
    expect(sprintCarryOver(s1, carriedIn).source).toBe("history");
  });

  it("can't place moves for a sprint without real dates: only its log says", () => {
    const undated = { ...s1, startDate: "2020-01-02", endDate: "" };
    const stories = [
      story("x", { sprintId: "s1", sprintHistory: [move({ sprintId: "s1", at: on(1, 4) })] }),
    ];
    expect(sprintScope(undated, stories, undefined).source).toBe("none");
  });

  it("has no churn % without a commitment", () => {
    const series: SprintSeries = { id: "s1", days: [{ day: 3, scope: 5 }] };
    expect(sprintScope({ ...s1, pointsPlanned: 0 }, [], series)).toMatchObject({
      added: 5,
      churnPct: null,
      source: "log",
    });
  });
});

/* ── Statistics and words ───────────────────────────────────────────── */

describe("statistics stay behind their minimum samples", () => {
  it("runs the drift tests only from MIN_SAMPLE.trend sprints", () => {
    const five = [1, 2, 3, 4, 5].map((n) => sprint(n, { pointsCompleted: 20 + n }));
    expect(trendTests(sprintTrends({ sprints: five, stories: [] }))).toEqual({
      sayDo: null,
      churn: null,
    });
    const six = [...five, sprint(6, { pointsCompleted: 26 })];
    const t = trendTests(sprintTrends({ sprints: six, stories: [] }));
    // It runs; Mann-Kendall only calls a trend from 10 points.
    expect(t.sayDo).toMatchObject({ significant: false });
    expect(t.sayDo?.s).toBeGreaterThan(0);
    // No sprint has a scope record: nothing to test.
    expect(t.churn).toBeNull();
  });

  it("has no verdict below MIN_SAMPLE.average sprints", () => {
    expect(trendVerdict(sprintTrends({ sprints: [sprint(1), sprint(2)], stories: [] }))).toBeNull();
    const three = [1, 2, 3].map((n) => sprint(n, { pointsCompleted: n === 2 ? 20 : 30 }));
    // No stories: the carry-over is from the numbers; no scope record, no churn.
    expect(trendVerdict(sprintTrends({ sprints: three, stories: [] }))).toBe(
      "Over the last 3 sprints the team met its commitment twice and carried over 3.3 points a sprint."
    );
  });

  it("describes each row and its sources", () => {
    const t = sprintTrends({
      sprints: [sprint(1, { pointsCompleted: 26 })],
      stories: [],
      series: [{ id: "s1", days: [{ day: 4, scope: 33 }] }],
    });
    const [row] = t.rows;
    expect(carryOverText(row)).toBe("4 points (13%)");
    expect(scopeText(row)).toBe("+3 / −0 (10%)");
    expect(sourcesText(row)).toBe(
      "Carry-over from the numbers (committed − done); scope from the daily log's scope"
    );
    expect(sayDoChartText(t).table.rows[0]).toEqual([
      "Sprint 1",
      "30",
      "26",
      "87%",
      "Close to the commitment",
    ]);
    expect(churnChartText(t).table.columns).toEqual([
      "Sprint",
      "Carried over",
      "Scope added",
      "Scope removed",
      "Churn",
      "Source",
    ]);
    // Removed scope draws downwards.
    expect(
      churnPoints(
        sprintTrends({
          sprints: [sprint(1)],
          stories: [],
          series: [{ id: "s1", days: [{ day: 4, scope: 27 }] }],
        })
      )[0]
    ).toMatchObject({ added: 0, removed: -3 });
  });

  it("exports the verdict, the averages and every row as Markdown", () => {
    const ex = buildExample("2026-10-22");
    const t = sprintTrends({ ...ex, includeExamples: true });
    const md = toMarkdown(t, { verdict: trendVerdict(t), now: new Date(2026, 9, 22) });
    expect(md).toMatch(/^# Sprint trends — 22 Oct 2026\n/);
    expect(md).toContain("The last 6 of 6 finished sprints, oldest first by end date.");
    expect(md).toContain(
      "| Sprint 3 | 36 | 23 | 64% (Missed the commitment) | 2 stories, 13 points (36%) |"
    );
    expect(md).toContain("Both from the stories' moves");
    expect(toMarkdown(sprintTrends({ sprints: [], stories: [] }))).toContain(
      "No finished sprints yet"
    );
  });
});

/* ── The example ────────────────────────────────────────────────────── */

describe("the example", () => {
  it("is six closed sprints whose stories carry their moves, all with example ids", () => {
    const ex = buildExample("2026-10-22");
    expect(ex.sprints.filter((s) => s.status === "completed")).toHaveLength(6);
    expect([...ex.sprints, ...ex.stories].every((x) => isExampleId(x.id))).toBe(true);
    expect(ex.stories.every((s) => (s.sprintHistory ?? []).length > 0)).toBe(true);
    expect(ex.stories.every((s) => (s.statusHistory ?? []).length > 0)).toBe(true);
    const t = sprintTrends({ ...ex, includeExamples: true });
    expect(t.rows.every((r) => r.carryOver.source === "history")).toBe(true);
    expect(trendVerdict(t)).toBe(
      "Over the last 6 sprints the team met its commitment 4 times, carried over 3.5 points a sprint and changed 7% of its scope mid-sprint."
    );
    // Its stories never count towards the team's own numbers.
    expect(sprintTrends({ ...ex }).rows.every((r) => r.carryOver.source !== "history")).toBe(true);
  });

  it("previews without writing anything", () => {
    render(<SprintMetricsClient />);
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(screen.getByText("Example data.")).toBeInTheDocument();
    expect(screen.getAllByText(/Sprint 3/).length).toBeGreaterThan(0);
    expect(useWorkspaceStore.getState().sprints).toEqual([]);
    expect(useWorkspaceStore.getState().stories).toEqual([]);
    expect(logs).toEqual([]);
  });
});

/* ── The page ───────────────────────────────────────────────────────── */

describe("the page", () => {
  const run = [1, 2, 3, 4, 5, 6, 7].map((n) => sprint(n, { pointsCompleted: 24 + n }));

  it("says how many more sprints to close before there's a trend", () => {
    useWorkspaceStore.setState({ sprints: run.slice(0, 2) });
    render(<SprintMetricsClient />);
    expect(
      screen.getByText("Close 1 more sprint with its points to see the trend.")
    ).toBeInTheDocument();
  });

  it("switches the window and remembers it", () => {
    useWorkspaceStore.setState({ sprints: run });
    render(<SprintMetricsClient />);
    expect(screen.getByRole("button", { name: "Last 6 sprints" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    // On the page and in the export.
    expect(screen.getAllByText(/The last 6 of 7 finished sprints/).length).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "All sprints" }));
    expect(screen.getAllByText(/All 7 finished sprints/).length).toBe(2);
    expect(window.localStorage.getItem(WINDOW_KEY)).toBe('"all"');
  });

  it("links every row to the cockpit", () => {
    useWorkspaceStore.setState({ sprints: run.slice(0, 3) });
    render(<SprintMetricsClient />);
    const links = screen.getAllByRole("link", { name: /Sprint 2 \(open in the cockpit\)/ });
    expect(links[0]).toHaveAttribute("href", "/sprint?sprint=s2");
  });
});

describe("contract", () => {
  const dir = path.resolve(__dirname, "../../src/app/(tools)/sprint-metrics");
  const files = (d: string): string[] =>
    readdirSync(d).flatMap((n) => {
      const p = path.join(d, n);
      return statSync(p).isDirectory() ? files(p) : [p];
    });

  it("reads no raw localStorage and uses no hex colours", () => {
    for (const file of files(dir)) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/\blocalStorage\s*\./);
      expect(src, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b(?![-\w])/);
      expect(src, file).not.toMatch(/rgba?\(/);
    }
  });
});
