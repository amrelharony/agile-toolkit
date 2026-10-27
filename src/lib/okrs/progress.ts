/**
 * One reading of an OKR's numbers for every place that shows them: the OKR
 * page and its Markdown, Sprint Goal's linked OKRs, the tool.okrs agent
 * actions, the health dashboard, the AI prompt and the Canvas import.
 * Before Phase 8 five copies of the formula disagreed (a negative target, a
 * zero target, rounding per objective), and none knew a key result could
 * fall.
 *
 * Progress runs from a key result's baseline to its target, up or down:
 * (current − baseline) / (target − baseline), clamped to 0..1. Rows saved
 * before Phase 8 have no baseline and read it as 0, so their numbers don't
 * change. Dated check-ins hold the history; `current` and `confidence`
 * mirror the newest one (withCheckIn), so every reader that only looks at
 * `current` stays right; confidenceTrend and progressTrend replay the
 * history per check-in day.
 *
 * Pure; server-safe (the MCP route calls it): no "use client" module, React
 * or store anywhere below it.
 */

import {
  KR_CHECK_IN_CAP,
  type KeyResult,
  type KeyResultCheckIn,
  type KeyResultDirection,
  type Okr,
} from "@/lib/stores/workspace-types";
import { fmt } from "@/lib/charts/chart-text";
import { isIsoDate, isoDayNumber, isoFromDayNumber } from "@/lib/sprints/calendar";
import { normalizeQuarter, quarterBounds } from "@/lib/roadmap/quarters";
import { todayLocalISO } from "@/lib/utils/formatters";

// The links to sprint goals live with the other link readers; exported here
// too, so the page and the agent can take every OKR reading from one module.
export { sprintGoalsFor, type SprintGoalLink } from "./links";

/** The longest check-in note: the workspace schema's bound (KeyResultCheckInSchema). */
export const CHECK_IN_NOTE_MAX = 500;

/** Days without a check-in before a key result is flagged ("No check-in for 14 days"). */
export const CHECK_IN_STALE_DAYS = 14;

/**
 * The latest day ("YYYY-MM-DD") a check-in may be for, read against
 * `today`. A check-in is for its recorder's local day, never a later one:
 * on the user's own clock (the page, the agent in their browser) that is
 * `today`. A day set on another clock (an MCP server on UTC writing for
 * the user; a snapshot link shared from a zone ahead of its visitor's) can
 * be a day ahead of the reader's own, so then the day after is taken too.
 */
export function latestCheckInDay(today: string, otherClock: boolean): string {
  const n = otherClock ? isoDayNumber(today) : null;
  return n === null ? today : isoFromDayNumber(n + 1);
}

/**
 * Within this share of the quarter (5 points) progress counts as on pace:
 * a key result checked in a few days late shouldn't flip the verdict.
 */
const PACE_TOLERANCE = 0.05;

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Whether `c` is a confidence score: a number from 0 to 10. */
export function isConfidence(c: unknown): c is number {
  return finite(c) && c >= 0 && c <= 10;
}

/**
 * A key result's baseline, or null when it has none: rows from before
 * Phase 8 (their progress reads it as 0). The page asks for one.
 */
export function krBaseline(kr: Pick<KeyResult, "baseline">): number | null {
  return finite(kr.baseline) ? kr.baseline : null;
}

/**
 * Which way a key result's number should move. The numbers decide when they
 * can (a baseline that differs from the target says it), so a stored
 * direction that contradicts them can't turn progress around; the stored
 * direction decides only when they can't: no baseline, or a baseline equal
 * to the target (a number to hold). Absent: "increase".
 */
export function krDirection(
  kr: Pick<KeyResult, "direction" | "baseline" | "target">
): KeyResultDirection {
  const base = krBaseline(kr);
  if (base !== null && finite(kr.target) && kr.target !== base) {
    return kr.target < base ? "decrease" : "increase";
  }
  return kr.direction === "decrease" ? "decrease" : "increase";
}

/**
 * A key result's progress, 0..1: (current − base) / (target − base),
 * clamped, with base = the baseline (0 when absent). The cases the
 * division can't answer:
 * - a "decrease" key result with no baseline is 1 once current is at or
 *   below the target, else 0 (there is no start to measure from);
 * - a baseline equal to the target (a number to hold) is 1 while current is
 *   on the right side of it, else 0;
 * - a row with no baseline and a target of 0 reads 0, as it did before
 *   Phase 8 (nothing can be measured from 0 to 0);
 * - a non-finite current or target reads 0.
 */
export function krProgress(
  kr: Pick<KeyResult, "current" | "target" | "baseline" | "direction">
): number {
  const { current, target } = kr;
  if (!finite(current) || !finite(target)) return 0;
  const base = krBaseline(kr);
  const direction = krDirection(kr);
  const reached = direction === "decrease" ? current <= target : current >= target;
  if (base === null) {
    if (direction === "decrease") return reached ? 1 : 0;
    if (target === 0) return 0;
    return clamp01(current / target);
  }
  const span = target - base;
  if (span === 0) return reached ? 1 : 0;
  return clamp01((current - base) / span);
}

/** A key result's progress as a whole percentage. */
export function krPercent(
  kr: Pick<KeyResult, "current" | "target" | "baseline" | "direction">
): number {
  return Math.round(krProgress(kr) * 100);
}

/** An objective's progress: the mean of its key results', 0..1 (0 with none). */
export function objectiveProgress(okr: Pick<Okr, "keyResults">): number {
  const krs = okr.keyResults ?? [];
  if (krs.length === 0) return 0;
  return krs.reduce((a, kr) => a + krProgress(kr), 0) / krs.length;
}

/** An objective's progress as a whole percentage (rounded once, from the unrounded mean). */
export function objectivePercent(okr: Pick<Okr, "keyResults">): number {
  return Math.round(objectiveProgress(okr) * 100);
}

/**
 * Progress across objectives: the mean of each objective's progress, 0..1
 * (0 with none). Each objective weighs the same however many key results
 * it has, as the page's headline reads it.
 */
export function overallProgress(okrs: readonly Pick<Okr, "keyResults">[]): number {
  if (okrs.length === 0) return 0;
  return okrs.reduce((a, o) => a + objectiveProgress(o), 0) / okrs.length;
}

/**
 * "40 of 120 sign-ups" for a key result counted up from 0, "18% (from 22%,
 * target 15%)" once the start matters (any decrease, any other baseline),
 * and "18% (target 15% or below, no baseline)" for a decrease with no start.
 */
export function krProgressText(kr: KeyResult): string {
  const unit = kr.unit?.trim() ?? "";
  const show = (n: number) => (unit === "%" ? `${fmt(n)}%` : fmt(n));
  const suffix = unit && unit !== "%" ? ` ${unit}` : "";
  const base = krBaseline(kr);
  const direction = krDirection(kr);
  if (base === null) {
    return direction === "decrease"
      ? `${show(kr.current)}${suffix} (target ${show(kr.target)} or below, no baseline)`
      : `${show(kr.current)} of ${show(kr.target)}${suffix}`;
  }
  if (direction === "increase" && base === 0) {
    return `${show(kr.current)} of ${show(kr.target)}${suffix}`;
  }
  return `${show(kr.current)}${suffix} (from ${show(base)}, target ${show(kr.target)})`;
}

/* ── Confidence ─────────────────────────────────────────────────────── */

export type ConfidenceBand = "off-track" | "at-risk" | "on-track";

/** The bands a confidence score reads in: ≤ 3 off track, 4–6 at risk, ≥ 7 on track. */
export const CONFIDENCE_BAND_LABEL: Record<ConfidenceBand, string> = {
  "off-track": "Off track",
  "at-risk": "At risk",
  "on-track": "On track",
};

/**
 * The band a confidence falls in, or null when it isn't scored (absent, or
 * off the 0–10 scale an agent may have written before Phase 8). A mean
 * between whole scores (3.5, 6.5) reads at risk.
 */
export function confidenceBand(c: number | null | undefined): ConfidenceBand | null {
  if (!isConfidence(c)) return null;
  if (c <= 3) return "off-track";
  return c >= 7 ? "on-track" : "at-risk";
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * An objective's confidence: the mean of its key results' scored
 * confidences, to one decimal, or null when none is scored. A key result
 * that isn't scored is left out, never read as 0 or 5.
 */
export function objectiveConfidence(okr: Pick<Okr, "keyResults">): number | null {
  const scored = (okr.keyResults ?? []).map((kr) => kr.confidence).filter(isConfidence);
  if (scored.length === 0) return null;
  return round1(scored.reduce((a, c) => a + c, 0) / scored.length);
}

/* ── Check-ins ──────────────────────────────────────────────────────── */

/** A check-in a reader can place: a real "YYYY-MM-DD" day and a finite value. */
const readable = (c: KeyResultCheckIn) =>
  isIsoDate(c.date) && c.date.length === 10 && finite(c.value);

/** Oldest first; a stable sort, so same-day check-ins keep the order they were made in. */
function byDate(list: readonly KeyResultCheckIn[]): KeyResultCheckIn[] {
  // An unreadable date sorts first, so the cap drops it before a real one.
  const key = (c: KeyResultCheckIn) => (readable(c) ? c.date : "");
  return [...list].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

/**
 * `current` and `confidence` mirrored from the check-ins: current is the
 * newest-dated readable check-in's value, confidence the newest scored
 * one's. With no scored check-in, `fallback` is the confidence (the key
 * result's own, typed or set before its first scored check-in).
 */
function mirror(kr: KeyResult, list: KeyResultCheckIn[], fallback: number | undefined): KeyResult {
  let newest: KeyResultCheckIn | undefined;
  let scored: number | undefined;
  for (const c of list) {
    if (!readable(c)) continue;
    newest = c;
    if (isConfidence(c.confidence)) scored = c.confidence;
  }
  const next: KeyResult = { ...kr, checkIns: list };
  if (newest) next.current = newest.value;
  const confidence = scored ?? fallback;
  if (confidence === undefined) delete next.confidence;
  else next.confidence = confidence;
  return next;
}

/**
 * The key result with check-in `c` recorded (or, with the id of one it
 * holds, replaced in place): sorted by date, capped at KR_CHECK_IN_CAP with
 * the oldest dropped, and `current` / `confidence` mirrored from the newest
 * (see mirror). A backdated check-in older than the newest joins the
 * history without changing `current`. The first check-in on a key result
 * with none becomes `current` (and, scored, its confidence) whatever its
 * date: a typed value has no date to weigh it against, and "current is the
 * newest check-in's" stays true for every reader. Callers warn when that
 * rolls a different value back (replacesUndated). One older than every kept
 * check-in of a full history is dropped at once: `checkIns` then lacks its
 * id, which a caller can check. Callers validate `c` first (a real day,
 * never after latestCheckInDay; a finite value; confidence 0–10 or absent).
 */
export function withCheckIn(kr: KeyResult, c: KeyResultCheckIn): KeyResult {
  const list = kr.checkIns ?? [];
  const at = list.findIndex((x) => x.id === c.id);
  const next = at === -1 ? [...list, c] : list.map((x, i) => (i === at ? c : x));
  // An edit that clears a scored check-in's confidence mustn't keep the
  // score it mirrored: the key result's own confidence is then that score.
  const fallback = at !== -1 && isConfidence(list[at].confidence) ? undefined : kr.confidence;
  return mirror(kr, byDate(next).slice(-KR_CHECK_IN_CAP), fallback);
}

/**
 * The key result as withCheckIn leaves one, for a writer that sets its
 * whole check-in list at once (the workspace.okr CRUD): check-ins sorted
 * oldest first and capped, `current` the newest readable one's value and
 * `confidence` the newest scored one's (the key result's own when none is
 * scored). The key result itself when it has no readable check-in: then
 * nothing dated says what `current` is.
 */
export function withMirroredCheckIns(kr: KeyResult): KeyResult {
  const list = kr.checkIns ?? [];
  if (!list.some(readable)) return kr;
  return mirror(kr, byDate(list).slice(-KR_CHECK_IN_CAP), kr.confidence);
}

/**
 * The key result without check-in `checkInId`, re-mirrored from the rest.
 * With none left, `current` goes back to the baseline (where a key result
 * starts; one with no baseline keeps its value, as nothing older is known).
 * A removed scored check-in takes its confidence with it when no scored one
 * is left. The value typed before the first check-in isn't kept anywhere,
 * so a caller that deletes check-ins keeps the whole key result to undo
 * with. Unknown id: the key result as it was.
 */
export function withoutCheckIn(kr: KeyResult, checkInId: string): KeyResult {
  const list = kr.checkIns ?? [];
  const removed = list.find((c) => c.id === checkInId);
  if (!removed) return kr;
  const rest = byDate(list.filter((c) => c.id !== checkInId));
  const fallback = isConfidence(removed.confidence) ? undefined : kr.confidence;
  const next = mirror(kr, rest, fallback);
  if (rest.some(readable)) return next;
  const base = krBaseline(kr);
  return base === null ? next : { ...next, current: base };
}

/** What a backdated first check-in rolls back (see replacesUndated). */
export interface UndatedReplaced {
  /** The typed `current` it replaces, or null when it leaves current as it was. */
  current: number | null;
  /** The confidence, scored without a dated check-in, it replaces; or null. */
  confidence: number | null;
}

/**
 * What recording `c` would replace that no check-in dated, or null when it
 * replaces nothing: withCheckIn makes a key result's first check-in its
 * `current` (and first scored one its confidence) whatever the date, so a
 * check-in dated before `today` ("YYYY-MM-DD") on a key result with none may
 * roll a newer typed value back (an agent backfilling history on a row from
 * before Phase 8, whose `current` is the latest known). The check-in is
 * still recorded; the page and tool.okrs.check_in say what it replaced, so
 * the user can check in today's value if the typed one was newer. Only a
 * different value counts.
 */
export function replacesUndated(
  kr: KeyResult,
  c: KeyResultCheckIn,
  today: string
): UndatedReplaced | null {
  if (!readable(c) || c.date >= today) return null;
  const list = kr.checkIns ?? [];
  const current =
    !list.some(readable) && finite(kr.current) && kr.current !== c.value ? kr.current : null;
  const confidence =
    isConfidence(c.confidence) &&
    isConfidence(kr.confidence) &&
    kr.confidence !== c.confidence &&
    !list.some((x) => readable(x) && isConfidence(x.confidence))
      ? kr.confidence
      : null;
  return current === null && confidence === null ? null : { current, confidence };
}

/** A key result's newest-dated readable check-in, or null when it has none. */
export function lastCheckIn(kr: Pick<KeyResult, "checkIns">): KeyResultCheckIn | null {
  let newest: KeyResultCheckIn | null = null;
  for (const c of kr.checkIns ?? []) {
    if (readable(c) && (newest === null || c.date >= newest.date)) newest = c;
  }
  return newest;
}

/**
 * Whole days from a key result's last check-in to `today` ("YYYY-MM-DD"),
 * or null when it has none. The page flags CHECK_IN_STALE_DAYS or more.
 */
export function daysSinceCheckIn(kr: Pick<KeyResult, "checkIns">, today: string): number | null {
  const last = lastCheckIn(kr);
  const a = isoDayNumber(last?.date);
  const b = isoDayNumber(today);
  return a === null || b === null ? null : Math.max(0, b - a);
}

export interface ConfidencePoint {
  /** "YYYY-MM-DD": a day a key result's confidence was scored. */
  date: string;
  /** The mean, to one decimal, of each key result's latest scored confidence as of that day. */
  confidence: number;
  /** How many key results had a scored confidence by then. */
  scored: number;
}

/**
 * An objective's confidence over time, oldest first: one point per day a
 * check-in scored confidence, each the mean of every key result's latest
 * scored confidence as of that day, over the key results the headline
 * (objectiveConfidence) reads. A key result scored with no dated scored
 * check-in (typed, set by an agent, the 5 rows from before Phase 8 carry,
 * or kept over unscored check-ins) has no day its score changed, so it
 * counts that score on every day: without it the mean would jump between
 * the trend and the headline on a score nobody moved. One whose scored
 * check-ins all come after a day isn't scored yet that day, as `scored`
 * says. The last point is the headline while `confidence` mirrors the
 * check-ins (withCheckIn). Gate a trend statistic on the points with
 * MIN_SAMPLE.
 */
export function confidenceTrend(okr: Pick<Okr, "keyResults">): ConfidencePoint[] {
  const perKr = (okr.keyResults ?? []).map((kr) => {
    const dated = byDate(
      (kr.checkIns ?? []).filter((c) => readable(c) && isConfidence(c.confidence))
    );
    const undated = dated.length === 0 && isConfidence(kr.confidence) ? kr.confidence : undefined;
    return { dated, undated };
  });
  const days = Array.from(new Set(perKr.flatMap((k) => k.dated.map((c) => c.date)))).sort();
  return days.map((day) => {
    let sum = 0;
    let scored = 0;
    for (const { dated, undated } of perKr) {
      let latest = undated;
      for (const c of dated) {
        if (c.date > day) break;
        latest = c.confidence;
      }
      if (latest !== undefined) {
        sum += latest;
        scored += 1;
      }
    }
    return { date: day, confidence: round1(sum / scored), scored };
  });
}

export interface ProgressPoint {
  /** "YYYY-MM-DD": a day a key result was checked in. */
  date: string;
  /** The objective's progress that day, 0..1 (objectiveProgress as its key results read then). */
  progress: number;
  /** How many key results had a check-in by then. */
  measured: number;
}

/**
 * An objective's progress over time, oldest first: one point per day a key
 * result was checked in, each objectiveProgress replayed on that day (every
 * key result's krProgress at its latest check-in value by then). It needs
 * no confidence, so a team that checks in values without scoring them
 * still sees how far the objective moved. Before its first check-in a key
 * result reads at its baseline (where it starts; 0 with none). One with no
 * dated check-in at all has no day its value changed, so its current value
 * counts on every day, as confidenceTrend counts an undated score: without
 * it the line would end away from the headline on a value nobody moved.
 * While current mirrors the newest check-in (withCheckIn), the last point
 * is objectiveProgress. Gate a trend statistic on the points with
 * MIN_SAMPLE.
 */
export function progressTrend(okr: Pick<Okr, "keyResults">): ProgressPoint[] {
  const perKr = (okr.keyResults ?? []).map((kr) => ({
    kr,
    dated: byDate((kr.checkIns ?? []).filter(readable)),
  }));
  const days = Array.from(new Set(perKr.flatMap((k) => k.dated.map((c) => c.date)))).sort();
  return days.map((day) => {
    let sum = 0;
    let measured = 0;
    for (const { kr, dated } of perKr) {
      if (dated.length === 0) {
        sum += krProgress(kr);
        continue;
      }
      let value: number | undefined;
      for (const c of dated) {
        if (c.date > day) break;
        value = c.value;
      }
      if (value === undefined) {
        const base = krBaseline(kr);
        if (base !== null) sum += krProgress({ ...kr, current: base });
        continue;
      }
      measured += 1;
      sum += krProgress({ ...kr, current: value });
    }
    return { date: day, progress: sum / perKr.length, measured };
  });
}

/* ── Verdict ────────────────────────────────────────────────────────── */

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** "3 Oct" for "2026-10-03" (a fixed English form, the same in the browser and on the server). */
function shortDay(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
}

export interface QuarterPace {
  /** The quarter's first and last day, "YYYY-MM-DD". */
  start: string;
  end: string;
  totalDays: number;
  /** Days gone, today included (0 before the quarter, totalDays after it). */
  elapsedDays: number;
  daysLeft: number;
  /** elapsedDays / totalDays, 0..1: where progress would be at an even pace. */
  elapsedShare: number;
  phase: "before" | "during" | "after";
}

/** How far `today` ("YYYY-MM-DD") is through `quarter`, or null when the quarter can't be read. */
export function quarterPace(quarter: string, today: string): QuarterPace | null {
  const bounds = quarterBounds(quarter);
  const t = isoDayNumber(today);
  if (!bounds || t === null) return null;
  const s = isoDayNumber(bounds.start) as number;
  const e = isoDayNumber(bounds.end) as number;
  const totalDays = e - s + 1;
  const elapsedDays = Math.max(0, Math.min(totalDays, t - s + 1));
  return {
    start: bounds.start,
    end: bounds.end,
    totalDays,
    elapsedDays,
    daysLeft: totalDays - elapsedDays,
    elapsedShare: elapsedDays / totalDays,
    phase: t < s ? "before" : t > e ? "after" : "during",
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The progress half of the verdict: how far, against the quarter's days. */
function progressClause(okr: Okr, today: string): string {
  const progress = objectiveProgress(okr);
  const pct = `${Math.round(progress * 100)}%`;
  if (progress >= 1) return "Every key result has reached its target";
  const quarter = normalizeQuarter(okr.quarter);
  const pace = quarterPace(okr.quarter, today);
  if (!pace) return `${pct} of the way (no quarter to judge the pace against)`;
  if (pace.phase === "before")
    return `${pct} of the way; ${quarter} starts ${shortDay(pace.start)}`;
  if (pace.phase === "after") return `${quarter} ended at ${pct} of the way`;
  const gap = progress - pace.elapsedShare;
  const word =
    gap > PACE_TOLERANCE ? "ahead of pace" : gap < -PACE_TOLERANCE ? "behind pace" : "on pace";
  return `${pct} of the way with ${pace.daysLeft} of ${plural(pace.totalDays, "day")} left (${Math.round(
    pace.elapsedShare * 100
  )}% of the quarter gone): ${word}`;
}

/**
 * The confidence half: the mean now, and which way it moved since the
 * reading before. The reading before is a trend point, which counts the
 * same key results as the mean now (a score with no dated check-in on
 * every day), so a score nobody moved can't read as a move. When a
 * different number of key results was scored that day (one scored for the
 * first time since), the sentence says so: that mean was over fewer.
 */
function confidenceClause(okr: Okr): string {
  const now = objectiveConfidence(okr);
  if (now === null) return "confidence not scored";
  const krs = okr.keyResults ?? [];
  const scored = krs.filter((kr) => isConfidence(kr.confidence)).length;
  const of = scored < krs.length ? ` (${scored} of ${krs.length} key results scored)` : "";
  const trend = confidenceTrend(okr);
  const before = trend.length >= 2 ? trend[trend.length - 2] : null;
  if (!before) return `confidence ${fmt(now)}/10${of}`;
  const moved =
    now < before.confidence
      ? `down from ${fmt(before.confidence)}`
      : now > before.confidence
        ? `up from ${fmt(before.confidence)}`
        : "unchanged";
  const then =
    before.scored !== scored ? ` (${before.scored} of ${krs.length} key results scored then)` : "";
  return `confidence ${fmt(now)}/10${of}, ${moved} since ${shortDay(before.date)}${then}`;
}

/**
 * One sentence on an objective: its progress against the time gone in its
 * quarter (quarterBounds; within 5 points counts as on pace), and its
 * confidence with the direction since the reading before. "63% of the way
 * with 40 of 92 days left (57% of the quarter gone): ahead of pace;
 * confidence 6/10, down from 8 since 3 Oct."
 */
export function okrVerdict(okr: Okr, now: Date = new Date()): string {
  if ((okr.keyResults ?? []).length === 0) {
    return "No key results yet: add one to measure this objective.";
  }
  return `${progressClause(okr, todayLocalISO(now))}; ${confidenceClause(okr)}.`;
}
