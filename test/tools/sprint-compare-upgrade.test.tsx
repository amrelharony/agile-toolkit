import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  HealthCheck,
  HealthCheckEntry,
  HealthDimension,
  MoodEntry,
  Sprint,
  SprintGoal,
  SprintSeries,
  Story,
} from "@/lib/stores/workspace-types";
import { HEALTH_CHECK_DIMENSIONS } from "@/lib/stores/workspace-types";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { useSprintMigrationStore } from "@/lib/sprints/migration-status";
import {
  HEALTH_CHECK_DOC_ID,
  QUALITY_DIMENSIONS as QUALITY_TWIN,
  averageScore,
  defaultComparedIds,
  isFinishedSprint,
  moodToScore,
  qualityShare,
  shareToScore,
  sprintHealthCheck,
  sprintMood,
  sprintScores,
  type CompareInput,
} from "@/lib/sprints/compare";
import { moodDuring } from "@/lib/team/mood";
import { QUALITY_DIMENSIONS, healthCheckFor, healthShare } from "@/lib/health-check/score";
import {
  COMPARE_PINS_KEY,
  clearComparePins,
  readComparePins,
  writeComparePins,
} from "@/lib/sprints/compare-pins";
import { SPRINT_COMPARE_PINS_KEY } from "@/lib/sprints/legacy-keys";
import { hubTiles } from "@/lib/sprints/hub-view";
import { sprintStatus } from "@/lib/sprints/metrics";
import { goalDocId } from "@/lib/sprints/goal-doc";

/**
 * Sprint Comparison, upgraded: Velocity, Scope Stability, Goal Achievement
 * and Predictability are computed from the sprint's data; Team Happiness and
 * Quality are prefilled from Mood Tracker and the Squad Health Check and
 * stay editable; every score says where it came from; typed values are
 * checked, not clamped; the pins left the tool's raw storage for a lib
 * module with the same key and format; colours are theme tokens.
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
vi.mock("@/app/(tools)/sprint-compare/charts", () => ({ SprintRadarChart: () => null }));
// ChartCard's ResponsiveContainer needs one; jsdom doesn't ship it.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import {
  SprintCompareClient,
  validateRating,
} from "@/app/(tools)/sprint-compare/sprint-compare-client";
import { buildExample } from "@/app/(tools)/sprint-compare/example";
import { buildRows, radarData, scoresBySprint } from "@/app/(tools)/sprint-compare/view";
import { sprintRadarText } from "@/app/(tools)/sprint-compare/chart-text";
import { compareVerdict, weakestDimension } from "@/app/(tools)/sprint-compare/verdict";
import { toMarkdown } from "@/app/(tools)/sprint-compare/markdown";
import { PINS_KEY, defaultPins } from "@/app/(tools)/sprint-compare/pins";

/* ── Fixtures ───────────────────────────────────────────────────────── */

const sprint = (n: number, over: Partial<Sprint> = {}): Sprint => ({
  id: `s${n}`,
  name: `Sprint ${n}`,
  startDate: `2026-0${n}-01`,
  endDate: `2026-0${n}-14`,
  pointsPlanned: 30,
  pointsCompleted: 24 + n,
  status: "completed",
  ...over,
});
const S1 = sprint(1);
const S2 = sprint(2);
const S3 = sprint(3);
const SPRINTS = [S1, S2, S3];

const input = (over: Partial<CompareInput> = {}): CompareInput => ({
  sprint: S3,
  sprints: SPRINTS,
  stories: [],
  ...over,
});

const mood = (id: string, date: string, score: MoodEntry["score"], over: Partial<MoodEntry> = {}) =>
  ({ id, memberId: `p-${id}`, date, score, ...over }) as MoodEntry;

const lights = (
  sprintName: string,
  date: string,
  set: Partial<Record<HealthDimension, "green" | "yellow" | "red">>,
  id = `h-${sprintName}-${date}`
): HealthCheckEntry => ({
  id,
  sprintName,
  date,
  scores: Object.fromEntries(
    HEALTH_CHECK_DIMENSIONS.map((d) => [d, { light: set[d] ?? "green", trend: "same" }])
  ) as HealthCheckEntry["scores"],
});
const healthDoc = (history: HealthCheckEntry[], current?: HealthCheckEntry): HealthCheck => ({
  id: HEALTH_CHECK_DOC_ID,
  current: current ?? { sprintName: "", scores: lights("", "", {}).scores },
  history,
});

const ws = () => useWorkspaceStore.getState();
const seriesOf = (id: string) => ws().sprintSeries?.find((s) => s.id === id);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 22, 9, 0, 0));
  toastSpy.mockReset();
  logs.length = 0;
  window.localStorage.clear();
  resetSelectedSprint();
  useSprintMigrationStore.setState({ status: "idle" });
});
afterEach(() => {
  vi.useRealTimers();
  useWorkspaceStore.setState({
    sprints: [],
    sprintSeries: [],
    stories: [],
    sprintGoals: [],
    moodEntries: [],
    healthChecks: [],
  });
});

/* ── Computed scores ────────────────────────────────────────────────── */

describe("computed scores", () => {
  it("Predictability is the graded say/do; no commitment means not scored", () => {
    // 27 of 30: 90%, met; the score is how close delivery came either way.
    expect(sprintScores(input()).Predictability).toMatchObject({
      value: 9.1,
      source: "computed",
      from: "Velocity",
      editable: false,
    });
    expect(sprintScores(input()).Predictability.basis).toBe(
      "27 of 30 points committed (90%, met the commitment)"
    );
    const zero = { ...S3, pointsPlanned: 0 };
    expect(
      sprintScores(input({ sprint: zero, sprints: [S1, S2, zero] })).Predictability
    ).toMatchObject({ value: null, source: "none", missing: "commitment" });
    const running = { ...S3, status: "active" as const, pointsCompleted: 12 };
    expect(sprintScores(input({ sprint: running })).Predictability).toMatchObject({
      value: null,
      missing: "points",
    });
  });

  it("Velocity is against the team's best, only from three finished sprints", () => {
    // 27 against the best of 27: 10.
    expect(sprintScores(input()).Velocity).toMatchObject({ value: 10, source: "computed" });
    expect(sprintScores(input({ sprint: S1 })).Velocity.value).toBe(shareToScore(25 / 27));
    const two = sprintScores(input({ sprints: [S2, S3] })).Velocity;
    expect(two).toMatchObject({ value: null, missing: "history" });
    expect(two.basis).toContain("1 more to go");
  });

  it("Goal Achievement reads the Sprint Goal's answer: met, partly, not met", () => {
    const goal = (met?: "met" | "partly" | "not-met"): SprintGoal => ({
      id: goalDocId("s3"),
      sprintId: "s3",
      businessObjective: "",
      goal: "Ship it",
      criteria: [],
      keyResults: [],
      ...(met ? { outcome: { met, decidedAt: "2026-03-14T12:00:00.000Z" } } : {}),
    });
    expect(sprintScores(input({ goals: [goal("met")] }))["Goal Achievement"].value).toBe(10);
    expect(sprintScores(input({ goals: [goal("partly")] }))["Goal Achievement"].value).toBe(5.5);
    expect(sprintScores(input({ goals: [goal("not-met")] }))["Goal Achievement"].value).toBe(1);
    expect(sprintScores(input({ goals: [goal()] }))["Goal Achievement"]).toMatchObject({
      value: null,
      missing: "goal",
      basis: "No answer to “Did we meet the goal?” yet.",
    });
    // Another sprint's goal doesn't count.
    expect(
      sprintScores(input({ goals: [{ ...goal("met"), id: goalDocId("s2") }] }))["Goal Achievement"]
        .value
    ).toBeNull();
  });

  it("Scope Stability reads the stories' moves, else Burnup's scope log", () => {
    const stories: Story[] = [
      {
        id: "a",
        title: "Planned on day 0",
        points: 5,
        status: "done",
        sprintId: "s3",
        sprintHistory: [{ sprintId: "s3", at: "2026-03-01T09:00:00", points: 5 }],
      },
      {
        id: "b",
        title: "Joined on day 3",
        points: 3,
        status: "done",
        sprintId: "s3",
        sprintHistory: [{ sprintId: "s3", at: "2026-03-04T09:00:00", points: 3 }],
      },
      {
        id: "c",
        title: "Dropped on day 5",
        points: 3,
        status: "backlog",
        sprintHistory: [
          { sprintId: "s3", at: "2026-03-01T09:00:00", points: 3 },
          { from: "s3", at: "2026-03-06T09:00:00", points: 3 },
        ],
      },
    ];
    const fromMoves = sprintScores(input({ stories }))["Scope Stability"];
    // +3 −3 against 30: 20% churn.
    expect(fromMoves).toMatchObject({ value: shareToScore(0.8), from: "Sprint board" });
    expect(fromMoves.basis).toContain("(20% churn), from the stories' moves");

    const series: SprintSeries[] = [{ id: "s3", days: [{ day: 4, scope: 36 }] }];
    expect(sprintScores(input({ series }))["Scope Stability"]).toMatchObject({
      value: shareToScore(0.8),
      from: "Burnup",
    });
    expect(sprintScores(input())["Scope Stability"]).toMatchObject({
      value: null,
      missing: "scope",
    });
  });

  it("Scope Stability waits for the close, like Velocity and Predictability", () => {
    // Stories planned into a sprint that hasn't started: their joins come
    // before its first day, which would read as no churn at all (a 10).
    const planned = sprint(4, { status: "planned", pointsCompleted: undefined });
    const stories: Story[] = [
      {
        id: "p1",
        title: "Planned ahead",
        points: 8,
        status: "todo",
        sprintId: "s4",
        sprintHistory: [{ sprintId: "s4", at: "2026-03-20T09:00:00", points: 8 }],
      },
    ];
    const all = [...SPRINTS, planned];
    const notYet = sprintScores(input({ sprint: planned, sprints: all, stories }))[
      "Scope Stability"
    ];
    expect(notYet).toMatchObject({ value: null, source: "none", missing: "points" });
    expect(notYet.basis).toBe("Close the sprint with its completed points.");
    // A running one, even with a scope log: its scope can still change.
    const running = { ...planned, status: "active" as const };
    const series: SprintSeries[] = [{ id: "s4", days: [{ day: 2, scope: 30 }] }];
    expect(
      sprintScores(input({ sprint: running, sprints: [...SPRINTS, running], stories, series }))[
        "Scope Stability"
      ].value
    ).toBeNull();
    // So an unstarted sprint has no average to take a default pin with.
    expect(
      averageScore(sprintScores(input({ sprint: planned, sprints: all, stories })))
    ).toBeNull();
  });

  it("Goal Achievement knows a goal typed on the sprint itself", () => {
    const withGoal = { ...S3, goal: "Ship guest checkout" };
    expect(
      sprintScores(input({ sprint: withGoal, sprints: [S1, S2, withGoal] }))["Goal Achievement"]
        .basis
    ).toBe("No answer to “Did we meet the goal?” yet.");
    expect(sprintScores(input())["Goal Achievement"].basis).toBe(
      "No sprint goal recorded for this sprint."
    );
    const answered: SprintGoal = {
      id: goalDocId("s3"),
      sprintId: "s3",
      businessObjective: "",
      goal: "",
      criteria: [],
      keyResults: [],
      outcome: { met: "met", decidedAt: "2026-03-14T12:00:00.000Z" },
    };
    expect(
      sprintScores(input({ sprint: withGoal, sprints: [S1, S2, withGoal], goals: [answered] }))[
        "Goal Achievement"
      ].basis
    ).toBe("Goal met: “Ship guest checkout”");
  });
});

/* ── Prefilled scores ───────────────────────────────────────────────── */

describe("prefilled scores", () => {
  it("Team Happiness maps the sprint's mood (1–5) onto 1–10 from three check-ins", () => {
    expect(moodToScore(1)).toBe(1);
    expect(moodToScore(5)).toBe(10);
    expect(moodToScore(3)).toBe(5.5);
    const entries = [
      mood("1", "2026-03-02", 4),
      mood("2", "2026-03-03", 5),
      mood("3", "2026-03-09", 3),
      // Not counted: a placeholder, an example row, and a day outside the sprint.
      mood("4", "2026-03-04", 1, { isPlaceholder: true }),
      mood("example-5", "2026-03-05", 1),
      mood("6", "2026-04-02", 1),
    ];
    const s = sprintScores(input({ moodEntries: entries }))["Team Happiness"];
    expect(s).toMatchObject({
      value: 7.8,
      source: "prefilled",
      from: "Mood Tracker",
      editable: true,
    });
    expect(s.basis).toBe("4/5 from 3 check-ins by 3 people");
    expect(
      sprintScores(input({ moodEntries: entries.slice(0, 2) }))["Team Happiness"]
    ).toMatchObject({ value: null, missing: "mood", editable: true });
  });

  it("Quality reads the sprint's health check by name, else by date; yellow counts half", () => {
    const named = healthDoc([
      lights("sprint 3 ", "2026-05-20", { "Easy to Release": "yellow" }),
      lights("Sprint 2", "2026-03-15", { "Health of Codebase": "red" }),
    ]);
    expect(sprintScores(input({ healthChecks: [named] })).Quality).toMatchObject({
      value: shareToScore(0.75),
      source: "prefilled",
      from: "Squad Health Check",
    });
    // No name match: the check taken in the sprint's retro window.
    const dated = healthDoc([lights("Q1 check", "2026-03-16", { "Health of Codebase": "red" })]);
    expect(sprintScores(input({ healthChecks: [dated] })).Quality.value).toBe(shareToScore(0.5));
    // The draft in progress isn't a saved check.
    const draft = healthDoc([], lights("Sprint 3", "2026-03-14", { "Easy to Release": "red" }));
    expect(sprintScores(input({ healthChecks: [draft] })).Quality).toMatchObject({
      value: null,
      missing: "health",
    });
  });

  it("a typed rating overrides the prefill; without one the prefill shows", () => {
    const entries = [1, 2, 3].map((i) => mood(`${i}`, `2026-03-0${i + 1}`, 4));
    const typed: SprintSeries[] = [{ id: "s3", ratings: { "Team Happiness": 3 } }];
    const s = sprintScores(input({ moodEntries: entries, series: typed }))["Team Happiness"];
    expect(s).toMatchObject({ value: 3, source: "typed", editable: true, typed: 3 });
    expect(s.basis).toContain("Mood Tracker suggested 7.8");
  });
});

describe("typed ratings on computed dimensions", () => {
  it("are shown only while the computation has no input, and never deleted", () => {
    const legacy: SprintSeries[] = [
      { id: "s3", ratings: { Velocity: 4, "Goal Achievement": 6, Ignored: 9 } },
    ];
    const s = sprintScores(input({ series: legacy }));
    // Velocity can be computed: the old typed 4 is kept but not used.
    expect(s.Velocity).toMatchObject({ value: 10, source: "computed", typed: 4 });
    // No goal answer: the old typed 6 stands, labelled.
    expect(s["Goal Achievement"]).toMatchObject({ value: 6, source: "typed", editable: false });
    expect(s["Goal Achievement"].basis).toMatch(/^Typed earlier\./);
    // Unknown keys and out-of-range values don't count.
    expect(
      sprintScores(input({ series: [{ id: "s3", ratings: { Quality: 14 } }] })).Quality.value
    ).toBeNull();
  });
});

describe("averages agree with the cockpit's rating tile", () => {
  it("averages the scored dimensions only, and the tile shows the same number", () => {
    const scores = sprintScores(input());
    const avg = averageScore(scores);
    // Predictability 9.1, Velocity 10; the rest not scored.
    expect(avg).toBe(9.6);
    const tiles = hubTiles(
      S3,
      sprintStatus(S3, undefined),
      { average: null, count: 0 },
      { rating: avg }
    );
    expect(tiles.find((t) => t.id === "rating")?.value).toBe("9.6");
    // Without the option, the old typed-ratings average (none here): no tile.
    expect(
      hubTiles(S3, sprintStatus(S3, undefined), { average: null, count: 0 }).find(
        (t) => t.id === "rating"
      )
    ).toBeUndefined();
    expect(
      hubTiles(S3, sprintStatus(S3, undefined), { average: null, count: 0 }, { rating: null }).find(
        (t) => t.id === "rating"
      )
    ).toBeUndefined();
  });
});

/* ── Server-safe twins ──────────────────────────────────────────────── */

describe("the server-safe twins agree with the shared readers", () => {
  const entries = [
    mood("1", "2026-03-02", 4),
    mood("2", "2026-03-03T18:30:00.000Z", 5),
    mood("3", "2026-03-14", 2),
    mood("4", "2026-03-04", 1, { isPlaceholder: true }),
    mood("example-5", "2026-03-05", 1),
    mood("6", "2026-04-02", 1),
    mood("7", "not a date", 3),
  ];

  it("mood over a sprint", () => {
    for (const [start, end] of [
      ["2026-03-01", "2026-03-14"],
      ["2026-03-02", "2026-03-02"],
      ["2026-05-01", "2026-05-14"],
    ]) {
      expect(sprintMood(entries, start, end)).toEqual(moodDuring(entries, start, end));
    }
    expect(sprintMood(undefined, "2026-03-01", "2026-03-14")).toEqual(
      moodDuring(undefined, "2026-03-01", "2026-03-14")
    );
  });

  it("health share and the quality dimensions", () => {
    expect(QUALITY_TWIN).toEqual(QUALITY_DIMENSIONS);
    const scores = lights("x", "2026-03-15", {
      "Easy to Release": "yellow",
      "Health of Codebase": "red",
      Fun: "yellow",
    }).scores;
    expect(qualityShare(scores, QUALITY_DIMENSIONS)).toBe(healthShare(scores, QUALITY_DIMENSIONS));
    expect(qualityShare(scores)).toBe(healthShare(scores));
    expect(qualityShare({})).toBe(healthShare({}));
  });

  it("the health check for a sprint", () => {
    const cancelled = sprint(4, { status: "cancelled" });
    const all = [...SPRINTS, cancelled, sprint(5, { id: "example-s5", name: "Sprint 5" })];
    const doc = healthDoc([
      lights("Sprint 1", "2026-01-10", {}),
      lights("sprint 1", "2026-01-12", {}, "h-later"),
      lights("Q1", "2026-03-18", {}),
      lights("Q1 again", "2026-03-20", {}, "h-q1b"),
      lights("April", "2026-04-17", {}),
      lights("Sprint 2", "2026-02-10", {}, "example-h"),
    ]);
    for (const s of all) {
      expect(sprintHealthCheck(doc, s, all), s.id).toEqual(healthCheckFor(doc, s, all));
    }
    expect(sprintHealthCheck(undefined, S1, all)).toEqual(healthCheckFor(undefined, S1, all));
  });
});

/* ── Pins ───────────────────────────────────────────────────────────── */

describe("pins", () => {
  it("keep the migration's key and its bare-array format", () => {
    expect(PINS_KEY).toBe(SPRINT_COMPARE_PINS_KEY);
    expect(COMPARE_PINS_KEY).toBe("agile-toolkit:sprint-compare:pins");
    writeComparePins(["s1", "s2"]);
    expect(window.localStorage.getItem(COMPARE_PINS_KEY)).toBe('["s1","s2"]');
    expect(readComparePins()).toEqual(["s1", "s2"]);
    clearComparePins();
    expect(window.localStorage.getItem(COMPARE_PINS_KEY)).toBeNull();
    expect(readComparePins()).toBeNull();
  });

  it("default to the newest sprints that pass the page's rule", () => {
    const open = sprint(4, { status: "active", pointsCompleted: undefined });
    const newest = [open, S3, S2, S1];
    const scores = scoresBySprint(newest, { stories: [] });
    const scored = (s: Sprint) => averageScore(scores.get(s.id)!) !== null;
    expect(defaultPins(newest, [], scored)).toEqual(["s3", "s2", "s1"]);
    // The page's rule: finished sprints, whatever has a score.
    expect(defaultPins(newest, [], isFinishedSprint)).toEqual(["s3", "s2", "s1"]);
    expect(defaultComparedIds([open], isFinishedSprint)).toEqual(["s4"]);
  });

  it("keep in memory what storage refuses, so a pin click still pins", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    try {
      writeComparePins(["s2"]);
      expect(readComparePins()).toEqual(["s2"]);
      expect(window.localStorage.getItem(COMPARE_PINS_KEY)).toBeNull();
    } finally {
      setItem.mockRestore();
    }
    // Once storage takes a write, it is the source again.
    writeComparePins(["s1"]);
    expect(window.localStorage.getItem(COMPARE_PINS_KEY)).toBe('["s1"]');
    clearComparePins();
    expect(readComparePins()).toBeNull();
  });
});

describe("the default comparison while rating", () => {
  it("doesn't take in a running sprint once it's rated, so its row stays put", () => {
    // Nothing pinned: the three finished sprints are compared.
    const running = sprint(4, { status: "active", pointsCompleted: undefined });
    useWorkspaceStore.setState({ sprints: [...SPRINTS, running], sprintSeries: [] });
    render(<SprintCompareClient />);
    // The running sprint is the shared selection: rated here, outside the comparison.
    expect(screen.getByText("3 of 5 compared")).toBeInTheDocument();
    expect(screen.getByText("Not in the comparison")).toBeInTheDocument();
    const happiness = screen.getByRole("spinbutton", { name: "Team Happiness for Sprint 4" });
    const block = happiness.closest("div.space-y-3");
    happiness.focus();
    fireEvent.change(happiness, { target: { value: "7" } });
    fireEvent.keyDown(happiness, { key: "Tab" });
    fireEvent.blur(happiness);
    expect(seriesOf("s4")?.ratings).toEqual({ "Team Happiness": 7 });
    // Still outside the comparison, in the same place, with the same boxes.
    expect(screen.getByText("3 of 5 compared")).toBeInTheDocument();
    expect(screen.getByText("Not in the comparison")).toBeInTheDocument();
    const quality = screen.getByRole("spinbutton", { name: "Quality for Sprint 4" });
    expect(quality.closest("div.space-y-3")).toBe(block);
    expect(window.localStorage.getItem(PINS_KEY)).toBeNull();
  });
});

/* ── The page ───────────────────────────────────────────────────────── */

describe("the page", () => {
  const MOOD = [1, 2, 3].map((i) => mood(`${i}`, `2026-03-0${i + 1}`, 4));

  beforeEach(() => {
    window.localStorage.setItem(PINS_KEY, JSON.stringify(["s3"]));
    useWorkspaceStore.setState({ sprints: SPRINTS, sprintSeries: [], moodEntries: MOOD });
  });

  it("shows each score with where it came from, and how to fix a gap", () => {
    render(<SprintCompareClient />);
    const happiness = screen.getByRole("spinbutton", { name: "Team Happiness for Sprint 3" });
    const row = happiness.closest("div.space-y-3") as HTMLElement;
    const velocity = row.querySelector('[data-dimension="Velocity"]') as HTMLElement;
    expect(within(velocity).getByText("From Velocity")).toBeInTheDocument();
    expect(within(velocity).queryByRole("spinbutton")).toBeNull();
    const goal = row.querySelector('[data-dimension="Goal Achievement"]') as HTMLElement;
    expect(within(goal).getAllByText("Not scored").length).toBeGreaterThan(0);
    expect(within(goal).getByRole("link", { name: /Did we meet the goal/ })).toHaveAttribute(
      "href",
      "/sprint-goal?sprint=s3"
    );
    // The prefill shows as the suggestion until someone rates it: in the
    // box, and as text the box is described by (a placeholder alone reads
    // as blank to a screen reader).
    expect(happiness).toHaveAttribute("placeholder", "7.8");
    expect(happiness).toHaveValue(null);
    expect(happiness).toHaveAccessibleDescription("Suggested: 7.8");
    // Rated: the suggestion moves into the basis line instead.
    fireEvent.change(happiness, { target: { value: "6" } });
    fireEvent.blur(happiness);
    expect(happiness).not.toHaveAccessibleDescription();
    expect(screen.getAllByText(/Mood Tracker suggested 7.8/).length).toBeGreaterThan(0);
  });

  it("saves a rating only when it's 1 to 10, and clearing brings the prefill back", () => {
    render(<SprintCompareClient />);
    const happiness = screen.getByRole("spinbutton", { name: "Team Happiness for Sprint 3" });
    fireEvent.change(happiness, { target: { value: "0" } });
    fireEvent.blur(happiness);
    expect(screen.getByRole("alert")).toHaveTextContent("Rate 1 to 10.");
    expect(seriesOf("s3")?.ratings).toBeUndefined();

    fireEvent.change(happiness, { target: { value: "6" } });
    fireEvent.blur(happiness);
    expect(seriesOf("s3")?.ratings).toEqual({ "Team Happiness": 6 });
    expect(logs.at(-1)).toEqual({
      action: "rating_set",
      payload: { sprintId: "s3", dimension: "Team Happiness", value: 6 },
    });

    fireEvent.change(happiness, { target: { value: "" } });
    fireEvent.blur(happiness);
    expect(seriesOf("s3")?.ratings).toEqual({});
    expect(happiness).toHaveAttribute("placeholder", "7.8");
  });

  it("puts the verdict and the sources in the Markdown", () => {
    render(<SprintCompareClient />);
    const md = screen.getByTestId("export-markdown").textContent ?? "";
    expect(md).toContain(
      "Sprint 3 is strongest on Velocity (10) and weakest on Team Happiness (7.8)."
    );
    expect(md).toContain(
      "- **Team Happiness:** From Mood Tracker · 4/5 from 3 check-ins by 3 people"
    );
  });

  it("exports nothing-scored as a dash, never a 0", () => {
    const planned = sprint(4, { status: "planned", pointsCompleted: undefined });
    const rows = buildRows(["s4"], [planned], scoresBySprint([planned], { stories: [] }));
    const md = toMarkdown(rows, new Date(2026, 9, 22), { verdict: compareVerdict(rows) });
    expect(md).toContain("Nothing scored yet. A dash means not scored.");
    expect(md).toContain("| Velocity | – |");
    expect(md).toContain("| **Average** | – |");
    expect(md).toContain(
      "- **Predictability:** Not scored · Close the sprint with its completed points."
    );
    expect(toMarkdown([], new Date(2026, 9, 22))).toContain("No sprints pinned yet.");
  });

  it("validates typed text", () => {
    expect(validateRating("")).toEqual({ ok: true, value: undefined });
    expect(validateRating("7.25")).toEqual({ ok: true, value: 7.3 });
    expect(validateRating("10")).toEqual({ ok: true, value: 10 });
    expect(validateRating("11")).toEqual({ ok: false, error: "Rate 1 to 10." });
    expect(validateRating("x")).toEqual({ ok: false, error: "Rate 1 to 10." });
  });
});

/* ── The radar ──────────────────────────────────────────────────────── */

describe("the radar", () => {
  it("skips a sprint's unscored dimensions instead of drawing them at the centre", async () => {
    const charts = await vi.importActual<typeof import("@/app/(tools)/sprint-compare/charts")>(
      "@/app/(tools)/sprint-compare/charts"
    );
    // Recharts puts a missing value at the centre (here 50,50).
    const points = [
      { x: 90, y: 50, value: 8 },
      { x: 50, y: 50, value: null },
      { x: 50, y: 10, value: 6 },
      { x: 20, y: 70, value: 4 },
    ];
    expect(charts.scoredVertices(points)).toEqual([points[0], points[2], points[3]]);
    expect(charts.scoredVertices(undefined)).toEqual([]);
    const { container } = render(
      <svg>
        {charts.ScoredRadarShape({
          points,
          stroke: "var(--accent)",
          fill: "var(--accent)",
          fillOpacity: 0.15,
          strokeWidth: 2,
        })}
      </svg>
    );
    const d = container.querySelector("path")?.getAttribute("d") ?? "";
    expect(d).toMatch(/^M90,50L50,10L20,70/);
    expect(d).not.toContain("50,50");
    // Loading the real Recharts is slow under a parallel run.
  }, 30_000);

  it("says in words which dimensions have no score", () => {
    const scores = scoresBySprint(SPRINTS, { stories: [] });
    const rows = buildRows(["s2", "s3"], SPRINTS, scores);
    const text = sprintRadarText(
      radarData(rows),
      rows.map((r) => ({ id: r.id, name: r.name }))
    );
    expect(text.summary).toContain(
      "Each shape leaves out the dimensions its sprint has no score for; none has a score for Quality, Scope Stability, Team Happiness and Goal Achievement."
    );
    // The table still lists all six.
    expect(text.table.rows).toHaveLength(6);
  });
});

/* ── Verdict ────────────────────────────────────────────────────────── */

describe("verdict", () => {
  it("compares the newest sprint with the one before", () => {
    const scores = scoresBySprint(SPRINTS, { stories: [] });
    const rows = buildRows(["s2", "s3"], SPRINTS, scores);
    // Velocity 9.7 → 10 and Predictability 8.8 → 9.1: a tie goes to the first.
    expect(compareVerdict(rows)).toBe(
      "Against Sprint 2, Sprint 3 improved most on Velocity (+0.3)."
    );
    expect(weakestDimension(rows)).toEqual({
      sprint: "Sprint 3",
      dim: "Predictability",
      value: 9.1,
    });
    expect(compareVerdict([])).toBe("Pin a sprint to compare it.");
    const none = scoresBySprint([sprint(4, { status: "planned", pointsCompleted: undefined })], {
      stories: [],
    });
    expect(
      compareVerdict(
        buildRows(["s4"], [sprint(4, { status: "planned", pointsCompleted: undefined })], none)
      )
    ).toMatch(/^Nothing scored yet/);
  });
});

/* ── First run ──────────────────────────────────────────────────────── */

describe("first run", () => {
  it("the example shows every kind of source and writes nothing", () => {
    render(<SprintCompareClient />);
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(screen.getByText("Example data.")).toBeInTheDocument();
    for (const chip of [
      "From Velocity",
      "From Sprint Goal",
      "From Burnup",
      "From Mood Tracker",
      "From Squad Health Check",
      "Rated by the team",
      "Not scored",
    ]) {
      expect(screen.getAllByText(chip).length, chip).toBeGreaterThan(0);
    }
    expect(ws().sprints).toEqual([]);
    expect(ws().sprintSeries ?? []).toEqual([]);
    expect(window.localStorage.getItem(PINS_KEY)).toBeNull();
    act(() => fireEvent.click(screen.getByRole("button", { name: "Clear example" })));
    expect(screen.getByText(/No sprints yet/)).toBeInTheDocument();
  });

  it("builds its rows from example ids", () => {
    const ex = buildExample("2026-10-22");
    expect(ex.sprints.every((s) => s.id.startsWith("example-"))).toBe(true);
    expect(ex.moodEntries.length).toBeGreaterThan(0);
  });
});

describe("theme colours", () => {
  it("uses no hex colours in the tool's files", () => {
    const dir = path.resolve(__dirname, "../../src/app/(tools)/sprint-compare");
    for (const name of readdirSync(dir)) {
      const src = readFileSync(path.join(dir, name), "utf8");
      expect(src, name).not.toMatch(/#[0-9a-fA-F]{3,8}\b(?![-\w])/);
      expect(src, name).not.toMatch(/rgba?\(|parseHex/);
    }
  });

  it("reads no raw localStorage in the tool's files", () => {
    const dir = path.resolve(__dirname, "../../src/app/(tools)/sprint-compare");
    for (const name of readdirSync(dir)) {
      expect(readFileSync(path.join(dir, name), "utf8"), name).not.toMatch(/\blocalStorage\s*\./);
    }
  });
});
