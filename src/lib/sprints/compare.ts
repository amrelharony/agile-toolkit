/**
 * Sprint Comparison's six scores (1–10) for one sprint, read from the data
 * the other tools keep wherever it exists, so the radar shows what happened
 * rather than opinions typed after the fact. Pure, so the page, its
 * Markdown, the `tool.sprint_compare.list_state` agent action and the
 * cockpit's "Average rating" tile give the same numbers.
 *
 *   Predictability   1 + 9 × the say/do score (1 = delivered exactly what
 *                    was committed, either way off counts against it).
 *   Velocity         1 + 9 × completed ÷ the team's best finished sprint,
 *                    from MIN_SAMPLE.average finished sprints.
 *   Goal Achievement the Sprint Goal's "Did we meet the goal?": met 10,
 *                    partly 5.5, not met 1.
 *   Scope Stability  1 + 9 × (1 − churn), churn being the scope that joined
 *                    or left after day 0 as a share of the commitment
 *                    (lib/sprints/trends).
 *   Team Happiness   prefilled from Mood Tracker check-ins during the sprint
 *                    (1–5 mapped onto 1–10), from MIN_SAMPLE.average of them.
 *   Quality          prefilled from the Squad Health Check taken for the
 *                    sprint: the share of health over the code and release
 *                    dimensions (yellow counts half).
 *
 * Happiness and Quality are opinions the data only suggests, so a rating
 * typed in Sprint Comparison (`SprintSeries.ratings`) overrides their
 * prefill. The four computed scores can't be overridden: a rating stored
 * for one of them (typed before they were computed, or by an agent) is
 * shown only while the computation has no input, and is never deleted.
 */

import type {
  HealthCheck,
  HealthCheckEntry,
  HealthDimension,
  HealthDimensionScore,
  HealthTrafficLight,
  MoodEntry,
  Sprint,
  SprintGoal,
  SprintGoalOutcome,
  SprintSeries,
  Story,
} from "@/lib/stores/workspace-types";
import { HEALTH_CHECK_DIMENSIONS } from "@/lib/stores/workspace-types";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { addDays, dayOf, daysBetween } from "@/lib/impediments/model";
import { GOAL_OUTCOME_LABEL, goalDocId } from "./goal-doc";
import { SAY_DO_GRADE_LABEL, sayDoRatio, velocity } from "./metrics";
import {
  SPRINT_RATING_DIMENSIONS,
  hasSyntheticDates,
  seriesFor,
  type SprintRatingDimension,
} from "./series";
import { SCOPE_SOURCE_LABEL, sprintScope } from "./trends";

/** MUST match HC_ID in lib/actions/tools/health-check.ts: the one health-check document. */
export const HEALTH_CHECK_DOC_ID = "healthCheck:current";

/* ── Server-safe twins ────────────────────────────────────────────────
 *
 * lib/team/mood (moodDuring), lib/health-check/score (healthShare,
 * healthCheckFor) and lib/retro/board (retroSprintFor) read `isExampleId`
 * from components/tool-frame/example-data, a "use client" module. In the
 * MCP route handler its exports are client references that throw when
 * called, so tool.sprint_compare.list_state couldn't run them. Until that
 * helper moves to a server-safe module, these twins apply exactly the same
 * rules, and a test holds each equal to its original; then they go and the
 * originals are called here.
 */

const isExampleRow = (id: string | null | undefined) =>
  typeof id === "string" && id.startsWith("example-");

/** Twin of lib/team/mood moodDuring: check-ins dated `start`–`end`, placeholders and examples out. */
export function sprintMood(
  entries: readonly MoodEntry[] | undefined,
  start: string,
  end: string
): { average: number | null; checkIns: number; people: number } {
  const checkIns = (entries ?? []).filter((m) => {
    if (m.isPlaceholder || isExampleRow(m.id)) return false;
    const day = dayOf(m.date);
    return Boolean(day && day >= start && day <= end);
  });
  const average =
    checkIns.length >= MIN_SAMPLE.average
      ? Math.round((checkIns.reduce((sum, m) => sum + m.score, 0) / checkIns.length) * 10) / 10
      : null;
  return {
    average,
    checkIns: checkIns.length,
    people: new Set(checkIns.map((m) => m.memberId)).size,
  };
}

/** Twin of lib/health-check/score LIGHT_VALUE: yellow counts half. */
const LIGHT: Readonly<Record<HealthTrafficLight, number>> = { green: 1, yellow: 0.5, red: 0 };

/** Twin of lib/health-check/score QUALITY_DIMENSIONS: the code and how easily it ships. */
export const QUALITY_DIMENSIONS: readonly HealthDimension[] = [
  "Health of Codebase",
  "Easy to Release",
];

/** Twin of lib/health-check/score healthShare: the mean light value of the scored dims, 0–1. */
export function qualityShare(
  scores: Partial<Record<HealthDimension, HealthDimensionScore>> | undefined,
  dims: readonly HealthDimension[] = HEALTH_CHECK_DIMENSIONS
): number | null {
  let sum = 0;
  let n = 0;
  for (const d of dims) {
    const light = scores?.[d]?.light;
    if (light === undefined || !(light in LIGHT)) continue;
    sum += LIGHT[light];
    n++;
  }
  return n === 0 ? null : sum / n;
}

/** Twin of lib/retro/board retroSprintFor: the sprint whose retro window holds `day`, nearest end. */
function retroSprint(day: string, sprints: readonly Sprint[]): Sprint | undefined {
  let best: { sprint: Sprint; distance: number; ended: boolean } | null = null;
  for (const s of sprints) {
    if (s.status === "cancelled" || isExampleRow(s.id) || hasSyntheticDates(s)) continue;
    const start = dayOf(s.startDate);
    const end = dayOf(s.endDate);
    if (!start || !end || day < start || day > addDays(end, 7)) continue;
    const distance = Math.abs(daysBetween(end, day));
    const ended = end <= day;
    if (!best || distance < best.distance || (distance === best.distance && ended && !best.ended)) {
      best = { sprint: s, distance, ended };
    }
  }
  return best?.sprint;
}

const nameKey = (name: string | undefined) => (name ?? "").trim().toLowerCase();

/**
 * Twin of lib/health-check/score healthCheckFor: the saved check (never the
 * draft, no examples) named like the sprint, else one taken in its retro
 * window; the newest if several match.
 */
export function sprintHealthCheck(
  doc: HealthCheck | undefined,
  sprint: Pick<Sprint, "id" | "name">,
  sprints: readonly Sprint[]
): HealthCheckEntry | undefined {
  const checks = (doc?.history ?? []).filter((e) => !isExampleRow(e.id));
  const newest = (xs: HealthCheckEntry[]) =>
    xs.reduce<HealthCheckEntry | undefined>(
      (best, e) => (!best || (e.date ?? "") >= (best.date ?? "") ? e : best),
      undefined
    );
  const key = nameKey(sprint.name);
  const named = key ? checks.filter((e) => nameKey(e.sprintName) === key) : [];
  if (named.length > 0) return newest(named);
  return newest(
    checks.filter((e) => e.date && retroSprint(e.date.slice(0, 10), sprints)?.id === sprint.id)
  );
}

/** Lowest and highest score. */
export const MIN_SCORE = 1;
export const MAX_SCORE = 10;

/**
 *   computed  from the sprint's own data; read-only.
 *   prefilled from another tool's data, until someone types a rating.
 *   typed     a rating stored in Sprint Comparison.
 *   none      not scored: nothing to compute it from and nothing typed.
 */
export type ScoreSource = "computed" | "prefilled" | "typed" | "none";

/** What a score is missing, so a page can link to where it is fixed. */
export type ScoreGap =
  | "points"
  | "commitment"
  | "history"
  | "goal"
  | "scope"
  | "mood"
  | "health"
  | "dates";

export interface DimensionScore {
  /** 1–10, one decimal; null = not scored. */
  value: number | null;
  source: ScoreSource;
  /** The tool the value was read from ("Velocity", "Mood Tracker"); absent when typed or none. */
  from?: string;
  /** How it was worked out: "29 of 34 committed points (85%, close to the commitment)". */
  basis: string;
  /** Typing a rating sets it (Team Happiness, Quality). */
  editable: boolean;
  /** The rating stored for this dimension, if any (shown and kept even when not used). */
  typed?: number;
  /** Why the computation had no input, when it hadn't. */
  missing?: ScoreGap;
}

export type SprintScores = Record<SprintRatingDimension, DimensionScore>;

/** The dimensions a typed rating sets; the rest are computed. */
export const EDITABLE_DIMENSIONS: readonly SprintRatingDimension[] = ["Team Happiness", "Quality"];

export function isEditableDimension(dim: string): dim is SprintRatingDimension {
  return (EDITABLE_DIMENSIONS as readonly string[]).includes(dim);
}

export interface CompareInput {
  sprint: Sprint;
  /** Every sprint, for the team's best velocity and the health check's retro window. */
  sprints: readonly Sprint[];
  stories: readonly Story[];
  series?: readonly SprintSeries[];
  goals?: readonly SprintGoal[];
  moodEntries?: readonly MoodEntry[];
  healthChecks?: readonly HealthCheck[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const fmt = (n: number) => String(round1(n));
const points = (n: number) => `${fmt(n)} ${Math.abs(n) === 1 ? "point" : "points"}`;

/** A 0–1 share onto the 1–10 scale, to one decimal. */
export function shareToScore(share: number): number {
  const s = Math.max(0, Math.min(1, share));
  return round1(MIN_SCORE + (MAX_SCORE - MIN_SCORE) * s);
}

/** A 1–5 mood average onto the 1–10 scale, to one decimal. */
export function moodToScore(average: number): number {
  return shareToScore((average - 1) / 4);
}

/** A typed rating as stored, if it is a usable 1–10 number. */
function typedRating(ratings: Record<string, number> | undefined, dim: string): number | undefined {
  const v = ratings?.[dim];
  return typeof v === "number" && Number.isFinite(v) && v >= MIN_SCORE && v <= MAX_SCORE
    ? v
    : undefined;
}

/** The goal outcome onto the 1–10 scale: met 10, partly half-way, not met 1. */
export const GOAL_OUTCOME_SCORE: Record<SprintGoalOutcome["met"], number> = {
  met: 10,
  partly: 5.5,
  "not-met": 1,
};

/**
 * A computed score, or (when it had no input) the rating stored for it,
 * shown as typed earlier, or not scored.
 */
function computedOr(
  value: { value: number; from: string; basis: string } | { missing: ScoreGap; basis: string },
  typed: number | undefined
): DimensionScore {
  if ("value" in value) {
    return {
      value: value.value,
      source: "computed",
      from: value.from,
      basis: value.basis,
      editable: false,
      ...(typed !== undefined ? { typed } : {}),
    };
  }
  if (typed !== undefined) {
    return {
      value: typed,
      source: "typed",
      basis: `Typed earlier. ${value.basis}`,
      editable: false,
      typed,
      missing: value.missing,
    };
  }
  return {
    value: null,
    source: "none",
    basis: value.basis,
    editable: false,
    missing: value.missing,
  };
}

/** A prefilled score that a typed rating overrides. */
function prefilledOr(
  value: { value: number; from: string; basis: string } | { missing: ScoreGap; basis: string },
  typed: number | undefined
): DimensionScore {
  if (typed !== undefined) {
    return {
      value: typed,
      source: "typed",
      basis:
        "value" in value
          ? `The team's rating; ${value.from} suggested ${fmt(value.value)} (${value.basis})`
          : `The team's rating. ${value.basis}`,
      editable: true,
      typed,
    };
  }
  if ("value" in value) {
    return {
      value: value.value,
      source: "prefilled",
      from: value.from,
      basis: value.basis,
      editable: true,
    };
  }
  return {
    value: null,
    source: "none",
    basis: value.basis,
    editable: true,
    missing: value.missing,
  };
}

const isFinishedSprint = (s: Sprint) =>
  s.status === "completed" &&
  typeof s.pointsCompleted === "number" &&
  Number.isFinite(s.pointsCompleted);

function predictabilityScore(sprint: Sprint) {
  if (!isFinishedSprint(sprint)) {
    return { missing: "points" as const, basis: "Close the sprint with its completed points." };
  }
  const sd = sayDoRatio(sprint.pointsPlanned, sprint.pointsCompleted);
  if (!sd) {
    return {
      missing: "commitment" as const,
      basis: "No points were committed, so there's no say/do.",
    };
  }
  return {
    value: shareToScore(sd.score),
    from: "Velocity",
    basis: `${fmt(sprint.pointsCompleted as number)} of ${points(sprint.pointsPlanned)} committed (${sd.pct}%, ${SAY_DO_GRADE_LABEL[sd.grade].toLowerCase()})`,
  };
}

function velocityScore(sprint: Sprint, sprints: readonly Sprint[]) {
  if (!isFinishedSprint(sprint)) {
    return { missing: "points" as const, basis: "Close the sprint with its completed points." };
  }
  const all = velocity([...sprints.filter((s) => s.id !== sprint.id), sprint], {
    window: Number.POSITIVE_INFINITY,
  });
  if (all.count < MIN_SAMPLE.average) {
    const more = MIN_SAMPLE.average - all.count;
    return {
      missing: "history" as const,
      basis: `Compared with the team's best sprint once there are ${MIN_SAMPLE.average} finished sprints (${more} more to go).`,
    };
  }
  const best = Math.max(...all.points);
  if (!(best > 0)) {
    return {
      missing: "points" as const,
      basis: "No finished sprint has completed points above 0 yet.",
    };
  }
  const done = sprint.pointsCompleted as number;
  return {
    value: shareToScore(done / best),
    from: "Velocity",
    basis:
      done >= best
        ? `${points(done)}: the team's best of ${all.count} finished sprints`
        : `${points(done)} against the team's best of ${points(best)} (${all.count} finished sprints)`,
  };
}

function goalScore(sprint: Sprint, goals: readonly SprintGoal[] | undefined) {
  const doc = goals?.find((g) => g.id === goalDocId(sprint.id));
  const outcome = doc?.outcome;
  if (!outcome || !(outcome.met in GOAL_OUTCOME_SCORE)) {
    return {
      missing: "goal" as const,
      basis: doc?.goal?.trim()
        ? "No answer to “Did we meet the goal?” yet."
        : "No sprint goal recorded for this sprint.",
    };
  }
  return {
    value: GOAL_OUTCOME_SCORE[outcome.met],
    from: "Sprint Goal",
    basis: `Goal ${GOAL_OUTCOME_LABEL[outcome.met].toLowerCase()}${doc?.goal?.trim() ? `: “${doc.goal.trim()}”` : ""}`,
  };
}

function scopeScore(
  sprint: Sprint,
  stories: readonly Story[],
  series: readonly SprintSeries[] | undefined
) {
  if (!(sprint.pointsPlanned > 0)) {
    return {
      missing: "commitment" as const,
      basis: "No points were committed to measure the change against.",
    };
  }
  const scope = sprintScope(sprint, stories, seriesFor(series, sprint.id));
  if (scope.source === "none" || scope.churnPct === null) {
    return {
      missing: "scope" as const,
      basis: "No record of scope changing: the stories' moves or Burnup's scope log would show it.",
    };
  }
  const churn = scope.churnPct / 100;
  return {
    value: shareToScore(1 - churn),
    from: scope.source === "history" ? "Sprint board" : "Burnup",
    basis: `+${fmt(scope.added)} / −${fmt(scope.removed)} points against ${points(sprint.pointsPlanned)} committed (${scope.churnPct}% churn), ${SCOPE_SOURCE_LABEL[scope.source]}`,
  };
}

function happinessScore(sprint: Sprint, moodEntries: readonly MoodEntry[] | undefined) {
  if (hasSyntheticDates(sprint)) {
    return {
      missing: "dates" as const,
      basis: "The sprint has no real dates to match check-ins to.",
    };
  }
  const mood = sprintMood(moodEntries, sprint.startDate.slice(0, 10), sprint.endDate.slice(0, 10));
  if (mood.average === null) {
    return {
      missing: "mood" as const,
      basis:
        mood.checkIns === 0
          ? "No Mood Tracker check-ins during the sprint."
          : `Only ${mood.checkIns} Mood Tracker check-in${mood.checkIns === 1 ? "" : "s"} during the sprint (needs ${MIN_SAMPLE.average}).`,
    };
  }
  return {
    value: moodToScore(mood.average),
    from: "Mood Tracker",
    basis: `${fmt(mood.average)}/5 from ${mood.checkIns} check-ins by ${mood.people} ${mood.people === 1 ? "person" : "people"}`,
  };
}

/** "12 Oct" for a YYYY-MM-DD date. */
function shortDate(iso: string | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return "";
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

function qualityScore(
  sprint: Sprint,
  sprints: readonly Sprint[],
  healthChecks: readonly HealthCheck[] | undefined
) {
  const doc = healthChecks?.find((d) => d.id === HEALTH_CHECK_DOC_ID) ?? healthChecks?.[0];
  const entry = sprintHealthCheck(doc, sprint, sprints);
  const share = entry ? qualityShare(entry.scores, QUALITY_DIMENSIONS) : null;
  if (!entry || share === null) {
    return { missing: "health" as const, basis: "No Squad Health Check saved for this sprint." };
  }
  const lights = QUALITY_DIMENSIONS.flatMap((d) =>
    entry.scores?.[d]?.light ? [`${d} ${entry.scores[d].light}`] : []
  ).join(", ");
  const when = [entry.sprintName?.trim(), shortDate(entry.date)].filter(Boolean).join(", ");
  return {
    value: shareToScore(share),
    from: "Squad Health Check",
    basis: `${when ? `${when}: ` : ""}${lights}`,
  };
}

/** The six scores for one sprint (see the file comment for each). */
export function sprintScores(input: CompareInput): SprintScores {
  const { sprint, sprints, stories, series, goals, moodEntries, healthChecks } = input;
  const ratings = seriesFor(series, sprint.id).ratings;
  const typed = (dim: SprintRatingDimension) => typedRating(ratings, dim);
  return {
    Velocity: computedOr(velocityScore(sprint, sprints), typed("Velocity")),
    Quality: prefilledOr(qualityScore(sprint, sprints, healthChecks), typed("Quality")),
    "Scope Stability": computedOr(scopeScore(sprint, stories, series), typed("Scope Stability")),
    "Team Happiness": prefilledOr(happinessScore(sprint, moodEntries), typed("Team Happiness")),
    "Goal Achievement": computedOr(goalScore(sprint, goals), typed("Goal Achievement")),
    Predictability: computedOr(predictabilityScore(sprint), typed("Predictability")),
  };
}

/** Mean of the scored dimensions to one decimal; null when none is scored. */
export function averageScore(scores: SprintScores): number | null {
  const values = SPRINT_RATING_DIMENSIONS.map((d) => scores[d]?.value).filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v)
  );
  if (values.length === 0) return null;
  return round1(values.reduce((a, b) => a + b, 0) / values.length);
}

/** How many of the six have a score. */
export function scoredCount(scores: SprintScores): number {
  return SPRINT_RATING_DIMENSIONS.filter((d) => scores[d]?.value !== null).length;
}

/** "From Velocity", "Rated by the team", "Typed earlier" or "Not scored": the chip on a score. */
export function sourceLabel(score: DimensionScore): string {
  switch (score.source) {
    case "computed":
    case "prefilled":
      return `From ${score.from}`;
    case "typed":
      return score.editable ? "Rated by the team" : "Typed earlier";
    case "none":
      return "Not scored";
  }
}
