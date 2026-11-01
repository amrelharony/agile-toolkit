/**
 * How the team's sprints went over time, one row per finished sprint: what
 * it committed and completed (the graded say/do), what it carried over, and
 * how much its scope changed after it started. Pure, so Sprint Metrics'
 * trend view, Sprint Comparison's Scope Stability, Velocity's say/do column
 * and the `tool.sprint_metrics.trend` agent action read the same numbers.
 *
 * Each number says where it came from, because older sprints predate the
 * records that make it exact:
 *
 *   - carry-over is read from the stories' sprint moves (`sprintHistory`,
 *     stamped since the store started recording them): the moves the close
 *     dialog made, the moves out of the sprint after its last day, and the
 *     stories still open in it. Without a recorded move it is the open
 *     stories alone, else the numbers (committed − completed, labelled as
 *     such), else nothing. A sprint the cockpit closed before the moves
 *     were recorded keeps only its done stories (the unfinished ones left
 *     without a trace), so with none left open a shortfall in the numbers
 *     is the better answer than "nothing carried".
 *   - scope churn is the points that joined or left the sprint after its
 *     first day (the plan is made on day 0), from the same moves once one
 *     dated by the sprint's last day was recorded (its planning, a join or
 *     a mid-sprint move: one made after it ended, say Sprint Planning
 *     taking a leftover, says nothing about its scope). Without them it is
 *     read from the daily log's scope readings (Burnup's scope, or
 *     Burndown's flagged scope changes), else it isn't recorded.
 *
 * Moves are weighed by the points a story had when it moved, and dated by
 * the local day (`localDay`), never the UTC date of the stamp.
 */

import type { Sprint, SprintSeries, Story, StorySprintChange } from "@/lib/stores/workspace-types";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { mannKendall, type MannKendallResult } from "@/lib/analytics/trend-test";
import { isExampleSprintId } from "./example";
import {
  DEFAULT_PREDICTABILITY_WINDOW,
  sayDoRatio,
  velocity,
  type SayDo,
  type SayDoGrade,
} from "./metrics";
import { storyPoints } from "./plan";
import { carryOver as openStories } from "./progress";
import { hasSyntheticDates, localDay, scopeFromRise, seriesFor, sortedDays } from "./series";

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * A story from a tool's "Load an example": an `example-` id, the rule of
 * components/tool-frame/example-data isExampleId (a test holds the two
 * together). Not imported from there: that is a "use client" module, and
 * in the MCP route handler (tool.sprint_metrics.trend) its exports are
 * client references that throw when called.
 */
const isExampleId = (id: string | null | undefined) =>
  typeof id === "string" && id.startsWith("example-");

/** How many finished sprints the trend looks at unless told otherwise (MIN_SAMPLE.trend). */
export const DEFAULT_TREND_WINDOW = DEFAULT_PREDICTABILITY_WINDOW;

export type CarryOverSource = "history" | "stories" | "numbers" | "none";
export type ScopeSource = "history" | "log" | "none";

export interface SprintCarryOver {
  /** Stories carried over; null when only the numbers say (source "numbers" or "none"). */
  count: number | null;
  /** Their points; null when nothing says (source "none"). */
  points: number | null;
  /** The points as a whole percentage of the commitment; null without one. */
  pct: number | null;
  source: CarryOverSource;
}

export interface SprintScopeChange {
  /** Points that joined after the first day. */
  added: number;
  /** Points that left after the first day (carry-overs at the close aren't removals). */
  removed: number;
  /** Added minus removed. */
  net: number;
  /** (Added + removed) as a whole percentage of the commitment; null without one or a record. */
  churnPct: number | null;
  source: ScopeSource;
}

export interface SprintTrendRow {
  sprint: Pick<Sprint, "id" | "name" | "startDate" | "endDate" | "status">;
  /** Sprint.pointsPlanned: the commitment. */
  committed: number;
  /** Sprint.pointsCompleted, confirmed at close (null only for a sprint scored before it closed). */
  completed: number | null;
  /** sayDoRatio(committed, completed); null without a positive commitment. */
  sayDo: SayDo | null;
  carryOver: SprintCarryOver;
  scope: SprintScopeChange;
}

export interface SprintTrendSummary {
  /** Finished sprints, oldest first by end date (velocity's order), examples left out. */
  rows: SprintTrendRow[];
  /** How many of the latest finished sprints were asked for; null for all of them. */
  window: number | null;
  /** Finished sprints there are in all, so a view can say "6 of 14". */
  finishedCount: number;
  sayDo: {
    /** Rows with a say/do (a positive commitment). */
    considered: number;
    met: number;
    close: number;
    missed: number;
    over: number;
    /** Mean say/do %; null below MIN_SAMPLE.average considered rows. */
    meanPct: number | null;
  };
  carryOver: {
    /** Mean carried-over points; null below MIN_SAMPLE.average rows that say. */
    meanPoints: number | null;
    /** Rows that say how much they carried over. */
    count: number;
  };
  churn: {
    /** Mean churn %; null below MIN_SAMPLE.average rows with a recorded churn. */
    meanPct: number | null;
    count: number;
  };
}

export interface SprintTrendInput {
  sprints: readonly Sprint[];
  stories: readonly Story[];
  series?: readonly SprintSeries[];
  /** Latest N finished sprints; default 6 (MIN_SAMPLE.trend); Infinity (or null) for all. */
  window?: number | null;
  /** Count example sprints and stories too (a tool's in-memory example). */
  includeExamples?: boolean;
}

/** A story's moves that touch `sprintId`, with the story they belong to. */
interface Move {
  story: Story;
  change: StorySprintChange;
  day: string | null;
}

function movesTouching(stories: readonly Story[], sprintId: string): Move[] {
  const out: Move[] = [];
  for (const story of stories) {
    for (const change of story.sprintHistory ?? []) {
      if (change.sprintId !== sprintId && change.from !== sprintId) continue;
      out.push({ story, change, day: localDay(change.at) });
    }
  }
  return out;
}

/** The points a move weighed: as recorded, else the story's points now. */
const movePoints = (m: Move) =>
  typeof m.change.points === "number" && Number.isFinite(m.change.points)
    ? m.change.points
    : storyPoints(m.story);

/** Whether the sprint's dates can place a move before, during or after it. */
const dated = (sprint: Pick<Sprint, "startDate" | "endDate">) => !hasSyntheticDates(sprint);

/** The first and last day of a dated sprint as YYYY-MM-DD. */
function daysOf(sprint: Pick<Sprint, "startDate" | "endDate">): { start: string; end: string } {
  return { start: sprint.startDate.slice(0, 10), end: sprint.endDate.slice(0, 10) };
}

/**
 * What `sprint` carried over (see the file comment for the sources). A move
 * out of it counts when the close dialog made it (`carriedOver`) or it came
 * after the sprint's last day; stories still open in it count too.
 */
export function sprintCarryOver(
  sprint: Pick<Sprint, "id" | "startDate" | "endDate" | "pointsPlanned" | "pointsCompleted">,
  stories: readonly Story[]
): SprintCarryOver {
  const committed = Number.isFinite(sprint.pointsPlanned) ? sprint.pointsPlanned : 0;
  const pctOf = (points: number) => (committed > 0 ? Math.round((points / committed) * 100) : null);
  const completed = sprint.pointsCompleted;
  // Committed − completed, or null without both.
  const shortfall =
    committed > 0 && typeof completed === "number" && Number.isFinite(completed)
      ? round1(Math.max(0, committed - completed))
      : null;
  const open = openStories(sprint, stories).stories;
  const moves = movesTouching(stories, sprint.id);
  if (moves.length > 0) {
    const { end } = daysOf(sprint);
    const carried = new Map<string, number>();
    for (const m of moves) {
      if (m.change.from !== sprint.id) continue;
      const afterEnd = dated(sprint) && m.day !== null && m.day > end;
      if (m.change.carriedOver || afterEnd) carried.set(m.story.id, movePoints(m));
    }
    for (const s of open) if (!carried.has(s.id)) carried.set(s.id, storyPoints(s));
    const points = round1(Array.from(carried.values()).reduce((a, b) => a + b, 0));
    return { count: carried.size, points, pct: pctOf(points), source: "history" };
  }
  // Only done stories left and the numbers short: the unfinished ones went
  // without a record (see the file comment), so the stories can't tell.
  const storiesCanTell = open.length > 0 || shortfall === null || shortfall === 0;
  if (storiesCanTell && stories.some((s) => s.sprintId === sprint.id)) {
    const points = round1(open.reduce((sum, s) => sum + storyPoints(s), 0));
    return { count: open.length, points, pct: pctOf(points), source: "stories" };
  }
  if (shortfall !== null) {
    return { count: null, points: shortfall, pct: pctOf(shortfall), source: "numbers" };
  }
  return { count: null, points: null, pct: null, source: "none" };
}

/**
 * How much `sprint`'s scope changed after its first day: from the stories'
 * moves once one dated by its last day was recorded (a story joining or
 * leaving it other than by a carry-over: carry-overs alone say nothing
 * about mid-sprint changes, and neither does a move made after it ended),
 * else from the daily log's scope readings, else not recorded. A sprint
 * without real dates can't place a move, so only its log can say.
 */
export function sprintScope(
  sprint: Pick<Sprint, "id" | "startDate" | "endDate" | "pointsPlanned">,
  stories: readonly Story[],
  series: SprintSeries | undefined
): SprintScopeChange {
  const committed = Number.isFinite(sprint.pointsPlanned) ? sprint.pointsPlanned : 0;
  const result = (added: number, removed: number, source: ScopeSource): SprintScopeChange => ({
    added: round1(added),
    removed: round1(removed),
    net: round1(added - removed),
    churnPct: committed > 0 ? Math.round(((added + removed) / committed) * 100) : null,
    source,
  });

  const moves = dated(sprint) ? movesTouching(stories, sprint.id) : [];
  const { start, end } = daysOf(sprint);
  if (moves.some((m) => !m.change.carriedOver && m.day !== null && m.day <= end)) {
    const during = (day: string | null) => day !== null && day > start && day <= end;
    let added = 0;
    let removed = 0;
    for (const m of moves) {
      if (!during(m.day)) continue;
      // A carry-over in is part of the plan; one out happens at the close.
      if (m.change.carriedOver) continue;
      if (m.change.sprintId === sprint.id) added += movePoints(m);
      else if (m.change.from === sprint.id) removed += movePoints(m);
    }
    return result(added, removed, "history");
  }

  let prev = committed;
  let added = 0;
  let removed = 0;
  let readings = 0;
  for (const d of sortedDays(series)) {
    const scope =
      d.scope != null ? d.scope : d.scopeChange ? scopeFromRise(sprint, series, d.day) : null;
    if (scope == null || !Number.isFinite(scope)) continue;
    readings++;
    const delta = scope - prev;
    if (delta > 0) added += delta;
    else removed -= delta;
    prev = scope;
  }
  if (readings > 0) return result(added, removed, "log");
  return { added: 0, removed: 0, net: 0, churnPct: null, source: "none" };
}

/** One sprint's trend row. */
export function sprintTrendRow(
  sprint: Sprint,
  stories: readonly Story[],
  series: readonly SprintSeries[] | undefined
): SprintTrendRow {
  const committed = Number.isFinite(sprint.pointsPlanned) ? sprint.pointsPlanned : 0;
  const completed =
    typeof sprint.pointsCompleted === "number" && Number.isFinite(sprint.pointsCompleted)
      ? sprint.pointsCompleted
      : null;
  return {
    sprint: {
      id: sprint.id,
      name: sprint.name,
      startDate: sprint.startDate,
      endDate: sprint.endDate,
      status: sprint.status,
    },
    committed,
    completed,
    sayDo: sayDoRatio(committed, completed),
    carryOver: sprintCarryOver(sprint, stories),
    scope: sprintScope(sprint, stories, seriesFor(series, sprint.id)),
  };
}

/** Mean of `values` to one decimal, or null below MIN_SAMPLE.average of them. */
function meanOf(values: readonly number[], round: (n: number) => number = round1): number | null {
  if (values.length < MIN_SAMPLE.average) return null;
  return round(values.reduce((a, b) => a + b, 0) / values.length);
}

/**
 * The latest `window` finished sprints (completed with points, the sprints
 * velocity counts), oldest first by end date, with the window's totals.
 */
export function sprintTrends({
  sprints,
  stories,
  series,
  window: requested = DEFAULT_TREND_WINDOW,
  includeExamples = false,
}: SprintTrendInput): SprintTrendSummary {
  const pool = includeExamples ? sprints : sprints.filter((s) => !isExampleSprintId(s.id));
  const storyPool = includeExamples ? stories : stories.filter((s) => !isExampleId(s.id));
  const all = requested === null || requested === Number.POSITIVE_INFINITY;
  const size =
    typeof requested === "number" && Number.isFinite(requested) && requested >= 1
      ? Math.floor(requested)
      : DEFAULT_TREND_WINDOW;
  const finished = velocity(pool, { window: Number.POSITIVE_INFINITY });
  const used = velocity(pool, { window: all ? Number.POSITIVE_INFINITY : size });
  const byId = new Map(pool.map((s) => [s.id, s]));
  // velocity() lists them oldest first by end date: the order every trend shares.
  const rows = used.sprintIds
    .map((id) => byId.get(id))
    .filter((s): s is Sprint => s !== undefined)
    .map((s) => sprintTrendRow(s, storyPool, series));

  const grades: Record<SayDoGrade, number> = { met: 0, close: 0, missed: 0, over: 0 };
  const pcts: number[] = [];
  for (const r of rows) {
    if (!r.sayDo) continue;
    grades[r.sayDo.grade]++;
    pcts.push(r.sayDo.pct);
  }
  const carried = rows.flatMap((r) => (r.carryOver.points === null ? [] : [r.carryOver.points]));
  const churn = rows.flatMap((r) => (r.scope.churnPct === null ? [] : [r.scope.churnPct]));

  return {
    rows,
    window: all ? null : size,
    finishedCount: finished.count,
    sayDo: { considered: pcts.length, ...grades, meanPct: meanOf(pcts, Math.round) },
    carryOver: { meanPoints: meanOf(carried), count: carried.length },
    churn: { meanPct: meanOf(churn, Math.round), count: churn.length },
  };
}

export interface TrendTests {
  /** Mann-Kendall on the say/do %; null below MIN_SAMPLE.trend sprints with one. */
  sayDo: MannKendallResult | null;
  /** Mann-Kendall on the churn %; null below MIN_SAMPLE.trend sprints with one. */
  churn: MannKendallResult | null;
}

/** Whether say/do and churn are drifting, for the Advanced analysis section. */
export function trendTests(summary: Pick<SprintTrendSummary, "rows">): TrendTests {
  const sayDo = summary.rows.flatMap((r) => (r.sayDo ? [r.sayDo.pct] : []));
  const churn = summary.rows.flatMap((r) => (r.scope.churnPct === null ? [] : [r.scope.churnPct]));
  return {
    sayDo: sayDo.length >= MIN_SAMPLE.trend ? mannKendall(sayDo) : null,
    churn: churn.length >= MIN_SAMPLE.trend ? mannKendall(churn) : null,
  };
}

/** Where a carry-over number came from, in words. */
export const CARRY_OVER_SOURCE_LABEL: Record<CarryOverSource, string> = {
  history: "from the stories' moves",
  stories: "from the stories left in the sprint",
  numbers: "from the numbers (committed − done)",
  none: "not recorded",
};

/** Where a scope-change number came from, in words. */
export const SCOPE_SOURCE_LABEL: Record<ScopeSource, string> = {
  history: "from the stories' moves",
  log: "from the daily log's scope",
  none: "not recorded",
};
