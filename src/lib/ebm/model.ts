/**
 * The EBM Dashboard: Evidence-Based Management's four key value areas,
 * each with its measures (`ProductMetric` rows with `kva` set, so they
 * show in Product Metrics too), a goal ladder from the strategic goal down
 * to the sprint's, and the reviews kept on the one `EbmBoard` document.
 *
 * "Area progress" is our own simplification (EBM itself gives no score):
 * the mean of the area's measures' progress to their targets, and "not
 * measured", never 0, when none has both a reading and a target.
 *
 * Pure; server-safe (the MCP route calls it): no "use client" module,
 * React or store anywhere below it.
 */

import {
  EBM_BOARD_ID,
  EBM_VALUE_AREAS,
  TOOL_LIST_MAX,
  TOOL_TEXT_MAX,
  type EbmBoard,
  type EbmReview,
  type EbmValueArea,
  type Hypothesis,
  type HypothesisTracker,
  type ProductGoal,
  type ProductMetric,
  type Sprint,
} from "@/lib/stores/workspace-types";
import { activeGoal } from "@/lib/product-goal/model";
import { pickDefaultSprint } from "@/lib/sprints/series";
import { isDay } from "@/lib/hypotheses/model";
import { isExampleId } from "@/lib/utils/example-id";
import type { FormErrors, Validation } from "@/lib/utils/form";
import {
  daysBetween,
  isEbmExample,
  metricProgress,
  usableMetrics,
} from "@/lib/product-metrics/model";

/* ── Words ──────────────────────────────────────────────────────────── */

/** The framework's own area names, used as names. */
export const AREA_LABEL: Record<EbmValueArea, string> = {
  "current-value": "Current Value",
  "unrealized-value": "Unrealized Value",
  "time-to-market": "Time to Market",
  "ability-to-innovate": "Ability to Innovate",
};

/** What each area asks, in our own words. */
export const AREA_MEANING: Record<EbmValueArea, string> = {
  "current-value": "What the product gives people today.",
  "unrealized-value": "What more it could give, by meeting needs you don't meet yet.",
  "time-to-market": "How fast you deliver something new and learn from it.",
  "ability-to-innovate": "How much of the team's time can go to new value rather than upkeep.",
};

/** Next steps a rule-made review suggests for its focus area, in our own words. */
export const AREA_NEXT_STEPS: Record<EbmValueArea, readonly string[]> = {
  "current-value": [
    "Ask a few customers what they would miss most if the product went away.",
    "Pick one measure of value people get today and read it every month.",
  ],
  "unrealized-value": [
    "List the needs customers ask for that the product doesn't meet yet.",
    "Write one hypothesis about the biggest gap and test it this quarter.",
  ],
  "time-to-market": [
    "Find the longest wait in how work flows from idea to release, and shorten it.",
    "Split the next big item so the first part reaches people within a sprint.",
  ],
  "ability-to-innovate": [
    "Set aside part of each sprint to pay down the tech debt that slows the team most.",
    "Look at what pulled the team off planned work, and remove one cause.",
  ],
};

/** The credit line, beside the link to the framework's home. */
export const EBM_CREDIT =
  "Evidence-Based Management is Scrum.org's. This page is independent and not endorsed by Scrum.org.";
export const EBM_CREDIT_HREF = "https://www.scrum.org/resources/evidence-based-management";

export const STRATEGIC_GOAL_MAX = TOOL_TEXT_MAX.text;
export const STRATEGIC_WHY_MAX = TOOL_TEXT_MAX.text;
export const REVIEW_NOTE_MAX = TOOL_TEXT_MAX.text;
export const REVIEWS_MAX = TOOL_LIST_MAX.ebmReviews;
/** Days after a review before another is due. */
export const EBM_REVIEW_DAYS = 30;
/** The id prefix of a review the page or Amr records. */
export const REVIEW_ID_PREFIX = "review_";

/* ── The board ──────────────────────────────────────────────────────── */

export function emptyEbmBoard(now: string): EbmBoard {
  return { id: EBM_BOARD_ID, reviews: [], createdAt: now, updatedAt: now };
}

const isArea = (a: unknown): a is EbmValueArea =>
  typeof a === "string" && (EBM_VALUE_AREAS as readonly string[]).includes(a);

/** A stored review that can be read, or null. */
function readReview(raw: unknown): EbmReview | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<EbmReview>;
  if (typeof r.id !== "string" || !isDay(r.date) || !isArea(r.focus)) return null;
  const areas: Partial<Record<EbmValueArea, number>> = {};
  const rawAreas = (r.areas ?? {}) as Record<string, unknown>;
  for (const a of EBM_VALUE_AREAS) {
    const v = rawAreas[a];
    if (typeof v === "number" && Number.isFinite(v)) areas[a] = Math.max(0, Math.min(1, v));
  }
  return {
    id: r.id,
    date: r.date,
    focus: r.focus,
    ...(typeof r.note === "string" && r.note.trim() ? { note: r.note } : {}),
    areas,
  };
}

/** The board as stored, read defensively; null when there is none. */
export function readBoard(boards: readonly EbmBoard[] | undefined | null): EbmBoard | null {
  const raw = (boards ?? []).find((b) => b && b.id === EBM_BOARD_ID);
  return raw ? normalizeBoard(raw) : null;
}

/** A board with its reviews cleaned and oldest first. */
export function normalizeBoard(raw: EbmBoard): EbmBoard {
  const reviews = (Array.isArray(raw.reviews) ? raw.reviews : [])
    .map(readReview)
    .filter((r): r is EbmReview => r !== null)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { ...raw, reviews };
}

/** The reviews newest first. */
export function reviewsNewestFirst(board: EbmBoard | null): EbmReview[] {
  return [...(board?.reviews ?? [])].reverse();
}

/** `board` (or a new one) with `review` added, the newest REVIEWS_MAX kept. */
export function withReview(board: EbmBoard | null, review: EbmReview, now: string): EbmBoard {
  const base = board ?? emptyEbmBoard(now);
  const reviews = [...(base.reviews ?? []), review]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .slice(-REVIEWS_MAX);
  return { ...base, reviews, updatedAt: now };
}

/** `board` (or a new one) with the strategic goal and its why set; blank text clears it. */
export function withStrategicGoal(
  board: EbmBoard | null,
  values: { goal?: string; why?: string },
  now: string
): EbmBoard {
  const base = board ?? emptyEbmBoard(now);
  const { strategicGoal: _g, strategicWhy: _w, ...rest } = base;
  void _g;
  void _w;
  return {
    ...rest,
    ...(values.goal ? { strategicGoal: values.goal } : {}),
    ...(values.goal && values.why ? { strategicWhy: values.why } : {}),
    updatedAt: now,
  };
}

/* ── Measures and areas ─────────────────────────────────────────────── */

/** Every metric tagged with a key value area (examples too unless asked not to). */
export function measuresOf(
  metrics: readonly ProductMetric[] | undefined,
  opts: { withExamples?: boolean } = {}
): ProductMetric[] {
  return usableMetrics(metrics, opts).filter((m) => isArea(m.kva));
}

export function measuresByArea(
  metrics: readonly ProductMetric[] | undefined,
  opts: { withExamples?: boolean } = {}
): Record<EbmValueArea, ProductMetric[]> {
  const out = {} as Record<EbmValueArea, ProductMetric[]>;
  for (const a of EBM_VALUE_AREAS) out[a] = [];
  for (const m of measuresOf(metrics, opts)) out[m.kva as EbmValueArea].push(m);
  return out;
}

/** An area's progress: the mean of its measures' non-null progress; null when none has one. */
export function areaProgress(measures: readonly ProductMetric[]): number | null {
  const ps = measures.map(metricProgress).filter((p): p is number => p !== null);
  if (ps.length === 0) return null;
  return ps.reduce((a, b) => a + b, 0) / ps.length;
}

/** Each measured area's progress, 0–1 to two decimals (an area left out was not measured). */
export function areaScores(
  byArea: Record<EbmValueArea, readonly ProductMetric[]>
): Partial<Record<EbmValueArea, number>> {
  const out: Partial<Record<EbmValueArea, number>> = {};
  for (const a of EBM_VALUE_AREAS) {
    const p = areaProgress(byArea[a] ?? []);
    if (p !== null) out[a] = Math.round(p * 100) / 100;
  }
  return out;
}

/** The measured area with the lowest progress (ties in the framework's order), or null. */
export function weakestArea(scores: Partial<Record<EbmValueArea, number>>): EbmValueArea | null {
  let best: EbmValueArea | null = null;
  for (const a of EBM_VALUE_AREAS) {
    const v = scores[a];
    if (v === undefined) continue;
    if (best === null || v < (scores[best] as number)) best = a;
  }
  return best;
}

/** The area to focus on next: one not measured first, else the weakest. */
export function focusArea(scores: Partial<Record<EbmValueArea, number>>): EbmValueArea {
  return (
    EBM_VALUE_AREAS.find((a) => scores[a] === undefined) ??
    weakestArea(scores) ??
    EBM_VALUE_AREAS[0]
  );
}

/** "62%", or "not measured". */
export const scoreText = (v: number | undefined | null) =>
  v === undefined || v === null ? "not measured" : `${Math.round(v * 100)}%`;

export interface RuleReview {
  focus: EbmValueArea;
  /** A summary built from the numbers. */
  summary: string;
  /** Next steps from our templates for the focus area. */
  steps: string[];
  areas: Partial<Record<EbmValueArea, number>>;
}

/**
 * "Suggest a focus" without AI: an area with no measured progress first,
 * else the one with the lowest; a summary from the numbers; the focus
 * area's next steps from our templates. Nothing is saved.
 */
export function ruleReview(byArea: Record<EbmValueArea, readonly ProductMetric[]>): RuleReview {
  const areas = areaScores(byArea);
  const focus = focusArea(areas);
  const parts = EBM_VALUE_AREAS.map((a) => `${AREA_LABEL[a]} ${scoreText(areas[a])}`);
  const why =
    areas[focus] === undefined
      ? (byArea[focus] ?? []).length === 0
        ? `${AREA_LABEL[focus]} has no measure yet.`
        : `${AREA_LABEL[focus]} has no measure with both a reading and a target yet.`
      : `${AREA_LABEL[focus]} is furthest from its targets.`;
  return {
    focus,
    summary: `${parts.join(", ")}. Focus on ${AREA_LABEL[focus]}: ${why}`,
    steps: [...AREA_NEXT_STEPS[focus]],
    areas,
  };
}

/* ── The goal ladder ────────────────────────────────────────────────── */

export interface GoalLadder {
  strategic: { goal: string; why?: string } | null;
  /** The active Product Goal's statement. */
  intermediate: { id: string; statement: string } | null;
  /** The goal of the sprint the team is in or about to start. */
  tactical: { sprintId: string; sprintName: string; goal: string } | null;
}

/**
 * The ladder: the strategic goal typed here; the intermediate goal, the
 * active Product Goal; the immediate tactical goal, the goal of the sprint
 * `pickDefaultSprint` picks from the team's own sprints, only while it is
 * active or planned. Examples are left out.
 */
export function goalLadder({
  board,
  goals,
  sprints,
}: {
  board: EbmBoard | null;
  goals: readonly ProductGoal[] | undefined;
  sprints: readonly Sprint[] | undefined;
}): GoalLadder {
  const goal = board?.strategicGoal?.trim();
  const active = activeGoal(goals);
  const real = (sprints ?? []).filter((s) => s && !isExampleId(s.id));
  const sprint = pickDefaultSprint(real, null);
  const sprintGoal =
    sprint && (sprint.status === "active" || sprint.status === "planned")
      ? sprint.goal?.trim()
      : "";
  return {
    strategic: goal
      ? { goal, ...(board?.strategicWhy?.trim() ? { why: board.strategicWhy.trim() } : {}) }
      : null,
    intermediate: active ? { id: active.id, statement: active.statement } : null,
    tactical:
      sprint && sprintGoal
        ? { sprintId: sprint.id, sprintName: sprint.name, goal: sprintGoal }
        : null,
  };
}

/* ── Experiments ────────────────────────────────────────────────────── */

/** The hypotheses of every tracker document (examples too unless asked not to). */
export function hypothesesOf(
  trackers: readonly HypothesisTracker[] | undefined,
  { withExamples = true }: { withExamples?: boolean } = {}
): Hypothesis[] {
  return (trackers ?? [])
    .flatMap((t) => (Array.isArray(t?.hypotheses) ? t.hypotheses : []))
    .filter((h) => h && typeof h.id === "string" && (withExamples || !isExampleId(h.id)));
}

/** The hypotheses measured by one of `measures`, with the measure's id. */
export function experimentsFor(
  measures: readonly ProductMetric[],
  hypotheses: readonly Hypothesis[]
): { hypothesis: Hypothesis; metricId: string }[] {
  const ids = new Set(measures.map((m) => m.id));
  return hypotheses
    .filter((h) => h.measuredBy?.metricId && ids.has(h.measuredBy.metricId))
    .map((h) => ({ hypothesis: h, metricId: h.measuredBy!.metricId as string }));
}

/** The measure in an area furthest from its target (else the first), to test a fix for. */
export function weakestMeasure(measures: readonly ProductMetric[]): ProductMetric | null {
  let best: ProductMetric | null = null;
  let bestP = Infinity;
  for (const m of measures) {
    const p = metricProgress(m);
    if (p !== null && p < bestP) {
      best = m;
      bestP = p;
    }
  }
  return best ?? measures[0] ?? null;
}

/* ── Forms ──────────────────────────────────────────────────────────── */

export interface ReviewDraft {
  date: string;
  focus: EbmValueArea | "";
  note: string;
}

export type ReviewField = keyof ReviewDraft;

export interface ReviewValues {
  date: string;
  focus: EbmValueArea;
  note?: string;
}

/** Check the review form: a real day, never after `latest`; the area to focus on; a note within its cap. */
export function validateReview(
  d: ReviewDraft,
  latest: string
): Validation<ReviewValues, ReviewField> {
  const errors: FormErrors<ReviewField> = {};
  const date = d.date.trim();
  if (!date) errors.date = "Pick the day of the review.";
  else if (!isDay(date)) errors.date = "Pick a date from the calendar.";
  else if (date > latest) errors.date = "A review can't be for a day after today.";
  if (!d.focus || !isArea(d.focus)) errors.focus = "Pick the area to focus on next.";
  const note = d.note.trim();
  if (note.length > REVIEW_NOTE_MAX) {
    errors.note = `The note can be at most ${REVIEW_NOTE_MAX} characters.`;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: { date, focus: d.focus as EbmValueArea, ...(note ? { note } : {}) },
  };
}

export interface StrategicDraft {
  goal: string;
  why: string;
}

/** Check the strategic goal: both within their caps; a why needs a goal. Blank clears it. */
export function validateStrategicGoal(
  d: StrategicDraft
): Validation<{ goal?: string; why?: string }, keyof StrategicDraft> {
  const errors: FormErrors<keyof StrategicDraft> = {};
  const goal = d.goal.replace(/\s+/g, " ").trim();
  const why = d.why.trim();
  if (goal.length > STRATEGIC_GOAL_MAX) {
    errors.goal = `The goal can be at most ${STRATEGIC_GOAL_MAX} characters.`;
  }
  if (why.length > STRATEGIC_WHY_MAX) {
    errors.why = `Why it matters can be at most ${STRATEGIC_WHY_MAX} characters.`;
  }
  if (why && !goal) errors.goal = "Write the goal this why is for.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, values: { ...(goal ? { goal } : {}), ...(why ? { why } : {}) } };
}

/** A review built from validated values and the areas' scores now. */
export function newReview(
  id: string,
  values: ReviewValues,
  byArea: Record<EbmValueArea, readonly ProductMetric[]>
): EbmReview {
  return {
    id,
    date: values.date,
    focus: values.focus,
    ...(values.note ? { note: values.note } : {}),
    areas: areaScores(byArea),
  };
}

/* ── Verdict ────────────────────────────────────────────────────────── */

/** Days since the last review, or null without one. */
export function daysSinceReview(board: EbmBoard | null, today: string): number | null {
  const last = board?.reviews?.[board.reviews.length - 1];
  return last ? daysBetween(last.date, today) : null;
}

/** The one-line verdict the page and Amr say. */
export function ebmVerdict(
  byArea: Record<EbmValueArea, readonly ProductMetric[]>,
  board: EbmBoard | null,
  today: string
): string {
  const scores = areaScores(byArea);
  const measured = EBM_VALUE_AREAS.filter((a) => scores[a] !== undefined);
  const count = EBM_VALUE_AREAS.reduce((n, a) => n + (byArea[a]?.length ?? 0), 0);
  if (count === 0) return "No measures yet: add one or two for each key value area.";
  const weakest = weakestArea(scores);
  const days = daysSinceReview(board, today);
  const review =
    days === null ? "No review yet." : `Last review ${days === 0 ? "today" : `${days} days ago`}.`;
  if (measured.length === 0) {
    return `${count} ${count === 1 ? "measure" : "measures"}, none with a reading and a target yet. ${review}`;
  }
  return `${measured.length} of 4 areas measured; ${AREA_LABEL[weakest as EbmValueArea]} is the weakest at ${scoreText(
    scores[weakest as EbmValueArea]
  )}. ${review}`;
}

/** Whether the EBM example is loaded: any `example-ebm-` measure or review. */
export function ebmExampleLoaded(
  metrics: readonly ProductMetric[] | undefined,
  board: EbmBoard | null
): boolean {
  return (
    (metrics ?? []).some((m) => isEbmExample(m?.id)) ||
    (board?.reviews ?? []).some((r) => isEbmExample(r.id))
  );
}
