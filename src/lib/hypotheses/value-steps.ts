/**
 * Value checks in the Hypothesis Tracker: a hypothesis that follows a
 * shipped story or epic asks whether the work delivered. The Hypothesis
 * Tracker's eager next-step rule (lib/tools/next-steps.ts) leaves value
 * checks out of its "Record the result" step and appends these steps
 * instead, so this module stays small: every tool page fetches that table.
 * Imports only ./model and types.
 *
 *   - `isValueCheck`: it follows shipped work (`shipped` is set);
 *   - `isDue`: a check still open on or after its `checkOn` day, with no
 *     measured result yet;
 *   - `readingOnOrAfter`: the first dated reading (a metric's reading or a
 *     key result's check-in) on or after a day;
 *   - `readMeasure`: what "Read the metric" would record for a check;
 *   - `valueCheckSteps`: one step for the oldest due check.
 */

import type {
  Hypothesis,
  HypothesisMeasuredBy,
  MetricDirection,
  Okr,
  ProductMetric,
} from "@/lib/stores/workspace-types";
import type { NextStep } from "@/lib/tools/next-steps";
import { formatMetric, isDay, isResolved } from "./model";

/** Whether a hypothesis is a value check: it follows a shipped story or epic. */
export function isValueCheck(h: Pick<Hypothesis, "shipped">): boolean {
  return h.shipped !== undefined;
}

/** What the value checks are read against: the product metrics and the OKRs. */
export interface ValueCheckSources {
  metrics: readonly ProductMetric[] | undefined;
  okrs: readonly Okr[];
}

/**
 * A value check that is due: still drafted or running, with no measured
 * result, on or after its check day.
 */
export function isDue(
  h: Pick<Hypothesis, "shipped" | "status" | "checkOn" | "actual">,
  today: string
): boolean {
  return (
    isValueCheck(h) &&
    !isResolved(h.status) &&
    typeof h.actual !== "number" &&
    isDay(h.checkOn) &&
    h.checkOn <= today
  );
}

/** A dated number: a metric's reading or a key result's check-in. */
export interface DatedValue {
  date: string;
  value: number;
}

const readable = (e: DatedValue) =>
  e !== null && typeof e === "object" && isDay(e.date) && Number.isFinite(e.value);

/** The first reading on or after `day` (the earliest such day), or null. */
export function readingOnOrAfter(
  entries: readonly DatedValue[] | undefined,
  day: string
): DatedValue | null {
  let best: DatedValue | null = null;
  for (const e of entries ?? []) {
    if (!readable(e) || e.date < day) continue;
    if (!best || e.date < best.date) best = e;
  }
  return best ? { date: best.date, value: best.value } : null;
}

/** The last reading on or before `day` (the latest such day), or null. */
export function readingOnOrBefore(
  entries: readonly DatedValue[] | undefined,
  day: string
): DatedValue | null {
  let best: DatedValue | null = null;
  for (const e of entries ?? []) {
    if (!readable(e) || e.date > day) continue;
    if (!best || e.date > best.date) best = e;
  }
  return best ? { date: best.date, value: best.value } : null;
}

/** The metric or key result a hypothesis is measured by, as both read alike. */
export interface Measure {
  kind: "metric" | "key-result";
  name: string;
  unit?: string;
  direction: MetricDirection;
  baseline?: number;
  target?: number;
  entries: DatedValue[];
}

/**
 * The metric or key result `measuredBy` names: null for one measured in
 * words (or none), "missing" when the metric or key result is gone.
 */
export function measureOf(
  measuredBy: HypothesisMeasuredBy | undefined,
  sources: ValueCheckSources
): Measure | "missing" | null {
  if (!measuredBy) return null;
  if (measuredBy.kind === "metric") {
    const m = (sources.metrics ?? []).find((x) => x.id === measuredBy.metricId);
    if (!m) return "missing";
    return {
      kind: "metric",
      name: m.name,
      ...(m.unit ? { unit: m.unit } : {}),
      direction: m.direction === "decrease" ? "decrease" : "increase",
      ...(Number.isFinite(m.baseline) ? { baseline: m.baseline } : {}),
      ...(Number.isFinite(m.target) ? { target: m.target } : {}),
      entries: Array.isArray(m.readings) ? m.readings : [],
    };
  }
  if (measuredBy.kind === "key-result") {
    const okr = sources.okrs.find((o) => o.id === measuredBy.okrId);
    const kr = okr?.keyResults?.find((k) => k.id === measuredBy.keyResultId);
    if (!kr) return "missing";
    return {
      kind: "key-result",
      name: kr.title,
      ...(kr.unit ? { unit: kr.unit } : {}),
      direction: kr.direction === "decrease" ? "decrease" : "increase",
      ...(Number.isFinite(kr.baseline) ? { baseline: kr.baseline } : {}),
      ...(Number.isFinite(kr.target) ? { target: kr.target } : {}),
      entries: Array.isArray(kr.checkIns) ? kr.checkIns : [],
    };
  }
  return null;
}

/** What "Read the metric" would do for a hypothesis. */
export type MeasureRead =
  /** Not a value check measured by a metric or a key result. */
  | { state: "none" }
  /** The metric or key result it names is gone. */
  | { state: "missing" }
  /** It has no target to compare a reading with. */
  | { state: "no_target"; measure: Measure }
  /** No reading on or after its check day yet. */
  | { state: "no_reading"; measure: Measure; checkOn: string }
  | { state: "ready"; measure: Measure; checkOn: string; reading: DatedValue };

/**
 * The reading a value check's result comes from: the first reading of its
 * metric (or check-in of its key result) on or after its check day. Only a
 * value check measured by a metric or a key result, with a target, reads one.
 */
export function readMeasure(
  h: Pick<Hypothesis, "shipped" | "measuredBy" | "checkOn" | "target">,
  sources: ValueCheckSources
): MeasureRead {
  if (!isValueCheck(h) || !isDay(h.checkOn)) return { state: "none" };
  const measure = measureOf(h.measuredBy, sources);
  if (measure === null) return { state: "none" };
  if (measure === "missing") return { state: "missing" };
  if (!h.target || !Number.isFinite(h.target.value)) return { state: "no_target", measure };
  const reading = readingOnOrAfter(measure.entries, h.checkOn);
  if (!reading) return { state: "no_reading", measure, checkOn: h.checkOn };
  return { state: "ready", measure, checkOn: h.checkOn, reading };
}

const QUOTE_MAX = 60;
const quoted = (text: string | undefined, untitled: string) => {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return `“${untitled}”`;
  if (t.length <= QUOTE_MAX) return `“${t}”`;
  const cut = t.slice(0, QUOTE_MAX);
  const space = cut.lastIndexOf(" ");
  return `“${(space > QUOTE_MAX / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, "")}…”`;
};

/**
 * The value checks' next steps, given today (YYYY-MM-DD): one step for the
 * check that has waited longest past its day, saying how to record it. The
 * rule passes the tracker's own rows (no example rows).
 */
export function valueCheckSteps(
  hypotheses: readonly Hypothesis[],
  sources: ValueCheckSources,
  today: string
): NextStep[] {
  const due = hypotheses
    .filter((h) => isDue(h, today))
    .sort((a, b) => (a.checkOn ?? "").localeCompare(b.checkOn ?? ""));
  const [first] = due;
  if (!first) return [];
  const read = readMeasure(first, sources);
  const shipped = quoted(first.shipped?.title, "shipped work");
  const more =
    due.length > 1
      ? ` ${due.length - 1} other value ${due.length - 1 === 1 ? "check is" : "checks are"} due too.`
      : "";
  if (read.state === "ready") {
    const value = formatMetric(read.reading.value, read.measure.unit);
    return [
      {
        id: "hypothesis-tracker-value-check",
        label: `Read the metric for ${shipped}`,
        detail: `Its check was due on ${first.checkOn}, and ${read.measure.name} read ${value} on ${read.reading.date}. “Read the metric” on its card records it as the result.${more}`,
        href: "/hypothesis-tracker",
      },
    ];
  }
  const typed = first.target
    ? "type the measured result on its card"
    : "set its status from what you saw";
  const how =
    read.state === "no_reading"
      ? `No reading of ${read.measure.name} on or after that day yet: add one, or type the measured result on its card.`
      : read.state === "no_target"
        ? "Give it a target to read the metric, or set its status from what you saw."
        : read.state === "missing"
          ? `What it was measured by is gone: ${typed}.`
          : `${typed.charAt(0).toUpperCase()}${typed.slice(1)}.`;
  return [
    {
      id: "hypothesis-tracker-value-check",
      label: `Check the value of ${shipped}`,
      detail: `Its check was due on ${first.checkOn}. ${how}${more}`,
      href: "/hypothesis-tracker",
    },
  ];
}
