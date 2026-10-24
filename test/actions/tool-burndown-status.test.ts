import { beforeEach, describe, expect, it } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  CEREMONY_CADENCE_ID,
  type Sprint,
  type SprintSeries,
  type Story,
} from "@/lib/stores/workspace-types";
import { burnSeries, burnStatus } from "@/lib/sprints/burn";
import { DEFAULT_CALENDAR, normalizeCalendar } from "@/lib/sprints/calendar";
import { DEFAULT_CADENCE } from "@/lib/sprints/cadence";
import { sprintStatus } from "@/lib/sprints/metrics";
import "@/lib/actions/tools/burndown";
import "@/lib/actions/tools/burnup";

/**
 * tool.burndown.status / tool.burnup.status read a sprint the way the
 * pages do (lib/sprints/burn on the team's calendar), and log_day merges
 * one day of the typed log the way the pages write it. Both have a server
 * handler; the browser handlers run here against the workspace store.
 */

const ctx = () => ({ userId: "u", source: "agent" as const, squadProfileIds: [] as string[] });
// The actions' results are plain JSON for an agent; the tests read them loosely.
type Result = Record<string, unknown> & {
  days: Array<Record<string, unknown>>;
  caveats: string[];
  entry: Record<string, unknown> | null;
  scopeVerdict: string;
};
const run = async (id: string, params: unknown) => {
  const action = registry.get(id)!;
  return (await action.handler(action.paramsSchema.parse(params), ctx())) as Result;
};

const at = (day: string) => `${day}T12:00:00.000Z`;
const ACTIVE: Sprint = {
  id: "s1",
  name: "Sprint 7",
  startDate: "2026-10-05",
  endDate: "2026-10-19",
  pointsPlanned: 20,
  status: "active",
};
const OLD: Sprint = {
  id: "s0",
  name: "Sprint 6",
  startDate: "2026-09-21",
  endDate: "2026-10-05",
  pointsPlanned: 18,
  pointsCompleted: 15,
  status: "completed",
};
const STORIES: Story[] = [
  { id: "a", title: "A", points: 8, status: "done", sprintId: "s1", doneAt: at("2026-10-07") },
  {
    id: "b",
    title: "B",
    points: 5,
    status: "todo",
    sprintId: "s1",
    sprintHistory: [{ sprintId: "s1", at: at("2026-10-08"), points: 5 }],
  },
  { id: "c", title: "C", points: 7, status: "in_progress", sprintId: "s1" },
];
const LOG: SprintSeries = {
  id: "s1",
  days: [
    { day: 0, remaining: 20 },
    { day: 2, remaining: 15 },
  ],
};

beforeEach(() => {
  useWorkspaceStore.setState({
    sprints: [OLD, ACTIVE],
    sprintSeries: [LOG],
    stories: STORIES,
    ceremonyCadences: [{ id: CEREMONY_CADENCE_ID, ...DEFAULT_CADENCE }],
  });
});

describe("tool.burndown.status", () => {
  it("is a read action with a server handler", () => {
    for (const id of ["tool.burndown.status", "tool.burnup.status"]) {
      const a = registry.get(id)!;
      expect(a.category).toBe("read");
      expect(typeof a.mcpHandler).toBe("function");
    }
    for (const id of ["tool.burndown.log_day", "tool.burnup.log_day"]) {
      const a = registry.get(id)!;
      expect(a.category).toBe("write");
      expect(typeof a.mcpHandler).toBe("function");
    }
  });

  it("defaults to the active sprint and returns the page's numbers", async () => {
    const r = await run("tool.burndown.status", { today: "2026-10-12" });
    const burn = burnSeries({
      sprint: ACTIVE,
      series: LOG,
      stories: STORIES,
      calendar: DEFAULT_CALENDAR,
      today: "2026-10-12",
    });
    const status = burnStatus(burn, ACTIVE);
    expect(r).toMatchObject({
      found: true,
      sprintId: "s1",
      source: "stories",
      available: { stories: true, log: true },
      lengthDays: 14,
      workingDays: 10,
      onWorkingDays: true,
      todayDay: 7,
      lastDay: 7,
      initialScope: 15,
      scopeNow: 20,
      scopeAdded: 5,
      scopeRemoved: 0,
      done: 8,
      remaining: 12,
      completionPct: 40,
      idealRemaining: status.idealRemaining,
      gap: status.gap,
      gapLabel: status.gapLabel,
      projectedFinishDay: status.projectedFinishDay,
      verdict: status.verdict,
    });
    expect(r.days).toHaveLength(15);
    expect(r.days[5]).toMatchObject({ working: false, off: "weekend" });
    expect(r.caveats).toContain("2 stories with no record of joining the sprint count from day 0.");
  });

  it("reads the typed log when asked, a named sprint, and says when there is none", async () => {
    const log = await run("tool.burnup.status", {
      sprintId: "s1",
      source: "log",
      today: "2026-10-12",
    });
    expect(log).toMatchObject({ source: "log", remaining: 15, lastDay: 2 });
    expect(log.scopeVerdict).toMatch(/^Day 7 of 14: 5 of 20 points done \(25%\)/);
    const old = await run("tool.burndown.status", { sprintId: "s0", today: "2026-10-12" });
    expect(old).toMatchObject({ found: true, sprintId: "s0", source: "none", phase: "over" });
    expect(await run("tool.burndown.status", { sprintId: "nope" })).toEqual({
      found: false,
      reason: "not_found",
    });
    useWorkspaceStore.setState({ sprints: [] });
    expect(await run("tool.burnup.status", {})).toEqual({ found: false, reason: "no_sprints" });
  });

  it("follows the team's holidays", async () => {
    useWorkspaceStore.setState({
      ceremonyCadences: [{ id: CEREMONY_CADENCE_ID, ...DEFAULT_CADENCE, holidays: ["2026-10-06"] }],
    });
    const r = await run("tool.burndown.status", { today: "2026-10-12" });
    expect(r.workingDays).toBe(9);
    expect(r.days[1]).toMatchObject({ working: false, off: "holiday" });
  });
});

describe("log_day", () => {
  const days = () => useWorkspaceStore.getState().sprintSeries?.find((s) => s.id === "s1")?.days;

  it("merges one Burndown day, keeping the rest, and keeps a flagged rise in the scope", async () => {
    const r = await run("tool.burndown.log_day", { sprintId: "s1", day: 3, remaining: 18 });
    expect(r).toMatchObject({ logged: true, day: 3, entry: { day: 3, remaining: 18 } });
    expect(days()?.map((d) => d.day)).toEqual([0, 2, 3]);
    // Remaining rose 3 (15 → 18) on a flagged day: Burnup's scope follows.
    const flagged = await run("tool.burndown.log_day", {
      sprintId: "s1",
      day: 3,
      scopeChange: true,
    });
    expect(flagged.entry).toEqual({ day: 3, remaining: 18, scopeChange: true, scope: 23 });
    const cleared = await run("tool.burndown.log_day", {
      sprintId: "s1",
      day: 3,
      remaining: null,
      scopeChange: false,
    });
    expect(cleared.entry).toBeNull();
    expect(days()).toEqual(LOG.days);
  });

  it("merges one Burnup day", async () => {
    const r = await run("tool.burnup.log_day", {
      sprintId: "s1",
      day: 4,
      completed: 9,
      note: "Demo",
    });
    expect(r.entry).toEqual({ day: 4, completed: 9, note: "Demo" });
    const again = await run("tool.burnup.log_day", { sprintId: "s1", day: 4, scope: 24 });
    expect(again.entry).toEqual({ day: 4, completed: 9, note: "Demo", scope: 24 });
  });

  it("refuses an unknown sprint, an example, a day past the end and an empty patch", async () => {
    expect(await run("tool.burndown.log_day", { sprintId: "nope", day: 1, remaining: 3 })).toEqual({
      logged: false,
      reason: "not_found",
    });
    useWorkspaceStore.setState({
      sprints: [{ ...ACTIVE, id: "example-preview-sprint-5" }],
    });
    expect(
      await run("tool.burnup.log_day", { sprintId: "example-preview-sprint-5", day: 1, scope: 3 })
    ).toEqual({ logged: false, reason: "example_sprint" });
    useWorkspaceStore.setState({ sprints: [ACTIVE] });
    expect(await run("tool.burndown.log_day", { sprintId: "s1", day: 15, remaining: 3 })).toEqual({
      logged: false,
      reason: "day_out_of_range",
      lengthDays: 14,
    });
    expect(() =>
      registry.get("tool.burndown.log_day")!.paramsSchema.parse({ sprintId: "s1", day: 1 })
    ).toThrow();
    expect(() =>
      registry
        .get("tool.burnup.log_day")!
        .paramsSchema.parse({ sprintId: "s1", day: 1, completed: -1 })
    ).toThrow();
  });
});

describe("compute with the sprint's dates", () => {
  it("counts working days and matches sprintStatus on the team's calendar", async () => {
    const sprint: Sprint = { ...ACTIVE, pointsPlanned: 40 };
    const series: SprintSeries = {
      id: "s1",
      days: [0, 1, 2, 3, 4, 5, 6, 7].map((day, i) => ({ day, remaining: 40 - i * 3 })),
    };
    const hub = sprintStatus(sprint, series, { calendar: DEFAULT_CALENDAR });
    const r = await run("tool.burndown.compute", {
      totalPoints: 40,
      remaining: series.days!.map((d) => d.remaining),
      startDate: sprint.startDate,
      endDate: sprint.endDate,
    });
    expect(r).toMatchObject({
      convention: "working_days",
      sprintDays: 15,
      lengthDays: 14,
      workingDays: 10,
      idealRemainingNow: hub.idealRemaining,
      gap: hub.gap,
      onTrack: hub.onTrack,
      projectedCompletionDay: hub.projectedFinishDay,
      willFinishOnTime: hub.willFinishOnTime,
    });
    // Saturday's ideal holds Friday's.
    const sat = await run("tool.burndown.compute", {
      totalPoints: 40,
      remaining: [40, 36, 32, 28, 24, 20],
      startDate: sprint.startDate,
      endDate: sprint.endDate,
      holidays: [],
    });
    expect(sat.idealRemainingNow).toBe(20);
    const sixDays = normalizeCalendar({ workingDays: [1, 2, 3, 4, 5, 6] });
    const six = await run("tool.burndown.compute", {
      totalPoints: 40,
      remaining: [40, 36, 32, 28, 24, 20],
      startDate: sprint.startDate,
      endDate: sprint.endDate,
      workingDays: sixDays.workingDays,
    });
    expect(six.workingDays).toBe(12);
  });

  it("burnup: scope added and removed, clamped %, and a working-day meet day", async () => {
    const r = await run("tool.burnup.compute", {
      scope: [40, 45, 37, 37],
      completed: [0, 10, 20, 30],
      startDate: "2026-10-05",
      endDate: "2026-10-19",
    });
    expect(r).toMatchObject({
      scopeAdded: 5,
      scopeRemoved: 8,
      scopeCreep: -3,
      percentComplete: 81,
      convention: "working_days",
    });
    expect(r.forecastDoneDay).not.toBeNull();
    const over = await run("tool.burnup.compute", { scope: [10, 10], completed: [5, 12] });
    expect(over.percentComplete).toBe(100);
    expect(over.forecastDoneDay).toBe(1);
    const none = await run("tool.burnup.compute", { scope: [0], completed: [0] });
    expect(none.percentComplete).toBe(0);
  });
});
