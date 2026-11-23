/**
 * Product Metrics: the numbers a product lives by, as `ProductMetric` rows
 * (the workspace entity the EBM Dashboard shares). One reading for the
 * page, its Markdown, Amr's verbs (`tool.product_metrics.*`), the EBM
 * Dashboard and the next steps.
 *
 * A metric can sit in several views at once: the North Star or one of its
 * inputs (`role`), a HEART goal for one feature (`heart`), an AARRR stage
 * (`aarrr`) and an EBM key value area (`kva`), with one set of readings.
 *
 * The rules each view keeps (one North Star, at most five inputs, one
 * metric per funnel stage, one per HEART feature and category, at most 60
 * metrics) are `metricRuleProblems`, which the page and Amr's verbs check
 * before every write; the CRUD's `beforeWrite` holds the same rules. Each
 * rule counts the team's own rows apart from the example's, so loading an
 * example over a real North Star is never refused.
 *
 * Pure; server-safe (the MCP route calls it): no "use client" module,
 * React or store anywhere below it.
 */

import {
  AARRR_STAGES,
  HEART_CATEGORIES,
  KR_CHECK_IN_CAP,
  TOOL_LIST_MAX,
  TOOL_TEXT_MAX,
  type AarrrStage,
  type HeartCategory,
  type MetricDirection,
  type MetricReading,
  type MetricRole,
  type ProductMetric,
} from "@/lib/stores/workspace-types";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { mannKendall } from "@/lib/analytics/trend-test";
import { krProgress } from "@/lib/okrs/progress";
import { HYPOTHESIS_UNIT_MAX, formatMetric, isDay } from "@/lib/hypotheses/model";
import { isoDayNumber } from "@/lib/sprints/calendar";
import { isExampleId } from "@/lib/utils/example-id";
import { parseNumber, type FormErrors, type Validation } from "@/lib/utils/form";

/* ── Ids and examples ───────────────────────────────────────────────── */

/** Product Metrics' example rows: `exampleId("pm-…")`. */
export const METRICS_EXAMPLE_PREFIX = "example-pm-";
/** The EBM Dashboard's example rows: `exampleId("ebm-…")`. */
export const EBM_EXAMPLE_PREFIX = "example-ebm-";

export const isMetricsExample = (id: string | null | undefined): boolean =>
  typeof id === "string" && id.startsWith(METRICS_EXAMPLE_PREFIX);
export const isEbmExample = (id: string | null | undefined): boolean =>
  typeof id === "string" && id.startsWith(EBM_EXAMPLE_PREFIX);

/** The id prefix of a metric the page or Amr creates (the CRUD's own). */
export const METRIC_ID_PREFIX = "metric_";
/** The id prefix of a reading. */
export const READING_ID_PREFIX = "reading_";

/* ── Caps and words ─────────────────────────────────────────────────── */

export const METRIC_NAME_MAX = TOOL_TEXT_MAX.short;
export const METRIC_DEFINITION_MAX = TOOL_TEXT_MAX.text;
export const METRIC_UNIT_MAX = HYPOTHESIS_UNIT_MAX;
export const METRIC_OWNER_MAX = TOOL_TEXT_MAX.short;
export const HEART_TEXT_MAX = TOOL_TEXT_MAX.short;
export const READING_NOTE_MAX = TOOL_TEXT_MAX.short;
/** Readings kept per metric (a year of weekly ones); the oldest go first. */
export const READINGS_MAX = KR_CHECK_IN_CAP;
/** Lines one paste takes. */
export const PASTE_LINES_MAX = KR_CHECK_IN_CAP;
/** Days without a reading before a North Star or input asks for one. */
export const METRIC_STALE_DAYS = 30;

export const DIRECTION_LABEL: Record<MetricDirection, string> = {
  increase: "Higher is better",
  decrease: "Lower is better",
};

export const ROLE_LABEL: Record<MetricRole, string> = {
  "north-star": "North Star",
  input: "Input",
};

export const HEART_LABEL: Record<HeartCategory, string> = {
  happiness: "Happiness",
  engagement: "Engagement",
  adoption: "Adoption",
  retention: "Retention",
  "task-success": "Task success",
};

/** What each HEART category asks, in our own words. */
export const HEART_MEANING: Record<HeartCategory, string> = {
  happiness: "How people feel about it.",
  engagement: "How often or how deeply they use it.",
  adoption: "New people starting to use it.",
  retention: "People who keep using it.",
  "task-success": "Getting the job done quickly and without errors.",
};

export const AARRR_LABEL: Record<AarrrStage, string> = {
  acquisition: "Acquisition",
  activation: "Activation",
  retention: "Retention",
  referral: "Referral",
  revenue: "Revenue",
};

/** What each funnel stage counts, in our own words. */
export const AARRR_MEANING: Record<AarrrStage, string> = {
  acquisition: "People who arrive.",
  activation: "People who have a first good experience.",
  retention: "People who come back.",
  referral: "People who bring others.",
  revenue: "People who pay.",
};

/** The North Star check list, in our own words: hints for a talk, not a score. */
export const NORTH_STAR_CHECKS: readonly string[] = [
  "It counts value people get, not only money.",
  "It moves before revenue does.",
  "The team's work can move it.",
  "Each input is something a team can change this quarter.",
];

/* ── Reading a stored row ───────────────────────────────────────────── */

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** The readings oldest first, one per day (the later one on a day wins), each a real day. */
export function sortedReadings(m: Pick<ProductMetric, "readings">): MetricReading[] {
  const raw = Array.isArray(m.readings) ? m.readings : [];
  const byDay = new Map<string, MetricReading>();
  for (const r of raw) {
    if (!r || typeof r !== "object" || !isDay(r.date) || !finite(r.value)) continue;
    byDay.set(r.date, r);
  }
  return Array.from(byDay.values()).sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0
  );
}

export function latestReading(m: Pick<ProductMetric, "readings">): MetricReading | null {
  const rs = sortedReadings(m);
  return rs[rs.length - 1] ?? null;
}

export function previousReading(m: Pick<ProductMetric, "readings">): MetricReading | null {
  const rs = sortedReadings(m);
  return rs.length >= 2 ? rs[rs.length - 2] : null;
}

/** The reading on `date`, or null. */
export function readingOn(m: Pick<ProductMetric, "readings">, date: string): MetricReading | null {
  return sortedReadings(m).find((r) => r.date === date) ?? null;
}

const tidy = (n: number) => Math.round(n * 100) / 100;

export interface MetricChange {
  /** latest − the reading before. */
  delta: number;
  /** Whether it moved the right way; null when it didn't move. */
  better: boolean | null;
}

/** The change since the reading before, read in the metric's own direction; null with under 2. */
export function metricChange(
  m: Pick<ProductMetric, "readings" | "direction">
): MetricChange | null {
  const latest = latestReading(m);
  const before = previousReading(m);
  if (!latest || !before) return null;
  const delta = tidy(latest.value - before.value);
  const better = delta === 0 ? null : m.direction === "decrease" ? delta < 0 : delta > 0;
  return { delta, better };
}

/** "up 3", "down 0.5", "no change" (no unit), or "" with under 2 readings. */
export function changeText(m: Pick<ProductMetric, "readings" | "direction" | "unit">): string {
  const c = metricChange(m);
  if (!c) return "";
  if (c.delta === 0) return "no change";
  return `${c.delta > 0 ? "up" : "down"} ${formatMetric(Math.abs(c.delta), m.unit)}`;
}

/**
 * Progress to the target, 0..1, or null when it can't be measured: no
 * finite target or no reading ("not measured", never 0). The baseline is
 * the metric's own, else its first reading. A baseline already at or past
 * the target (in the metric's direction) reads 1 while the latest reading
 * is on the target's right side, else 0; otherwise it is the OKRs' own
 * `krProgress` from the baseline to the target.
 */
export function metricProgress(
  m: Pick<ProductMetric, "readings" | "direction" | "baseline" | "target">
): number | null {
  if (!finite(m.target)) return null;
  const rs = sortedReadings(m);
  const latest = rs[rs.length - 1];
  if (!latest) return null;
  const baseline = finite(m.baseline) ? m.baseline : rs[0].value;
  const target = m.target;
  const down = m.direction === "decrease";
  const onSide = down ? latest.value <= target : latest.value >= target;
  const pastAlready = down ? baseline <= target : baseline >= target;
  if (pastAlready) return onSide ? 1 : 0;
  return krProgress({ current: latest.value, target, baseline, direction: m.direction });
}

/** "42%", or "not measured". */
export function progressText(p: number | null): string {
  return p === null ? "not measured" : `${Math.round(p * 100)}%`;
}

export type TrendWord = "rising" | "falling" | "flat";

export interface MetricTrend {
  /** The readings counted. */
  n: number;
  /** Readings still needed before a trend is read (MIN_SAMPLE.trend). */
  need: number;
  /** null below MIN_SAMPLE.trend readings. */
  word: TrendWord | null;
  /** Whether the trend goes the metric's way; null when flat or not read. */
  better: boolean | null;
}

/**
 * The direction of travel, from MIN_SAMPLE.trend (6) readings: the
 * Mann-Kendall test's direction when its p-value is under 0.05, else flat.
 * Below 10 readings the test calls nothing "significant" itself, so this
 * is a hint, as its own doc allows.
 */
export function metricTrend(m: Pick<ProductMetric, "readings" | "direction">): MetricTrend {
  const values = sortedReadings(m).map((r) => r.value);
  const n = values.length;
  const need = Math.max(0, MIN_SAMPLE.trend - n);
  if (need > 0) return { n, need, word: null, better: null };
  const mk = mannKendall(values);
  const word: TrendWord =
    mk.pValue < 0.05 && mk.z !== 0 ? (mk.z > 0 ? "rising" : "falling") : "flat";
  const better = word === "flat" ? null : (word === "rising") === (m.direction !== "decrease");
  return { n, need: 0, word, better };
}

/** "Rising over 8 readings.", "Add 3 more readings to see a trend." */
export function trendText(t: MetricTrend): string {
  if (t.word === null) {
    return `Add ${t.need} more ${t.need === 1 ? "reading" : "readings"} to see a trend.`;
  }
  if (t.word === "flat") return `No clear trend over ${t.n} readings.`;
  return `${t.word === "rising" ? "Rising" : "Falling"} over ${t.n} readings${
    t.better === false ? ", the wrong way" : ""
  }.`;
}

/** A metric's latest value with its unit, or "no reading yet". */
export function latestText(m: Pick<ProductMetric, "readings" | "unit">): string {
  const r = latestReading(m);
  return r ? formatMetric(r.value, m.unit) : "no reading yet";
}

/** Whole days from `from` to `to` (YYYY-MM-DD), or null. */
export function daysBetween(from: string, to: string): number | null {
  const a = isoDayNumber(from);
  const b = isoDayNumber(to);
  return a === null || b === null ? null : b - a;
}

/** No reading in METRIC_STALE_DAYS days up to `today` (or none at all). */
export function isStale(m: Pick<ProductMetric, "readings">, today: string): boolean {
  const r = latestReading(m);
  if (!r) return true;
  const days = daysBetween(r.date, today);
  return days === null || days >= METRIC_STALE_DAYS;
}

/* ── Writes ─────────────────────────────────────────────────────────── */

/**
 * `m` with `reading` added: one per day (a second on the same day replaces
 * the first), the newest READINGS_MAX kept. `kept` is false when the new
 * reading is older than every one kept, so it was dropped at once: the
 * page and Amr then save nothing and say why (READING_TOO_OLD).
 */
export function withReading(
  m: ProductMetric,
  reading: MetricReading,
  now: string
): { metric: ProductMetric; replaced: boolean; kept: boolean } {
  const before = sortedReadings(m);
  const replaced = before.some((r) => r.date === reading.date);
  const readings = [...before.filter((r) => r.date !== reading.date), reading]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .slice(-READINGS_MAX);
  const kept = readings.some((r) => r.id === reading.id);
  return { metric: { ...m, readings, updatedAt: now }, replaced, kept };
}

/** `m` with each of `readings` added in turn, and how many of them the newest READINGS_MAX hold. */
export function withReadings(
  m: ProductMetric,
  readings: readonly MetricReading[],
  now: string
): { metric: ProductMetric; kept: number; left: number } {
  const metric = readings.reduce((acc, r) => withReading(acc, r, now).metric, m);
  const ids = new Set(metric.readings.map((r) => r.id));
  const kept = readings.filter((r) => ids.has(r.id)).length;
  return { metric, kept, left: readings.length - kept };
}

/** Why a reading older than every one kept isn't saved. */
export const READING_TOO_OLD = `Only the newest ${READINGS_MAX} readings are kept, and this one is older than all of them. Nothing was saved.`;

/** What a paste says when some of its readings were older than every one kept. */
export function readingsLeftOutText(left: number): string {
  return `${left} ${left === 1 ? "reading was" : "readings were"} older than the newest ${READINGS_MAX} kept, so ${
    left === 1 ? "it was" : "they were"
  } left out.`;
}

/** `m` without the reading `readingId`. */
export function withoutReading(m: ProductMetric, readingId: string, now: string): ProductMetric {
  return { ...m, readings: sortedReadings(m).filter((r) => r.id !== readingId), updatedAt: now };
}

/** The same row with every field `undefined` left out (so a stored row never holds one). */
export function compactMetric(m: ProductMetric): ProductMetric {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(m)) if (v !== undefined) out[k] = v;
  return out as unknown as ProductMetric;
}

/** Which rule a write breaks: a view's (`role`, `aarrr`, `heart`) or the tool's cap (`cap`). */
export type MetricRuleErrors = Partial<Record<"role" | "aarrr" | "heart" | "cap", string>>;

/**
 * What stops `next` being saved beside `all` (the stored rows; `next`'s
 * own stored row, by id, is left out), one plain sentence per rule broken;
 * {} when it can be. The same rules as the CRUD's `beforeWrite`: one North
 * Star, at most TOOL_LIST_MAX.northStarInputs inputs, one metric per
 * funnel stage, one per HEART feature and category (the feature trimmed,
 * any case), and at most TOOL_LIST_MAX.productMetrics metrics, each
 * counted among rows of the same kind (the team's own apart from the
 * example's).
 */
export function metricRuleErrors(
  next: Pick<ProductMetric, "id" | "role" | "aarrr" | "heart">,
  all: readonly ProductMetric[]
): MetricRuleErrors {
  const example = isExampleId(next.id);
  const existing = all.some((m) => m.id === next.id);
  const others = all.filter((m) => m && m.id !== next.id && isExampleId(m.id) === example);
  const errors: MetricRuleErrors = {};
  if (next.role === "north-star") {
    const ns = others.find((m) => m.role === "north-star");
    if (ns) errors.role = `“${ns.name}” is the North Star. There is one North Star.`;
  }
  if (next.role === "input") {
    const inputs = others.filter((m) => m.role === "input").length;
    if (inputs >= TOOL_LIST_MAX.northStarInputs) {
      errors.role = `The North Star already has ${inputs} inputs, the most it takes. Remove one first.`;
    }
  }
  if (next.aarrr) {
    const on = others.find((m) => m.aarrr === next.aarrr);
    if (on) {
      errors.aarrr = `“${on.name}” is the ${AARRR_LABEL[next.aarrr]} stage. There is one metric per stage.`;
    }
  }
  const heart = next.heart;
  if (heart && heart.feature.trim()) {
    const feature = featureKey(heart.feature);
    const same = others.find(
      (m) => m.heart?.category === heart.category && featureKey(m.heart.feature) === feature
    );
    if (same) {
      errors.heart = `“${same.name}” is the ${HEART_LABEL[heart.category]} metric for “${heart.feature.trim()}”. There is one per feature and category.`;
    }
  }
  if (!existing && others.length >= TOOL_LIST_MAX.productMetrics) {
    errors.cap = `There are already ${others.length} metrics, the most the tool keeps. Remove one first.`;
  }
  return errors;
}

/** `metricRuleErrors` as a list of sentences; [] when `next` can be saved. */
export function metricRuleProblems(
  next: Pick<ProductMetric, "id" | "role" | "aarrr" | "heart">,
  all: readonly ProductMetric[]
): string[] {
  return Object.values(metricRuleErrors(next, all)).filter((x): x is string => Boolean(x));
}

/** A HEART feature as compared: trimmed, spaces collapsed, any case. */
export function featureKey(feature: string | undefined): string {
  return (feature ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * The writes that make `metricId` the North Star: the old North Star (of
 * the same kind, real or example) becomes a plain metric first, then the
 * new one is set. Empty when it already is, or the metric is unknown.
 */
export function northStarWrites(
  all: readonly ProductMetric[],
  metricId: string,
  now: string
): ProductMetric[] {
  const target = all.find((m) => m.id === metricId);
  if (!target || target.role === "north-star") return [];
  const example = isExampleId(metricId);
  const old = all.filter(
    (m) => m.id !== metricId && m.role === "north-star" && isExampleId(m.id) === example
  );
  return [
    ...old.map((m) => compactMetric({ ...m, role: undefined, updatedAt: now })),
    { ...target, role: "north-star", updatedAt: now },
  ];
}

/* ── Forms ──────────────────────────────────────────────────────────── */

export interface MetricDraft {
  name: string;
  definition: string;
  unit: string;
  direction: MetricDirection;
  baseline: string;
  target: string;
  owner: string;
  role: MetricRole | "";
  heartCategory: HeartCategory | "";
  heartFeature: string;
  heartGoal: string;
  heartSignal: string;
  aarrr: AarrrStage | "";
}

export type MetricField = keyof MetricDraft;

export interface MetricValues {
  name: string;
  definition?: string;
  unit?: string;
  direction: MetricDirection;
  baseline?: number;
  target?: number;
  owner?: string;
  role?: MetricRole;
  heart?: ProductMetric["heart"];
  aarrr?: AarrrStage;
}

export const EMPTY_METRIC_DRAFT: MetricDraft = {
  name: "",
  definition: "",
  unit: "",
  direction: "increase",
  baseline: "",
  target: "",
  owner: "",
  role: "",
  heartCategory: "",
  heartFeature: "",
  heartGoal: "",
  heartSignal: "",
  aarrr: "",
};

const numText = (n: number | undefined) => (finite(n) ? String(n) : "");

/** The form's draft for a saved metric. */
export function metricDraftFor(m: ProductMetric): MetricDraft {
  return {
    name: m.name ?? "",
    definition: m.definition ?? "",
    unit: m.unit ?? "",
    direction: m.direction === "decrease" ? "decrease" : "increase",
    baseline: numText(m.baseline),
    target: numText(m.target),
    owner: m.owner ?? "",
    role: m.role ?? "",
    heartCategory: m.heart?.category ?? "",
    heartFeature: m.heart?.feature ?? "",
    heartGoal: m.heart?.goal ?? "",
    heartSignal: m.heart?.signal ?? "",
    aarrr: m.aarrr ?? "",
  };
}

const tooLong = (label: string, max: number) => `${label} can be at most ${max} characters.`;

/**
 * Check the metric form: a name; text within its caps (the unit at most
 * HYPOTHESIS_UNIT_MAX, a hypothesis target's cap); finite numbers; a
 * target on the far side of the baseline in the metric's direction (as
 * `validateHypothesis` checks it); and a HEART goal with a feature.
 */
export function validateMetric(d: MetricDraft): Validation<MetricValues, MetricField> {
  const errors: FormErrors<MetricField> = {};
  const name = d.name.replace(/\s+/g, " ").trim();
  if (!name) errors.name = "Name the metric.";
  else if (name.length > METRIC_NAME_MAX) errors.name = tooLong("The name", METRIC_NAME_MAX);
  const definition = d.definition.trim();
  if (definition.length > METRIC_DEFINITION_MAX) {
    errors.definition = tooLong("What it means", METRIC_DEFINITION_MAX);
  }
  const unit = d.unit.trim();
  if (unit.length > METRIC_UNIT_MAX) errors.unit = tooLong("The unit", METRIC_UNIT_MAX);
  const owner = d.owner.trim();
  if (owner.length > METRIC_OWNER_MAX) errors.owner = tooLong("The owner", METRIC_OWNER_MAX);
  const baseline = parseNumber(d.baseline);
  const target = parseNumber(d.target);
  if (baseline !== undefined && !Number.isFinite(baseline)) errors.baseline = "Enter a number.";
  if (target !== undefined && !Number.isFinite(target)) errors.target = "Enter a number.";
  if (
    !errors.baseline &&
    !errors.target &&
    baseline !== undefined &&
    target !== undefined &&
    !errors.unit
  ) {
    if (d.direction === "increase" && target <= baseline) {
      errors.target = `Higher is better, so the target must be above the baseline (${formatMetric(baseline, unit)}).`;
    } else if (d.direction === "decrease" && target >= baseline) {
      errors.target = `Lower is better, so the target must be below the baseline (${formatMetric(baseline, unit)}).`;
    }
  }
  const feature = d.heartFeature.replace(/\s+/g, " ").trim();
  const goal = d.heartGoal.trim();
  const signal = d.heartSignal.trim();
  if (d.heartCategory) {
    if (!feature) errors.heartFeature = "Say which feature this HEART goal is for.";
    else if (feature.length > HEART_TEXT_MAX) {
      errors.heartFeature = tooLong("The feature", HEART_TEXT_MAX);
    }
    if (goal.length > HEART_TEXT_MAX) errors.heartGoal = tooLong("The goal", HEART_TEXT_MAX);
    if (signal.length > HEART_TEXT_MAX) errors.heartSignal = tooLong("The signal", HEART_TEXT_MAX);
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: {
      name,
      ...(definition ? { definition } : {}),
      ...(unit ? { unit } : {}),
      direction: d.direction,
      ...(baseline !== undefined ? { baseline } : {}),
      ...(target !== undefined ? { target } : {}),
      ...(owner ? { owner } : {}),
      ...(d.role ? { role: d.role } : {}),
      ...(d.heartCategory
        ? {
            heart: {
              category: d.heartCategory,
              feature,
              ...(goal ? { goal } : {}),
              ...(signal ? { signal } : {}),
            },
          }
        : {}),
      ...(d.aarrr ? { aarrr: d.aarrr } : {}),
    },
  };
}

/**
 * A metric with the form's values: a new row (`base` absent) or `base`
 * with its form fields replaced. Fields the form doesn't hold (`kva`,
 * `source`, the readings) are kept.
 */
export function metricFromValues(
  values: MetricValues,
  opts: { id: string; now: string; base?: ProductMetric; extra?: Partial<ProductMetric> }
): ProductMetric {
  const base = opts.base;
  const row: ProductMetric = {
    ...(base ?? {}),
    ...(opts.extra ?? {}),
    id: opts.id,
    name: values.name,
    definition: values.definition,
    unit: values.unit,
    direction: values.direction,
    baseline: values.baseline,
    target: values.target,
    owner: values.owner,
    role: values.role,
    heart: values.heart,
    aarrr: values.aarrr,
    readings: base ? sortedReadings(base) : (opts.extra?.readings ?? []),
    createdAt: base?.createdAt ?? opts.now,
    updatedAt: opts.now,
  };
  return compactMetric(row);
}

export interface ReadingDraft {
  date: string;
  value: string;
  note: string;
}

export type ReadingField = keyof ReadingDraft;

export interface ReadingValues {
  date: string;
  value: number;
  note?: string;
}

/**
 * Check a reading: a real day, never after `latest` (today on the
 * person's own clock; `latestCheckInDay(today, true)` for an agent on the
 * server), a finite number, a note within its cap.
 */
export function validateReading(
  d: ReadingDraft,
  latest: string
): Validation<ReadingValues, ReadingField> {
  const errors: FormErrors<ReadingField> = {};
  const date = d.date.trim();
  if (!date) errors.date = "Pick the day of the reading.";
  else if (!isDay(date)) errors.date = "Pick a date from the calendar.";
  else if (date > latest) errors.date = "A reading can't be for a day after today.";
  const value = parseNumber(d.value);
  if (value === undefined) errors.value = "Enter the number.";
  else if (!Number.isFinite(value)) errors.value = "Enter a number.";
  const note = d.note.trim();
  if (note.length > READING_NOTE_MAX) errors.note = tooLong("The note", READING_NOTE_MAX);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, values: { date, value: value as number, ...(note ? { note } : {}) } };
}

export interface PasteProblem {
  /** 1-based line number. */
  line: number;
  text: string;
  reason: string;
}

/**
 * Pasted readings, one `YYYY-MM-DD, value` per line (a tab, semicolon or
 * spaces also split them; a thousands comma inside the number is fine when
 * a tab or semicolon splits). Blank lines are skipped; at most
 * PASTE_LINES_MAX readings. A later line for the same day wins, as a
 * reading does.
 */
export function parseReadingsPaste(
  text: string,
  latest: string
): { readings: ReadingValues[]; problems: PasteProblem[] } {
  const problems: PasteProblem[] = [];
  const byDay = new Map<string, ReadingValues>();
  const lines = text.split(/\r?\n/);
  let counted = 0;
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    counted += 1;
    if (counted > PASTE_LINES_MAX) {
      problems.push({ line: i + 1, text: line, reason: `Only ${PASTE_LINES_MAX} lines are read.` });
      return;
    }
    const m = line.match(/^(\d{4}-\d{2}-\d{2})\s*(?:[,;\t]|\s)\s*(.+)$/);
    if (!m) {
      problems.push({ line: i + 1, text: line, reason: "Write a day, then the number." });
      return;
    }
    const [, date, rawValue] = m;
    const cleaned = /[;\t]/.test(line) ? rawValue.replace(/,/g, "") : rawValue;
    const value = Number(cleaned.replace(/[%\s]/g, ""));
    if (!isDay(date)) {
      problems.push({ line: i + 1, text: line, reason: "That day isn't on the calendar." });
    } else if (date > latest) {
      problems.push({ line: i + 1, text: line, reason: "That day is after today." });
    } else if (!cleaned.trim() || !Number.isFinite(value)) {
      problems.push({ line: i + 1, text: line, reason: "The value isn't a number." });
    } else {
      byDay.set(date, { date, value });
    }
  });
  const readings = Array.from(byDay.values()).sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0
  );
  return { readings, problems };
}

/* ── The views ──────────────────────────────────────────────────────── */

/** The rows a view reads: the team's own, or with the example's too. */
export function usableMetrics(
  metrics: readonly ProductMetric[] | undefined,
  { withExamples = true }: { withExamples?: boolean } = {}
): ProductMetric[] {
  return (metrics ?? []).filter(
    (m) =>
      m &&
      typeof m.id === "string" &&
      typeof m.name === "string" &&
      (withExamples || !isExampleId(m.id))
  );
}

/** The North Star and its inputs. Examples' North Star is used only when the team has none. */
export function northStarView(metrics: readonly ProductMetric[] | undefined): {
  northStar: ProductMetric | null;
  inputs: ProductMetric[];
} {
  const all = usableMetrics(metrics);
  const real = all.filter((m) => !isExampleId(m.id));
  const pool = real.some((m) => m.role === "north-star" || m.role === "input") ? real : all;
  return {
    northStar: pool.find((m) => m.role === "north-star") ?? null,
    inputs: pool.filter((m) => m.role === "input"),
  };
}

export interface HeartFeature {
  /** featureKey of the feature. */
  key: string;
  /** As the first metric names it. */
  feature: string;
  rows: Partial<Record<HeartCategory, ProductMetric>>;
}

/** The HEART metrics, grouped by feature (trimmed, any case), in the order they were added. */
export function heartView(metrics: readonly ProductMetric[] | undefined): HeartFeature[] {
  const out: HeartFeature[] = [];
  for (const m of usableMetrics(metrics)) {
    const h = m.heart;
    if (!h || !HEART_CATEGORIES.includes(h.category) || !featureKey(h.feature)) continue;
    const key = featureKey(h.feature);
    let group = out.find((g) => g.key === key);
    if (!group) {
      group = { key, feature: h.feature.replace(/\s+/g, " ").trim(), rows: {} };
      out.push(group);
    }
    if (!group.rows[h.category]) group.rows[h.category] = m;
  }
  return out;
}

export interface FunnelStage {
  stage: AarrrStage;
  metric: ProductMetric | null;
  /** The count on the period's day, or null. */
  count: number | null;
  /** Of the stage before (Activation, Retention), of Retention (Referral, Revenue); null for Acquisition. */
  ofBefore: number | null;
  /** Of everyone acquired; null for Acquisition. */
  ofAcquired: number | null;
  /** `ofBefore` now minus at the period before, in share points (0..1); null when either is missing. */
  change: number | null;
}

export interface FunnelView {
  /** The latest day with an Acquisition reading and at least one other stage's; null when none. */
  date: string | null;
  /** The period before, read the same way. */
  previousDate: string | null;
  stages: FunnelStage[];
  /** False when a share over 100% says the counts don't nest. */
  nested: boolean;
  /** The lower "of the stage before" of Activation and Retention; null when not nested or not read. */
  leakiest: AarrrStage | null;
}

/** The stage each stage's first share is taken of. */
export const FUNNEL_BASE: Record<AarrrStage, AarrrStage | null> = {
  acquisition: null,
  activation: "acquisition",
  retention: "activation",
  referral: "retention",
  revenue: "retention",
};

const share = (part: number | null, whole: number | null) =>
  part === null || whole === null || whole <= 0 ? null : part / whole;

/** Each stage's one metric: the team's own, else the example's when the team has none at all. */
export function stageMetrics(
  metrics: readonly ProductMetric[] | undefined
): Record<AarrrStage, ProductMetric | null> {
  const all = usableMetrics(metrics);
  const real = all.filter((m) => !isExampleId(m.id));
  const pool = real.some((m) => m.aarrr) ? real : all;
  const out = {} as Record<AarrrStage, ProductMetric | null>;
  for (const stage of AARRR_STAGES) out[stage] = pool.find((m) => m.aarrr === stage) ?? null;
  return out;
}

/** The days a funnel period can be read on, newest first. */
function periodDays(byStage: Record<AarrrStage, ProductMetric | null>): string[] {
  const acq = byStage.acquisition;
  if (!acq) return [];
  const others = AARRR_STAGES.filter((s) => s !== "acquisition")
    .map((s) => byStage[s])
    .filter((m): m is ProductMetric => m !== null);
  return sortedReadings(acq)
    .map((r) => r.date)
    .filter((d) => others.some((m) => readingOn(m, d) !== null))
    .reverse();
}

function sharesOn(byStage: Record<AarrrStage, ProductMetric | null>, date: string | null) {
  const count = (s: AarrrStage) => {
    const m = byStage[s];
    const r = m && date ? readingOn(m, date) : null;
    return r ? r.value : null;
  };
  const acquired = count("acquisition");
  return AARRR_STAGES.map((stage) => {
    const c = count(stage);
    const base = FUNNEL_BASE[stage];
    return {
      stage,
      count: c,
      ofBefore: base ? share(c, count(base)) : null,
      ofAcquired: stage === "acquisition" ? null : share(c, acquired),
    };
  });
}

/**
 * The funnel for its latest period: each stage's count, its share of the
 * stage before (Referral and Revenue: of Retention, since they are not
 * subsets of each other) and of everyone acquired. A share over 100%
 * means the counts don't nest, and then no leakiest stage is named.
 */
export function funnelView(metrics: readonly ProductMetric[] | undefined): FunnelView {
  const byStage = stageMetrics(metrics);
  const days = periodDays(byStage);
  const date = days[0] ?? null;
  const previousDate = days[1] ?? null;
  const now = sharesOn(byStage, date);
  const before = sharesOn(byStage, previousDate);
  const stages: FunnelStage[] = now.map((s, i) => ({
    stage: s.stage,
    metric: byStage[s.stage],
    count: s.count,
    ofBefore: s.ofBefore,
    ofAcquired: s.ofAcquired,
    change:
      s.ofBefore !== null && before[i].ofBefore !== null
        ? (s.ofBefore as number) - (before[i].ofBefore as number)
        : null,
  }));
  const nested = stages.every(
    (s) => (s.ofBefore === null || s.ofBefore <= 1) && (s.ofAcquired === null || s.ofAcquired <= 1)
  );
  let leakiest: AarrrStage | null = null;
  if (nested && date) {
    const candidates = stages.filter(
      (s) => (s.stage === "activation" || s.stage === "retention") && s.ofBefore !== null
    );
    candidates.sort((a, b) => (a.ofBefore as number) - (b.ofBefore as number));
    leakiest = candidates[0]?.stage ?? null;
  }
  return { date, previousDate, stages, nested, leakiest };
}

/** A share as a whole percentage: "35%", or "—". */
export function pctText(n: number | null): string {
  return n === null ? "—" : `${Math.round(n * 100)}%`;
}

/** A share change in points: "up 1 point", "down 2 points", "no change", or "". */
export function pointsText(change: number | null): string {
  if (change === null) return "";
  const pts = Math.round(change * 100);
  if (pts === 0) return "no change";
  const n = Math.abs(pts);
  return `${pts > 0 ? "up" : "down"} ${n} ${n === 1 ? "point" : "points"}`;
}

/** The views a metric sits in, as chips: North Star, Input, HEART, the stage, EBM. */
export function metricChips(m: ProductMetric): string[] {
  const chips: string[] = [];
  if (m.role) chips.push(ROLE_LABEL[m.role]);
  if (m.heart) chips.push(`HEART: ${HEART_LABEL[m.heart.category]}`);
  if (m.aarrr) chips.push(`Funnel: ${AARRR_LABEL[m.aarrr]}`);
  if (m.kva) chips.push("EBM");
  return chips;
}

/**
 * Where a metric is linked from: the hypotheses measured by it and the A/B
 * tests on it, by id (read only; the tracker and the calculator own them).
 */
export function metricLinks(
  metricId: string,
  hypotheses: readonly { id: string; measuredBy?: { metricId?: string } }[],
  abTests: readonly { id: string; metricId?: string }[]
): { hypotheses: number; abTests: number } {
  return {
    hypotheses: hypotheses.filter((h) => h.measuredBy?.metricId === metricId).length,
    abTests: abTests.filter((t) => t.metricId === metricId).length,
  };
}

/** The one-line verdict the page and Amr say. */
export function metricsVerdict(
  metrics: readonly ProductMetric[] | undefined,
  today: string
): string {
  const real = usableMetrics(metrics, { withExamples: false });
  if (real.length === 0) {
    return "No metrics yet: pick a North Star, a HEART goal or a funnel stage to start.";
  }
  const { northStar } = northStarView(real);
  if (!northStar)
    return `${real.length} ${real.length === 1 ? "metric" : "metrics"}, no North Star yet.`;
  const p = metricProgress(northStar);
  const stale = isStale(northStar, today);
  const progress = p === null ? "not measured" : `${Math.round(p * 100)}% of the way to its target`;
  return `The North Star, “${northStar.name}”, is ${progress}${
    stale ? `, with no reading in ${METRIC_STALE_DAYS} days` : ""
  }.`;
}

/* ── A funnel period ────────────────────────────────────────────────── */

export type FunnelDraft = { date: string } & Record<AarrrStage, string>;
export type FunnelField = keyof FunnelDraft;

export interface FunnelValues {
  date: string;
  counts: Partial<Record<AarrrStage, number>>;
}

export function emptyFunnelDraft(today: string): FunnelDraft {
  return { date: today, acquisition: "", activation: "", retention: "", referral: "", revenue: "" };
}

/**
 * Check "Add a period": a real day, never after `latest`; whole counts, 0
 * or more; Acquisition and at least one other stage; and a metric for
 * every stage given (`hasMetric`).
 */
export function validateFunnelPeriod(
  d: FunnelDraft,
  latest: string,
  hasMetric: Record<AarrrStage, boolean>
): Validation<FunnelValues, FunnelField> {
  const errors: FormErrors<FunnelField> = {};
  const date = d.date.trim();
  if (!date) errors.date = "Pick the period's day.";
  else if (!isDay(date)) errors.date = "Pick a date from the calendar.";
  else if (date > latest) errors.date = "A period can't be for a day after today.";
  const counts: Partial<Record<AarrrStage, number>> = {};
  for (const stage of AARRR_STAGES) {
    const n = parseNumber(d[stage]);
    if (n === undefined) continue;
    if (!Number.isInteger(n) || n < 0) errors[stage] = "Enter a whole number, 0 or more.";
    else if (!hasMetric[stage]) {
      errors[stage] = "This stage has no metric yet: set up the funnel first.";
    } else counts[stage] = n;
  }
  if (!errors.acquisition && counts.acquisition === undefined) {
    errors.acquisition = "Enter how many people arrived.";
  }
  const others = AARRR_STAGES.filter((s) => s !== "acquisition" && counts[s] !== undefined);
  if (!errors.activation && others.length === 0 && counts.acquisition !== undefined) {
    errors.activation = "Enter at least one more stage's count.";
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, values: { date, counts } };
}
