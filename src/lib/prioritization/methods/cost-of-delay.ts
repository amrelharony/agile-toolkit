/**
 * Cost of Delay, scored as CD3 (Reinertsen): cost of delay per week ÷
 * duration in weeks. The urgency profile sets the lane the item is
 * ordered in:
 *
 *   1. expedite: do it now, whatever its CD3;
 *   2. fixed date: by latest start (the date it must land by, less its
 *      duration), earliest first;
 *   3. standard: by CD3, highest first;
 *   4. intangible: by CD3, after the rest.
 *
 * The duration floor is half a week: forms refuse less, a legacy smaller
 * value counts as 0.5 and says so. Rows from before CD3 hold a per-week
 * cost and the weeks delayed (`weeksDelayed`, `totalCost`) with no
 * duration: they read as "Not scored: add a duration", and the old total
 * stays on the row for reference. A row with a cost and a duration but no
 * profile yet has a CD3 and no lane (ordered after the standard lane).
 */

import { isoDayNumber, isoFromDayNumber } from "@/lib/sprints/calendar";
import {
  formatNumber,
  inputErrors,
  notScored,
  put,
  toChoice,
  toDay,
  toNumber,
  toValidation,
} from "./fields";
import type {
  BucketDef,
  MethodInput,
  MethodScore,
  PrioritizationMethod,
  RowFields,
  Values,
} from "./types";

export const COD_URGENCIES = ["expedite", "fixed_date", "standard", "intangible"] as const;
export type CodUrgency = (typeof COD_URGENCIES)[number];

export const COD_URGENCY_LABEL: Record<CodUrgency, string> = {
  expedite: "Expedite",
  fixed_date: "Fixed date",
  standard: "Standard",
  intangible: "Intangible",
};

export const COD_URGENCY_MEANING: Record<CodUrgency, string> = {
  expedite: "The cost is huge and immediate: drop other work and do it now.",
  fixed_date: "The cost jumps on a date (a launch, a regulation): start in time to land by it.",
  standard: "The cost grows steadily with every week it waits.",
  intangible: "Little cost now, more later (tech debt, a platform change).",
};

/** The smallest duration a CD3 divides by, in weeks. */
export const COD_DURATION_MIN = 0.5;

/** Lane order: expedite first; a row without a profile goes after the standard lane. */
const LANE_ORDER: Record<CodUrgency | "none", number> = {
  expedite: 0,
  fixed_date: 1,
  standard: 2,
  none: 3,
  intangible: 4,
};

const BUCKETS: readonly BucketDef[] = COD_URGENCIES.map((id, order) => ({
  id,
  label: COD_URGENCY_LABEL[id],
  meaning: COD_URGENCY_MEANING[id],
  order,
  tone:
    id === "expedite"
      ? "danger"
      : id === "fixed_date"
        ? "warning"
        : id === "standard"
          ? "accent"
          : "muted",
}));

const INPUTS: readonly MethodInput[] = [
  {
    key: "perWeekUsd",
    kind: "number",
    label: "Cost of delay per week ($)",
    hint: "What a week of waiting costs: revenue lost, cost incurred or value missed.",
    missing: "Enter the cost of delay per week.",
    min: 0,
    unit: "$ per week",
  },
  {
    key: "durationWeeks",
    kind: "number",
    label: "Duration (weeks of work)",
    hint: "How long it takes to deliver, half a week at least.",
    missing: "Enter the duration.",
    min: COD_DURATION_MIN,
    step: 0.5,
    unit: "weeks",
  },
  {
    key: "urgency",
    kind: "choice",
    label: "Urgency profile",
    hint: "How the cost of waiting behaves over time.",
    missing: "Pick an urgency profile.",
    options: COD_URGENCIES.map((id) => ({
      id,
      label: COD_URGENCY_LABEL[id],
      meaning: COD_URGENCY_MEANING[id],
    })),
  },
  {
    key: "fixedDate",
    kind: "date",
    label: "Date it must land by",
    hint: "For a fixed date: the day the cost jumps.",
    missing: "Enter the date it must land by.",
    optional: true,
  },
];

/** CD3 of a cost per week and a duration, the duration at least half a week. */
export function cd3(perWeekUsd: number, durationWeeks: number): number {
  return Math.max(0, perWeekUsd) / Math.max(COD_DURATION_MIN, durationWeeks);
}

/**
 * The latest day work can start and still land by `fixedDate`: the date
 * less the duration, in whole days (a partial day counts). Null without both.
 */
export function latestStart(
  fixedDate: string | undefined,
  durationWeeks: number | undefined
): string | null {
  const day = isoDayNumber(toDay(fixedDate) ?? null);
  if (day === null || durationWeeks === undefined || !Number.isFinite(durationWeeks)) return null;
  return isoFromDayNumber(day - Math.ceil(Math.max(0, durationWeeks) * 7));
}

function read(fields: Values | undefined): Values {
  return {
    perWeekUsd: toNumber(fields?.perWeekUsd),
    durationWeeks: toNumber(fields?.durationWeeks),
    urgency: toChoice(COD_URGENCIES, fields?.urgency),
    fixedDate: toDay(fields?.fixedDate),
    // Read-only legacy: weeks delayed, for the old total shown as a note.
    weeksDelayed: toNumber(fields?.weeksDelayed),
  };
}

function write(fields: RowFields | undefined, v: Values): RowFields {
  // totalCost stays as it is, for reference; so does weeksDelayed (or the
  // one an agent from before CD3 still sends), never part of the score.
  const out: RowFields = { ...fields };
  put(out, "weeksDelayed", toNumber(v.weeksDelayed) ?? toNumber(fields?.weeksDelayed));
  put(out, "perWeekUsd", toNumber(v.perWeekUsd));
  put(out, "durationWeeks", toNumber(v.durationWeeks));
  const urgency = toChoice(COD_URGENCIES, v.urgency);
  put(out, "urgency", urgency);
  put(out, "fixedDate", urgency === "fixed_date" ? toDay(v.fixedDate) : undefined);
  return out;
}

const laneOf = (s: MethodScore): number =>
  LANE_ORDER[(toChoice(COD_URGENCIES, s.bucket) ?? "none") as CodUrgency | "none"];

export const COST_OF_DELAY: PrioritizationMethod = {
  id: "cost-of-delay",
  toolId: "cost-of-delay",
  label: "Cost of Delay",
  embedded: false,
  inputs: INPUTS,
  buckets: BUCKETS,
  read,
  write,
  validate(draft) {
    const errors = inputErrors(INPUTS, draft);
    if (toChoice(COD_URGENCIES, draft.urgency) === "fixed_date" && !errors.fixedDate) {
      if (toDay(draft.fixedDate) === undefined)
        errors.fixedDate = "Enter the date it must land by.";
    }
    const duration = toNumber(draft.durationWeeks);
    if (!errors.durationWeeks && duration !== undefined && duration < COD_DURATION_MIN) {
      errors.durationWeeks = "Duration is at least half a week.";
    }
    const values = { ...draft };
    if (toChoice(COD_URGENCIES, draft.urgency) !== "fixed_date") delete values.fixedDate;
    return toValidation(values, errors);
  },
  evaluate(v) {
    const r = read(v);
    const perWeek = r.perWeekUsd as number | undefined;
    const duration = r.durationWeeks as number | undefined;
    const weeksDelayed = r.weeksDelayed as number | undefined;
    const urgency = (r.urgency as CodUrgency | undefined) ?? null;
    const legacyTotal =
      perWeek !== undefined && weeksDelayed !== undefined
        ? Math.max(0, perWeek) * Math.max(0, weeksDelayed)
        : null;
    const missing: string[] = [];
    if (perWeek === undefined) missing.push("perWeekUsd");
    if (duration === undefined || duration <= 0) missing.push("durationWeeks");
    if (missing.length > 0) {
      return { ...notScored(missing), bucket: urgency, extra: { totalCost: legacyTotal } };
    }
    const score = cd3(perWeek as number, duration as number);
    const warnings: string[] = [];
    if ((duration as number) < COD_DURATION_MIN) {
      warnings.push(`Duration ${duration} is below half a week and counts as 0.5. Edit it.`);
    }
    if (!urgency) warnings.push("No urgency profile yet: pick one to place it in a lane.");
    const start =
      urgency === "fixed_date" ? latestStart(r.fixedDate as string | undefined, duration) : null;
    return {
      score,
      bucket: urgency,
      sortKey: score,
      missing: [],
      warnings,
      extra: {
        latestStart: start,
        totalCost: legacyTotal,
        lane: laneOf({ bucket: urgency } as MethodScore),
      },
    };
  },
  /** Lanes in order; a fixed date by latest start (undated last), the rest by CD3. */
  compare(a, b) {
    const lane = laneOf(a) - laneOf(b);
    if (lane !== 0) return lane;
    if (a.bucket === "fixed_date") {
      const as = typeof a.extra?.latestStart === "string" ? a.extra.latestStart : null;
      const bs = typeof b.extra?.latestStart === "string" ? b.extra.latestStart : null;
      if (as !== bs) {
        if (as === null) return 1;
        if (bs === null) return -1;
        return as < bs ? -1 : 1;
      }
    }
    return (b.sortKey ?? 0) - (a.sortKey ?? 0);
  },
  format: (score) => formatNumber(score, 2),
};
