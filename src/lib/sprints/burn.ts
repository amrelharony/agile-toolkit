/**
 * One sprint's burn: the points in scope, done and left on each day of the
 * sprint, the ideal line on the team's working days, and where the sprint
 * stands against it. Burndown, Burnup, the Sprint cockpit and their agent
 * actions (`tool.burndown.status`, `tool.burnup.status`) all read it, so a
 * chart, a tile, a verdict and an agent quote the same numbers. Pure.
 *
 * Where the numbers come from (`BurnSource`) is the rule every delivery
 * chart shares (./progress remainingToday):
 *
 *   - "stories": the sprint has pointed stories. A day's scope is the points
 *     of the stories in the sprint that day: their sprint moves
 *     (Story.sprintHistory) say when each joined and left, and a story
 *     without them counts from day 0. Its done points are those of the
 *     stories in Done at the end of that day (lib/flow stageOn, from the
 *     status history), so a story done on day d counts from day d, one done
 *     and reopened stops counting, and one done after the last day counts
 *     on it. A story removed while open lowers the scope, not as burn.
 *   - "log": no pointed stories, but the typed daily log (SprintSeries) has
 *     a reading on or before today: Burndown's remaining, Burnup's done and
 *     scope, each worked out from the other where only one was typed.
 *   - "none": neither yet.
 *
 * A closed sprint is read from its log, as it was recorded: closing can
 * move its unfinished stories on, so the board no longer holds what it
 * committed. Asking for "stories" (`prefer`) shows its board anyway when
 * the stories' sprint moves can rebuild it.
 *
 * Days are calendar days: day 0 is the start date and the last day is the
 * end date, as the log is stored and "Day N of L" reads. The ideal line, the
 * gap and the projections count the team's working days (a WorkingCalendar
 * from the cadence): the ideal stays flat over weekends and holidays and
 * reaches 0 on the last day. A day's actual is the state at the end of it,
 * compared with the ideal for that day, as the cockpit always has.
 */

import type { Sprint, SprintSeries, Story } from "@/lib/stores/workspace-types";
import { stageOn, storyItems, type FlowItem } from "@/lib/flow";
import { countWorkingDays, isoDayNumber, isWorkingDay, type WorkingCalendar } from "./calendar";
import { fmt, points } from "./hub-view";
import {
  completionPct,
  gap as gapOf,
  gapLabel as gapLabelOf,
  projectFinish,
  type Point,
} from "./metrics";
import { storyPoints } from "./plan";
import { remainingToday, storyProgress } from "./progress";
import {
  completedAt,
  dayDate,
  dayEntry,
  dayForDate,
  dayForWorkingDay,
  elapsedWorkingDays,
  hasSyntheticDates,
  idealLine,
  idealRemainingAt,
  localDay,
  remainingAt,
  scopeAt,
  sprintLengthDays,
  sprintWorkingDays,
} from "./series";

const round1 = (n: number) => {
  const r = Math.round(n * 10) / 10;
  return Object.is(r, -0) ? 0 : r;
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** "Behind by 3 points" → "behind by 3 points", for the middle of a sentence. */
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Where a sprint's burn is read from: its pointed stories, the typed daily log, or nothing yet. */
export type BurnSource = "stories" | "log" | "none";

/**
 * Where one day's "points left" came from: the board, typed in Burndown,
 * worked out from what Burnup typed, or (day 0 of the log) the plan.
 */
export type BurnFrom = "stories" | "typed" | "derived" | "plan";

/** Where today is: before the first day, in the sprint, after the last day, or unknown (no dates). */
export type BurnPhase = "before" | "running" | "over" | "undated";

/** Why the team doesn't work on a day, or null on a working day. */
export type BurnOff = "weekend" | "holiday" | null;

export interface BurnDay {
  /** Calendar day: 0 is the start date. */
  day: number;
  /** "YYYY-MM-DD", or null when the sprint has no real dates. */
  date: string | null;
  /** The team works that day (always true while the ideal counts calendar days). */
  working: boolean;
  off: BurnOff;
  /** The ideal points left for the day, on working days, to one decimal. */
  ideal: number;
  /** Points left at the end of the day; null on a day not reached or not logged. */
  remaining: number | null;
  /** Points done by the end of the day; null on a day not reached or not logged. */
  done: number | null;
  /** Points in scope that day; null on a day the board hasn't reached. */
  scope: number | null;
  /** Points that joined the scope that day (0 on day 0: that is the starting scope). */
  added: number;
  /** Points that left the scope that day. */
  removed: number;
  /** Where `remaining` came from; null when it is null. */
  from: BurnFrom | null;
  /** The day's note in the shared log. */
  note?: string;
  /** Burndown's "scope changed this day" flag in the log. */
  scopeChangeFlag?: boolean;
}

export interface BurnSeries {
  source: BurnSource;
  /** What each source holds: pointed stories on the board, readings in the typed log. */
  available: { stories: boolean; log: boolean };
  /** The points the ideal line starts from: the commitment, else the starting scope. */
  base: number;
  /** The last day's number (the end date). */
  lengthDays: number;
  /** Working days in the sprint: the ideal line's length. */
  workingDays: number;
  /** Whether the ideal line runs on working days (a calendar, real dates, a working day in it). */
  onWorkingDays: boolean;
  /** The calendar the ideal line ran on (absent: calendar days), so the status reads the same. */
  calendar?: WorkingCalendar;
  /** Today's calendar day, when today falls inside the sprint. */
  todayDay: number | null;
  /** Today's calendar day however far outside the sprint (negative before it); null without dates. */
  todayAt: number | null;
  phase: BurnPhase;
  /** The last day read: today, the last day once it is over, or the log's latest reading. */
  lastDay: number | null;
  /** The sprint has real dates, so its days can be placed. */
  dated: boolean;
  /** Days 0 … lengthDays. */
  days: BurnDay[];
  /** The sprint's planned points (its commitment). */
  committed: number;
  /** Scope on day 0. */
  initialScope: number;
  /** Scope on the last day read (the board's now, before the sprint starts). */
  scopeNow: number;
  /** Points added after day 0, up to the last day read. */
  scopeAdded: number;
  /** Points removed after day 0, up to the last day read. */
  scopeRemoved: number;
  /** Points done on the last day read; null when nothing says. */
  done: number | null;
  /** Points left on the last day read; null when nothing says. */
  remaining: number | null;
  /** Open stories in the sprint without points: the board's "left" leaves them out. */
  unpointedOpen: number;
  /** Done stories with no done date (from before the board kept one): counted from day 0. */
  undatedDone: number;
  /** Stories in the sprint with no record of joining it: counted from day 0. */
  unknownJoin: number;
  /** Stories in the sprint now, and how many of them are done. */
  storyCount: number;
  doneCount: number;
}

export interface BurnInput {
  sprint: Sprint;
  series: SprintSeries | undefined;
  stories: readonly Story[];
  /**
   * The team's working days (cadenceCalendar of the cadence). Absent, every
   * calendar day counts, the convention the log had before working days.
   */
  calendar?: WorkingCalendar;
  /** YYYY-MM-DD, local. */
  today: string;
  /** Show this source when it holds anything (a page's switch); absent, the rule decides. */
  prefer?: "stories" | "log";
}

/** The line the ideal burndown starts from: the commitment, else the scope on day 0. */
export function idealBase(sprint: Pick<Sprint, "pointsPlanned">, initialScope: number): number {
  return sprint.pointsPlanned > 0 ? sprint.pointsPlanned : initialScope;
}

/**
 * Open stories in `sprintId` without points (as the Refinement card counts
 * them). The board's "points left" leaves them out, so while there are any
 * it is only a floor: the pages say so, and never read the sprint as
 * finished or in a success tone.
 */
export function openUnpointed(stories: readonly Story[], sprintId: string): number {
  return stories.filter(
    (s) =>
      s.sprintId === sprintId &&
      s.status !== "done" &&
      !(typeof s.points === "number" && s.points > 0)
  ).length;
}

/* ── Calendar ─────────────────────────────────────────────────────────── */

/** Whether the ideal line runs on `calendar`'s working days for this sprint (series.ts's rule). */
function runsOnWorkingDays(sprint: Sprint, calendar: WorkingCalendar | undefined): boolean {
  if (!calendar || hasSyntheticDates(sprint)) return false;
  const start = isoDayNumber(sprint.startDate) as number;
  return countWorkingDays(start, start + sprintLengthDays(sprint), calendar) > 0;
}

/** Why the team is off on `date` under `calendar` (null without one: every day counts). */
function offOf(date: string | null, calendar: WorkingCalendar | undefined): BurnOff {
  if (!calendar || !date || isWorkingDay(date, calendar)) return null;
  const n = isoDayNumber(date) as number;
  const weekday = (((n + 4) % 7) + 7) % 7;
  return calendar.workingDays.includes(weekday) ? "holiday" : "weekend";
}

/* ── The board ────────────────────────────────────────────────────────── */

/** A stretch of days a story was in the sprint: from `join` up to, not including, `left`. */
interface Stay {
  join: number;
  /** null: still in it at the end (or now). */
  left: number | null;
  points: number;
}

/** The story's sprint moves that can be read (a hand edit or an older client may store others). */
function sprintMoves(story: Story): NonNullable<Story["sprintHistory"]> {
  const raw: unknown = story.sprintHistory;
  return Array.isArray(raw)
    ? (raw as NonNullable<Story["sprintHistory"]>).filter(
        (c) => c !== null && typeof c === "object" && typeof c.at === "string"
      )
    : [];
}

const clampDay = (d: number, length: number) => Math.min(length, Math.max(0, d));

/**
 * When `story` was in `sprint`, as day numbers, from its sprint moves. A
 * move out at the close (a carry-over) or after the last day leaves it in
 * scope to the end, as this sprint's unfinished work. A story in the sprint
 * now with no recorded join counts from day 0. A stretch that ended weighs
 * the points recorded with the move out; the one it is in now, its points
 * now, so the last day matches the board.
 */
function staysOf(
  story: Story,
  sprint: Sprint,
  length: number
): { stays: Stay[]; knownJoin: boolean } {
  const stays: Stay[] = [];
  let open: { join: number } | null = null;
  let knownJoin = false;
  for (const c of sprintMoves(story)) {
    const date = localDay(c.at);
    const day = date === null ? null : dayForDate(sprint, date);
    if (day === null) continue;
    if (c.from === sprint.id) {
      const left = c.carriedOver || day > length ? null : Math.max(0, day);
      const pts = typeof c.points === "number" && Number.isFinite(c.points) ? c.points : null;
      stays.push({ join: open ? open.join : 0, left, points: pts ?? storyPoints(story) });
      if (open) knownJoin = true;
      open = null;
    }
    if (c.sprintId === sprint.id && !open) open = { join: clampDay(day, length) };
  }
  if (story.sprintId === sprint.id) {
    if (open) knownJoin = true;
    stays.push({ join: open ? open.join : 0, left: null, points: storyPoints(story) });
  }
  return { stays, knownJoin };
}

interface Member {
  story: Story;
  item: FlowItem;
  stays: Stay[];
}

/**
 * The stories on the sprint's board: those in it now and those that left
 * it while it ran (lib/flow storyItems), with the stretches each was in it.
 */
function membersOf(sprint: Sprint, stories: readonly Story[]) {
  const length = sprintLengthDays(sprint);
  const byId = new Map(stories.map((s) => [s.id, s]));
  const members: Member[] = [];
  let unknownJoin = 0;
  // Example rows count too: the board's own numbers (storyProgress) don't skip them.
  for (const item of storyItems(stories, { sprint, includeExamples: true })) {
    const story = byId.get(item.id);
    if (!story) continue;
    const { stays, knownJoin } = staysOf(story, sprint, length);
    if (stays.length === 0) continue;
    if (!knownJoin && story.sprintId === sprint.id) unknownJoin++;
    members.push({ story, item, stays });
  }
  return { members, unknownJoin };
}

/** Whether any of the sprint's stories recorded a move into or out of it. */
function hasSprintMoves(sprint: Sprint, members: readonly Member[]): boolean {
  return members.some((m) =>
    sprintMoves(m.story).some((c) => c.sprintId === sprint.id || c.from === sprint.id)
  );
}

function stayOn(stays: readonly Stay[], day: number): Stay | null {
  for (const s of stays) if (s.join <= day && (s.left === null || day < s.left)) return s;
  return null;
}

interface BoardDays {
  scope: number[];
  done: number[];
  added: number[];
  removed: number[];
  undatedDone: number;
}

/**
 * The board's scope and done points for days 0 … `last`. `pastEnd`: today
 * is after the last day, so the last day counts what is done now (a story
 * done after the end still counts on it).
 */
function boardDays(
  sprint: Sprint,
  members: readonly Member[],
  last: number,
  pastEnd: boolean
): BoardDays {
  const length = sprintLengthDays(sprint);
  const n = Math.max(0, last + 1);
  const zeros = () => new Array<number>(n).fill(0);
  const out: BoardDays = {
    scope: zeros(),
    done: zeros(),
    added: zeros(),
    removed: zeros(),
    undatedDone: 0,
  };
  for (const { item, stays } of members) {
    let counted = false;
    for (let day = 0; day < n; day++) {
      const stay = stayOn(stays, day);
      const before = day > 0 ? stayOn(stays, day - 1) : null;
      if (day > 0 && stay && !before) out.added[day] += stay.points;
      if (day > 0 && !stay && before) out.removed[day] += before.points;
      if (!stay) continue;
      out.scope[day] += stay.points;
      const date = dayDate(sprint, day);
      const stage =
        day === length && pastEnd ? item.stage : date === null ? null : stageOn(item, date);
      if (stage === "done") {
        out.done[day] += stay.points;
        counted = true;
      }
    }
    // Done with nothing to date it: it reads as done from the day it arrived.
    if (counted && item.stage === "done" && !item.moves.some((m) => m.to === "done")) {
      out.undatedDone++;
    }
  }
  out.scope = out.scope.map(round1);
  out.done = out.done.map(round1);
  out.added = out.added.map(round1);
  out.removed = out.removed.map(round1);
  return out;
}

/* ── The log ──────────────────────────────────────────────────────────── */

interface LogDay {
  remaining: number | null;
  done: number | null;
  from: BurnFrom | null;
  /** Burndown's remaining or Burnup's done was typed that day. */
  reading: boolean;
}

/**
 * One day of the typed log: Burndown's remaining, else Burnup's done worked
 * out as remaining, else (day 0) the scope it started with; done the other
 * way round (./series remainingAt, completedAt).
 */
function logDay(sprint: Sprint, series: SprintSeries | undefined, day: number): LogDay {
  const typed = dayEntry(series, day)?.remaining ?? null;
  const derived = typed === null ? remainingAt(sprint, series, day) : null;
  const plan = day === 0 && typed === null && derived === null ? scopeAt(sprint, series, 0) : null;
  return {
    remaining: typed ?? derived ?? plan,
    done: completedAt(sprint, series, day) ?? (plan !== null ? 0 : null),
    from: typed !== null ? "typed" : derived !== null ? "derived" : plan !== null ? "plan" : null,
    reading: typed !== null || derived !== null,
  };
}

/* ── The series ───────────────────────────────────────────────────────── */

interface Base {
  lengthDays: number;
  dated: boolean;
  todayDay: number | null;
  todayAt: number | null;
  phase: BurnPhase;
  onWorkingDays: boolean;
  calendar?: WorkingCalendar;
  available: BurnSeries["available"];
}

/** What both sources share: where today is, the calendar, the board's members, what's available. */
function prepare(input: BurnInput) {
  const { sprint, series, stories, calendar, today } = input;
  const lengthDays = sprintLengthDays(sprint);
  const dated = !hasSyntheticDates(sprint);
  const todayAt = dated ? dayForDate(sprint, today) : null;
  const todayDay = todayAt !== null && todayAt >= 0 && todayAt <= lengthDays ? todayAt : null;
  const phase: BurnPhase =
    todayAt === null
      ? "undated"
      : todayAt < 0
        ? "before"
        : todayAt > lengthDays
          ? "over"
          : "running";
  const onWorkingDays = runsOnWorkingDays(sprint, calendar);
  const cal = onWorkingDays ? calendar : undefined;
  const { members, unknownJoin } = membersOf(sprint, stories);
  const closed = sprint.status === "completed";
  const available = {
    stories: closed
      ? hasSprintMoves(sprint, members) && members.some((m) => m.stays.some((s) => s.points > 0))
      : storyProgress(stories, sprint.id).scope > 0,
    log: (series?.days ?? []).some((d) => d.remaining != null || d.completed != null),
  };
  const base: Base = {
    lengthDays,
    dated,
    todayDay,
    todayAt,
    phase,
    onWorkingDays,
    ...(cal ? { calendar: cal } : {}),
    available,
  };
  return { base, cal, members, unknownJoin, closed };
}

/** The sprint's burn, day by day, from its stories or its typed log (see the module comment). */
export function burnSeries(input: BurnInput): BurnSeries {
  const { sprint, series, stories, today, prefer } = input;
  const { base, cal, members, unknownJoin, closed } = prepare(input);
  const source: BurnSource =
    prefer === "stories" && base.available.stories
      ? "stories"
      : prefer === "log" && base.available.log
        ? remainingToday({ sprint, stories: [], series, today }).source
        : remainingToday({ sprint, stories: closed ? [] : stories, series, today }).source;
  return source === "stories"
    ? fromBoard(input, base, members, unknownJoin, cal)
    : fromLog(input, base, source, cal);
}

/**
 * The burn read off the board whatever the rule says (the cockpit's board
 * rows): the stories' scope and done points by day.
 */
export function boardBurn(input: BurnInput): BurnSeries {
  const { base, cal, members, unknownJoin } = prepare(input);
  return fromBoard(input, base, members, unknownJoin, cal);
}

function dayShell(
  sprint: Sprint,
  day: number,
  ideal: readonly number[],
  calendar: WorkingCalendar | undefined
): Pick<BurnDay, "day" | "date" | "working" | "off" | "ideal"> {
  const date = hasSyntheticDates(sprint) ? null : dayDate(sprint, day);
  const off = offOf(date, calendar);
  return { day, date, working: off === null, off, ideal: round1(ideal[day] ?? 0) };
}

function notesOf(
  series: SprintSeries | undefined,
  day: number
): Pick<BurnDay, "note" | "scopeChangeFlag"> {
  const d = dayEntry(series, day);
  return {
    ...(d?.note ? { note: d.note } : {}),
    ...(d?.scopeChange ? { scopeChangeFlag: true } : {}),
  };
}

const sum = (xs: readonly number[]) => round1(xs.reduce((a, b) => a + b, 0));

function fromBoard(
  input: BurnInput,
  base: Base,
  members: readonly Member[],
  unknownJoin: number,
  calendar: WorkingCalendar | undefined
): BurnSeries {
  const { sprint, series, stories } = input;
  const { lengthDays: length, todayAt } = base;
  const last = todayAt === null ? -1 : Math.min(todayAt, length);
  const board = boardDays(sprint, members, last, todayAt !== null && todayAt > length);

  // The board now stands in before the sprint starts, or without dates.
  const now = storyProgress(stories, sprint.id);
  const lastDay = last >= 0 ? last : null;
  const initialScope = lastDay === null ? now.scope : board.scope[0];
  const ideal = idealLine(sprint, idealBase(sprint, initialScope), calendar);
  const days: BurnDay[] = [];
  for (let day = 0; day <= length; day++) {
    const read = day <= last;
    days.push({
      ...dayShell(sprint, day, ideal, calendar),
      remaining: read ? round1(board.scope[day] - board.done[day]) : null,
      done: read ? board.done[day] : null,
      scope: read ? board.scope[day] : null,
      added: read ? board.added[day] : 0,
      removed: read ? board.removed[day] : 0,
      from: read ? "stories" : null,
      ...notesOf(series, day),
    });
  }
  return {
    source: "stories",
    ...base,
    base: idealBase(sprint, initialScope),
    workingDays: sprintWorkingDays(sprint, calendar),
    lastDay,
    days,
    committed: sprint.pointsPlanned,
    initialScope,
    scopeNow: lastDay === null ? now.scope : board.scope[lastDay],
    scopeAdded: sum(board.added),
    scopeRemoved: sum(board.removed),
    done: lastDay === null ? now.done : board.done[lastDay],
    remaining:
      lastDay === null ? now.remaining : round1(board.scope[lastDay] - board.done[lastDay]),
    unpointedOpen: openUnpointed(stories, sprint.id),
    undatedDone: board.undatedDone,
    unknownJoin,
    storyCount: now.count,
    doneCount: now.doneCount,
  };
}

function fromLog(
  input: BurnInput,
  base: Base,
  source: BurnSource,
  calendar: WorkingCalendar | undefined
): BurnSeries {
  const { sprint, series, stories } = input;
  const { lengthDays: length, todayAt } = base;
  // Readings up to today count (every one without dates), as remainingToday reads them.
  const limit = todayAt === null ? length : Math.min(length, todayAt);
  const initialScope = scopeAt(sprint, series, 0);
  const ideal = idealLine(sprint, idealBase(sprint, initialScope), calendar);
  const days: BurnDay[] = [];
  let lastReading: number | null = null;
  let added = 0;
  let removed = 0;
  for (let day = 0; day <= length; day++) {
    const log = logDay(sprint, series, day);
    const scope = scopeAt(sprint, series, day);
    const step = day > 0 ? round1(scope - scopeAt(sprint, series, day - 1)) : 0;
    if (day <= limit) {
      if (log.reading) lastReading = day;
      if (step > 0) added += step;
      if (step < 0) removed -= step;
    }
    days.push({
      ...dayShell(sprint, day, ideal, calendar),
      remaining: log.remaining === null ? null : round1(log.remaining),
      done: log.done === null ? null : round1(log.done),
      scope: round1(scope),
      added: Math.max(0, step),
      removed: Math.max(0, -step),
      from: log.from,
      ...notesOf(series, day),
    });
  }
  const lastDay = source === "log" ? lastReading : null;
  const progress = storyProgress(stories, sprint.id);
  return {
    source,
    ...base,
    base: idealBase(sprint, initialScope),
    workingDays: sprintWorkingDays(sprint, calendar),
    lastDay,
    days,
    committed: sprint.pointsPlanned,
    initialScope,
    scopeNow: round1(scopeAt(sprint, series, lastDay ?? 0)),
    scopeAdded: round1(added),
    scopeRemoved: round1(removed),
    done: lastDay === null ? null : days[lastDay].done,
    remaining: lastDay === null ? null : days[lastDay].remaining,
    unpointedOpen: 0,
    undatedDone: 0,
    unknownJoin: 0,
    storyCount: progress.count,
    doneCount: progress.doneCount,
  };
}

/* ── Where it stands ──────────────────────────────────────────────────── */

export interface BurnStatus {
  /** Where the ideal line is on the last day read, to one decimal. */
  idealRemaining: number | null;
  /** Remaining minus ideal (lib/sprints/metrics gap): positive is behind. */
  gap: number | null;
  /** "Behind by 3 points", "Ahead by 1.5 points", "On the ideal line". */
  gapLabel: string | null;
  /** Done as a share of the current scope (completionPct). */
  completionPct: number | null;
  /** The calendar day the points left reach 0 at this pace (may be past the end). */
  projectedFinishDay: number | null;
  /** The calendar day the done points reach the current scope at this pace (Burnup's). */
  projectedMeetDay: number | null;
  /** The finish falls on or before the last day; null without a projection. */
  willFinishOnTime: boolean | null;
  willMeetOnTime: boolean | null;
  /**
   * The pace can't be read: every pointed story is done but open stories
   * have no points, so "nothing left" isn't true.
   */
  cantTell: boolean;
  /** One sentence on the pace: the burndown's. */
  verdict: string;
  /** One sentence on done against the scope and how the scope moved: the burnup's. */
  scopeVerdict: string;
}

/**
 * The trend samples of `pick` for days 0 … lastDay, at each day's place on
 * the working-day axis. A log day without a reading carries the one before
 * it forward (a missed day isn't a drop), as sprintStatus reads the log.
 */
export function trendPoints(burn: BurnSeries, sprint: Sprint, pick: "remaining" | "done"): Point[] {
  if (burn.lastDay === null) return [];
  const cal = burn.calendar;
  const out: Point[] = [];
  let carry: number | null = null;
  for (let d = 0; d <= burn.lastDay; d++) {
    const v = burn.days[d]?.[pick];
    if (typeof v === "number") carry = v;
    if (carry !== null) out.push({ x: elapsedWorkingDays(sprint, d, cal), y: carry });
  }
  return out;
}

/** "on day 16, 2 days late", "on day 12, inside the sprint", "on the last day". */
export function whenLine(day: number, length: number): string {
  const d = Math.ceil(day);
  if (d === length) return "on the last day";
  return d > length
    ? `on day ${d}, ${plural(d - length, "day")} late`
    : `on day ${d}, inside the sprint`;
}

/** " (not counting 1 story without points)": the board's numbers leave them out. */
const notCounting = (n: number) =>
  n > 0 ? ` (not counting ${plural(n, "story", "stories")} without points)` : "";

type StatusNumbers = Omit<BurnStatus, "verdict" | "scopeVerdict">;

/**
 * Where the sprint stands against its burn: the gap, the % done, the
 * projections and the verdicts, on the calendar the burn was built with.
 */
export function burnStatus(burn: BurnSeries, sprint: Sprint): BurnStatus {
  const cal = burn.calendar;
  const length = burn.lengthDays;
  const at = burn.lastDay;
  const left = burn.remaining;
  const idealRaw =
    at !== null && left !== null ? idealRemainingAt(sprint, burn.base, at, cal) : null;
  const gap = idealRaw !== null && left !== null ? gapOf(left, idealRaw) : null;
  const cantTell = burn.source === "stories" && burn.unpointedOpen > 0 && (left ?? 0) <= 0;

  const numbers: StatusNumbers = {
    idealRemaining: idealRaw === null ? null : round1(idealRaw),
    gap,
    gapLabel: gap === null ? null : gapLabelOf(gap),
    completionPct: burn.done === null ? null : completionPct(burn.done, burn.scopeNow),
    projectedFinishDay: null,
    projectedMeetDay: null,
    willFinishOnTime: null,
    willMeetOnTime: null,
    cantTell,
  };
  if (at !== null && left !== null && !cantTell) {
    const total = sprintWorkingDays(sprint, cal);
    if (left <= 0) {
      numbers.projectedFinishDay = at;
      numbers.willFinishOnTime = at <= length;
    } else {
      const finish = projectFinish(trendPoints(burn, sprint, "remaining"));
      if (finish !== null) {
        numbers.projectedFinishDay = dayForWorkingDay(sprint, finish, cal);
        numbers.willFinishOnTime = finish <= total;
      }
    }
    if (burn.done !== null && burn.scopeNow > 0) {
      if (burn.done >= burn.scopeNow) {
        numbers.projectedMeetDay = at;
        numbers.willMeetOnTime = at <= length;
      } else {
        const meet = projectFinish(trendPoints(burn, sprint, "done"), {
          target: burn.scopeNow,
        });
        if (meet !== null) {
          numbers.projectedMeetDay = dayForWorkingDay(sprint, meet, cal);
          numbers.willMeetOnTime = meet <= total;
        }
      }
    }
  }
  return {
    ...numbers,
    verdict: paceVerdict(burn, sprint, numbers),
    scopeVerdict: scopeVerdict(burn, sprint, numbers),
  };
}

/**
 * What both sentences open with ("Day 5 of 14", "Sprint 4 is closed"), or a
 * whole sentence when there is nothing to read yet.
 */
function leadIn(
  burn: BurnSeries,
  sprint: Sprint,
  unit: "left" | "done"
): { lead: string } | { sentence: string } {
  const name = sprint.name.trim() || "This sprint";
  if (sprint.status === "cancelled") return { sentence: `${name} was cancelled.` };
  if (burn.phase === "undated") {
    return { sentence: `${name} has no dates yet, so its days can't be charted.` };
  }
  if (burn.phase === "before") {
    const planned = burn.source === "stories" ? burn.scopeNow : burn.committed;
    const days = plural(-(burn.todayAt as number), "day");
    return { sentence: `${name} starts in ${days} with ${points(planned)} planned.` };
  }
  const lead =
    burn.phase === "running"
      ? `Day ${burn.todayDay} of ${burn.lengthDays}`
      : sprint.status === "completed"
        ? `${name} is closed`
        : `${name} ended ${plural((burn.todayAt as number) - burn.lengthDays, "day")} ago`;
  if (burn.source === "none" || burn.done === null || burn.remaining === null) {
    return {
      sentence:
        burn.phase === "running"
          ? `${lead}: nothing recorded yet. Point the sprint's stories and move them on the board, or log the points ${unit} each day.`
          : `${lead} with nothing recorded.`,
    };
  }
  return { lead };
}

function paceVerdict(burn: BurnSeries, sprint: Sprint, s: StatusNumbers): string {
  const opened = leadIn(burn, sprint, "left");
  if ("sentence" in opened) return opened.sentence;
  const { lead } = opened;
  const done = burn.done as number;
  const left = burn.remaining as number;
  if (s.cantTell) {
    const n = burn.unpointedOpen;
    return `${lead}: every pointed story is done, but ${plural(n, "open story", "open stories")} ${
      n === 1 ? "has" : "have"
    } no points yet, so what's left can't be told.`;
  }
  if (left <= 0) return `${lead}: all ${points(burn.scopeNow)} done.`;
  const pace = s.gapLabel ? `, ${lower(s.gapLabel)}` : "";
  const finish =
    s.projectedFinishDay === null
      ? "; there's no trend to project a finish from yet"
      : `; at this pace it finishes ${whenLine(s.projectedFinishDay, burn.lengthDays)}`;
  return `${lead}: ${fmt(done)} of ${points(burn.scopeNow)} done${pace}${notCounting(
    burn.unpointedOpen
  )}${finish}.`;
}

/** "the scope grew by 8 and lost 3 points since day 0", or that it held. */
export function churnLine(burn: Pick<BurnSeries, "scopeAdded" | "scopeRemoved">): string {
  const { scopeAdded: a, scopeRemoved: r } = burn;
  if (a === 0 && r === 0) return "the scope hasn't changed since day 0";
  if (r === 0) return `the scope grew by ${points(a)} since day 0`;
  if (a === 0) return `the scope lost ${points(r)} since day 0`;
  return `the scope grew by ${fmt(a)} and lost ${points(r)} since day 0`;
}

function scopeVerdict(burn: BurnSeries, sprint: Sprint, s: StatusNumbers): string {
  const opened = leadIn(burn, sprint, "done");
  if ("sentence" in opened) return opened.sentence;
  const { lead } = opened;
  const done = burn.done as number;
  const pct = s.completionPct === null ? "" : ` (${s.completionPct}%)`;
  const meet = s.cantTell
    ? "; what's left can't be told while open stories have no points"
    : burn.scopeNow > 0 && done >= burn.scopeNow
      ? "; the work has met the scope"
      : s.projectedMeetDay === null
        ? "; there's no trend to project from yet"
        : `; at this pace the work meets the scope ${whenLine(s.projectedMeetDay, burn.lengthDays)}`;
  return `${lead}: ${fmt(done)} of ${points(burn.scopeNow)} done${pct}${notCounting(
    burn.unpointedOpen
  )}; ${churnLine(burn)}${meet}.`;
}

/* ── Charts and agents ────────────────────────────────────────────────── */

/**
 * Runs of days off as x-axis spans, for shading a chart: a day off runs
 * from its tick to the next one, where the ideal line is flat.
 */
export function offDayRanges(
  burn: Pick<BurnSeries, "days" | "lengthDays">
): Array<{ from: number; to: number; off: BurnOff }> {
  const out: Array<{ from: number; to: number; off: BurnOff }> = [];
  for (const d of burn.days) {
    if (d.working || d.day >= burn.lengthDays) continue;
    const prev = out[out.length - 1];
    if (prev && prev.to === d.day && prev.off === d.off) prev.to = d.day + 1;
    else out.push({ from: d.day, to: d.day + 1, off: d.off });
  }
  return out;
}

/** One sprint's burn as `tool.burndown.status` and `tool.burnup.status` return it. */
export interface BurnReport {
  sprintId: string;
  sprintName: string;
  sprintStatus: Sprint["status"];
  source: BurnSource;
  available: BurnSeries["available"];
  phase: BurnPhase;
  lengthDays: number;
  workingDays: number;
  onWorkingDays: boolean;
  todayDay: number | null;
  lastDay: number | null;
  committed: number;
  base: number;
  initialScope: number;
  scopeNow: number;
  scopeAdded: number;
  scopeRemoved: number;
  done: number | null;
  remaining: number | null;
  completionPct: number | null;
  idealRemaining: number | null;
  gap: number | null;
  gapLabel: string | null;
  projectedFinishDay: number | null;
  willFinishOnTime: boolean | null;
  projectedMeetDay: number | null;
  willMeetOnTime: boolean | null;
  cantTell: boolean;
  unpointedOpen: number;
  caveats: string[];
  verdict: string;
  scopeVerdict: string;
  days: Array<
    Pick<
      BurnDay,
      | "day"
      | "date"
      | "working"
      | "off"
      | "ideal"
      | "remaining"
      | "done"
      | "scope"
      | "added"
      | "removed"
      | "from"
    >
  >;
}

/** The burn and its status for an agent: the page's numbers, the days, and what to read them with. */
export function burnReport(input: BurnInput): BurnReport {
  const burn = burnSeries(input);
  const s = burnStatus(burn, input.sprint);
  return {
    sprintId: input.sprint.id,
    sprintName: input.sprint.name,
    sprintStatus: input.sprint.status,
    source: burn.source,
    available: burn.available,
    phase: burn.phase,
    lengthDays: burn.lengthDays,
    workingDays: burn.workingDays,
    onWorkingDays: burn.onWorkingDays,
    todayDay: burn.todayDay,
    lastDay: burn.lastDay,
    committed: burn.committed,
    base: burn.base,
    initialScope: burn.initialScope,
    scopeNow: burn.scopeNow,
    scopeAdded: burn.scopeAdded,
    scopeRemoved: burn.scopeRemoved,
    done: burn.done,
    remaining: burn.remaining,
    completionPct: s.completionPct,
    idealRemaining: s.idealRemaining,
    gap: s.gap,
    gapLabel: s.gapLabel,
    projectedFinishDay: s.projectedFinishDay,
    willFinishOnTime: s.willFinishOnTime,
    projectedMeetDay: s.projectedMeetDay,
    willMeetOnTime: s.willMeetOnTime,
    cantTell: s.cantTell,
    unpointedOpen: burn.unpointedOpen,
    caveats: burnCaveats(burn),
    verdict: s.verdict,
    scopeVerdict: s.scopeVerdict,
    days: burn.days.map((d) => ({
      day: d.day,
      date: d.date,
      working: d.working,
      off: d.off,
      ideal: d.ideal,
      remaining: d.remaining,
      done: d.done,
      scope: d.scope,
      added: d.added,
      removed: d.removed,
      from: d.from,
    })),
  };
}

/** What an agent should read with the numbers: what they leave out or guess. */
export function burnCaveats(burn: BurnSeries): string[] {
  const out: string[] = [];
  if (!burn.dated) out.push("The sprint has no real dates, so its days can't be charted.");
  if (burn.source === "log") {
    out.push(
      burn.available.stories
        ? "Read from the typed daily log, as the sprint is closed (closing can move its stories)."
        : "Read from the typed daily log: the sprint has no pointed stories."
    );
  }
  if (burn.source === "none") out.push("Nothing is recorded yet: no pointed stories, no log.");
  if (burn.unpointedOpen > 0) {
    out.push(
      `${plural(burn.unpointedOpen, "open story", "open stories")} without points: the board's points left are a floor.`
    );
  }
  if (burn.source === "stories" && burn.unknownJoin > 0) {
    out.push(
      `${plural(burn.unknownJoin, "story", "stories")} with no record of joining the sprint count from day 0.`
    );
  }
  if (burn.source === "stories" && burn.undatedDone > 0) {
    out.push(
      `${plural(burn.undatedDone, "done story", "done stories")} with no done date count from the day they arrived.`
    );
  }
  if (!burn.onWorkingDays) out.push("The ideal line counts calendar days.");
  return out;
}
