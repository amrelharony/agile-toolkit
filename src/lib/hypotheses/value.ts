/**
 * "Value validated": did the shipped work deliver? A value check is a
 * hypothesis that follows a finished story or epic, measured by a product
 * metric, a key result or in words, and read some days after it shipped.
 * One model for the Hypothesis Tracker's page, its agent verbs and the A/B
 * Calculator's link back, so a check reads the same in each:
 *
 *   - `shippedCandidates`: work done in the last 90 days with no check yet;
 *   - `valueCheckDraft` / `validateValueCheck` / `applyValueCheck`: the
 *     "Check its value" form, saved as a running hypothesis through
 *     validateHypothesis;
 *   - `withMeasuredBy`: how any hypothesis is measured;
 *   - `abResultUpdate`: "Use the A/B result" (the result sentence into
 *     what we learned, and the measured number only when the test has its
 *     planned sample, is significant and the target is in "%");
 *   - `valueSummary`: "Value validated: 2 of 3 decisive (67%)".
 *
 * Pure and server-safe: nothing here imports a "use client" module, React
 * or the store, so the MCP route can call every function.
 */

import type {
  AbTest,
  EpicRoadmap,
  Hypothesis,
  HypothesisMeasuredBy,
  HypothesisShipped,
  MeasuredByKind,
  MetricDirection,
  ShippedKind,
  Story,
} from "@/lib/stores/workspace-types";
import { MEASURED_BY_KINDS } from "@/lib/stores/workspace-types";
import { addDays } from "@/lib/flow/days";
import { doneOn } from "@/lib/flow/items";
import { epicRollup, linkedStories } from "@/lib/roadmap/rollup";
import { EPIC_ROADMAP_ID } from "@/lib/roadmap/epic-source";
import { testSummary, tooEarlyText } from "@/lib/experiments/model";
import { isExampleId } from "@/lib/utils/example-id";
import type { FormErrors, Validation } from "@/lib/utils/form";
import {
  HYPOTHESIS_TEXT_MAX,
  applyHypothesisValues,
  formatMetric,
  isDay,
  suggestVerdict,
  validateHypothesis,
  validationRate,
  type HypothesisValues,
  type ValidationRate,
  type VerdictSuggestion,
} from "./model";
import {
  isDue,
  isValueCheck,
  measureOf,
  readingOnOrBefore,
  type ValueCheckSources,
} from "./value-steps";

export * from "./value-steps";

/** How long after shipping a check is read: the "Look after" choices, in days. */
export const VALUE_CHECK_DAYS = [7, 14, 30, 60, 90] as const;
export const DEFAULT_LOOK_AFTER = 30;
/** Shipped work this recent is offered for a check. */
export const SHIPPED_WINDOW_DAYS = 90;
/** A shipped item's title as a check keeps it, so a deleted story still reads. */
export const SHIPPED_TITLE_MAX = 200;
/** How a check is measured, in words. */
export const MEASURED_NOTE_MAX = 200;

const cut = (s: string | undefined, max: number) =>
  (s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/* ── Shipped work to check ───────────────────────────────────────────── */

export interface ShippedCandidate {
  kind: ShippedKind;
  id: string;
  title: string;
  /** The day it was done; null for an epic none of whose stories says (the person picks one). */
  doneAt: string | null;
}

/** Whether a hypothesis already checks this item. */
const checked = (hypotheses: readonly Hypothesis[], kind: ShippedKind, id: string) =>
  hypotheses.some((h) => h.shipped?.kind === kind && h.shipped.id === id);

/**
 * Work shipped in the last 90 days with no value check yet, the newest
 * first: done stories by the day they were done (lib/flow/items doneOn),
 * then finished epics (every linked story done, lib/roadmap/rollup), on
 * the latest day one of their stories was done, else with no day. Example
 * rows are left out.
 */
export function shippedCandidates(
  input: {
    stories: readonly Story[] | undefined;
    roadmaps: readonly EpicRoadmap[] | undefined;
    hypotheses: readonly Hypothesis[];
  },
  today: string
): ShippedCandidate[] {
  const from = addDays(today, -SHIPPED_WINDOW_DAYS) ?? today;
  const inWindow = (day: string | null) => day !== null && day >= from && day <= today;
  const stories = (input.stories ?? []).filter((s) => s && !isExampleId(s.id));
  const out: ShippedCandidate[] = [];
  for (const s of stories) {
    if (s.status !== "done" || checked(input.hypotheses, "story", s.id)) continue;
    const day = doneOn(s);
    if (!inWindow(day)) continue;
    out.push({
      kind: "story",
      id: s.id,
      title: cut(s.title, SHIPPED_TITLE_MAX) || "Untitled story",
      doneAt: day,
    });
  }
  const roadmap = (input.roadmaps ?? []).find((r) => r.id === EPIC_ROADMAP_ID);
  for (const e of roadmap?.epics ?? []) {
    if (!e || isExampleId(e.id) || checked(input.hypotheses, "epic", e.id)) continue;
    const linked = linkedStories(e.id, stories);
    if (!epicRollup(e, linked).done) continue;
    const days = linked
      .filter((s) => s.status === "done")
      .map((s) => doneOn(s))
      .filter((d): d is string => d !== null)
      .sort();
    const day = days.at(-1) ?? null;
    if (day !== null && !inWindow(day)) continue;
    out.push({
      kind: "epic",
      id: e.id,
      title: cut(e.title, SHIPPED_TITLE_MAX) || "Untitled epic",
      doneAt: day,
    });
  }
  return out.sort((a, b) => {
    if (a.doneAt === b.doneAt) return 0;
    if (a.doneAt === null) return 1;
    if (b.doneAt === null) return -1;
    return b.doneAt.localeCompare(a.doneAt);
  });
}

/* ── The "Check its value" form ──────────────────────────────────────── */

export interface ValueCheckDraft {
  kind: ShippedKind;
  shippedId: string;
  title: string;
  /** The day it shipped (YYYY-MM-DD); an epic's may need picking. */
  shippedOn: string;
  believe: string;
  willDo: string;
  toLearn: string;
  successMetric: string;
  measuredKind: MeasuredByKind;
  metricId: string;
  /** A key result as "okrId/keyResultId", or "". */
  keyResult: string;
  note: string;
  /** Days after shipping: one of VALUE_CHECK_DAYS. */
  lookAfter: number;
  direction: MetricDirection | "";
  targetValue: string;
  unit: string;
  baseline: string;
}

export type ValueCheckField = keyof ValueCheckDraft;

export interface ValueCheckValues {
  hypothesis: HypothesisValues;
  shipped: HypothesisShipped;
  checkOn: string;
  measuredBy: HypothesisMeasuredBy;
}

/** A key result's form value. */
export const keyResultRef = (okrId: string, keyResultId: string) => `${okrId}/${keyResultId}`;

/** The okr and key result ids of a form value, or null. */
export function parseKeyResultRef(ref: string): { okrId: string; keyResultId: string } | null {
  const at = ref.indexOf("/");
  if (at <= 0 || at === ref.length - 1) return null;
  return { okrId: ref.slice(0, at), keyResultId: ref.slice(at + 1) };
}

/**
 * The form for a shipped item, its four lines pre-filled in our words,
 * measured in words until a metric or key result is picked, read 30 days
 * after it shipped.
 */
export function valueCheckDraft(c: ShippedCandidate, today: string): ValueCheckDraft {
  const t = c.title;
  return {
    kind: c.kind,
    shippedId: c.id,
    title: t,
    shippedOn: c.doneAt ?? today,
    believe: `shipping “${t}” gave people the value we expected`,
    willDo: `look at how people use “${t}” now that it has shipped`,
    toLearn: `whether “${t}” changed what we hoped it would`,
    successMetric: `the measure moves the way we expected after “${t}” shipped`,
    measuredKind: "words",
    metricId: "",
    keyResult: "",
    note: "",
    lookAfter: DEFAULT_LOOK_AFTER,
    direction: "",
    targetValue: "",
    unit: "",
    baseline: "",
  };
}

const numText = (n: number | undefined) =>
  typeof n === "number" && Number.isFinite(n) ? String(n) : "";

/**
 * What picking a metric or a key result fills in: its direction and unit,
 * the baseline from its reading (or check-in) on or before the ship day,
 * else its own baseline, and its target when that is on the far side of
 * the baseline (else left for the person to type). Null when it isn't found.
 */
export function measureDefaults(
  measuredBy: HypothesisMeasuredBy,
  sources: ValueCheckSources,
  shippedOn: string
): Pick<ValueCheckDraft, "direction" | "unit" | "baseline" | "targetValue"> | null {
  const m = measureOf(measuredBy, sources);
  if (m === null || m === "missing") return null;
  const before = isDay(shippedOn) ? readingOnOrBefore(m.entries, shippedOn) : null;
  const baseline = before?.value ?? m.baseline;
  const target = m.target;
  const beyond =
    typeof target === "number" &&
    (typeof baseline !== "number" ||
      (m.direction === "decrease" ? target < baseline : target > baseline));
  return {
    direction: m.direction,
    unit: cut(m.unit, 40),
    baseline: numText(baseline),
    targetValue: beyond ? numText(target) : "",
  };
}

/** The measuredBy a form's choice names, or why it can't be used. */
export function measuredByOf(
  d: Pick<ValueCheckDraft, "measuredKind" | "metricId" | "keyResult" | "note">,
  sources: ValueCheckSources
):
  | { ok: true; measuredBy: HypothesisMeasuredBy }
  | { ok: false; field: ValueCheckField; error: string } {
  if (d.measuredKind === "metric") {
    if (!d.metricId) return { ok: false, field: "metricId", error: "Pick the metric." };
    if (!(sources.metrics ?? []).some((m) => m.id === d.metricId)) {
      return { ok: false, field: "metricId", error: "That metric is gone: pick another." };
    }
    return { ok: true, measuredBy: { kind: "metric", metricId: d.metricId } };
  }
  if (d.measuredKind === "key-result") {
    const ref = parseKeyResultRef(d.keyResult);
    if (!ref) return { ok: false, field: "keyResult", error: "Pick the key result." };
    const measuredBy: HypothesisMeasuredBy = { kind: "key-result", ...ref };
    if (measureOf(measuredBy, sources) === "missing") {
      return { ok: false, field: "keyResult", error: "That key result is gone: pick another." };
    }
    return { ok: true, measuredBy };
  }
  if (d.measuredKind === "words") {
    const note = d.note.trim();
    if (!note)
      return {
        ok: false,
        field: "note",
        error: "Say how you'll tell, e.g. “fewer support tickets about it”.",
      };
    if (note.length > MEASURED_NOTE_MAX) {
      return {
        ok: false,
        field: "note",
        error: `Keep it to ${MEASURED_NOTE_MAX} characters or fewer.`,
      };
    }
    return { ok: true, measuredBy: { kind: "words", note } };
  }
  return { ok: false, field: "measuredKind", error: "Pick how it's measured." };
}

/**
 * Check the "Check its value" form. The four lines and the target are
 * judged by validateHypothesis, as a running hypothesis raised today; the
 * ship day is a real day, not in the future; "Look after" is one of the
 * offered days, so the check day is never before the ship day; a check
 * measured by a metric or a key result needs a target (a measured result
 * needs one to be judged against).
 */
export function validateValueCheck(
  d: ValueCheckDraft,
  today: string,
  sources: ValueCheckSources
): Validation<ValueCheckValues, ValueCheckField> {
  const errors: FormErrors<ValueCheckField> = {};
  if (!d.shippedOn.trim()) errors.shippedOn = "Pick the day it shipped.";
  else if (!isDay(d.shippedOn)) errors.shippedOn = "Pick a date from the calendar.";
  else if (d.shippedOn > today)
    errors.shippedOn = "It can't ship on a day that hasn't happened yet.";
  if (!(VALUE_CHECK_DAYS as readonly number[]).includes(d.lookAfter)) {
    errors.lookAfter = "Pick when to look.";
  }
  if (!(MEASURED_BY_KINDS as readonly string[]).includes(d.measuredKind)) {
    errors.measuredKind = "Pick how it's measured.";
  }
  const measured = measuredByOf(d, sources);
  if (!measured.ok) errors[measured.field] = measured.error;
  if (d.measuredKind !== "words" && !d.direction) {
    errors.direction =
      "A check on a metric or a key result needs a target: pick whether it should rise or fall.";
  }
  const lines = validateHypothesis(
    {
      believe: d.believe,
      willDo: d.willDo,
      toLearn: d.toLearn,
      successMetric: d.successMetric,
      experiment: "",
      description: "",
      outcome: "",
      status: "running",
      raisedAt: today,
      resolvedAt: "",
      direction: d.direction,
      targetValue: d.targetValue,
      unit: d.unit,
      baseline: d.baseline,
      actual: "",
    },
    today
  );
  if (!lines.ok) {
    for (const key of [
      "believe",
      "willDo",
      "toLearn",
      "successMetric",
      "direction",
      "targetValue",
      "unit",
      "baseline",
    ] as const) {
      const e = lines.errors[key];
      if (e && !errors[key]) errors[key] = e;
    }
  }
  const checkOn = isDay(d.shippedOn) ? addDays(d.shippedOn, d.lookAfter) : null;
  if (Object.keys(errors).length > 0 || !lines.ok || !measured.ok || !checkOn) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    values: {
      hypothesis: lines.values,
      shipped: {
        kind: d.kind,
        id: d.shippedId,
        title: cut(d.title, SHIPPED_TITLE_MAX) || "Untitled",
        doneAt: d.shippedOn,
      },
      checkOn,
      measuredBy: measured.measuredBy,
    },
  };
}

/** The value check saved: a running hypothesis with what shipped, its check day and its measure. */
export function applyValueCheck(
  base: Pick<Hypothesis, "id"> & Partial<Hypothesis>,
  v: ValueCheckValues
): Hypothesis {
  return {
    ...applyHypothesisValues(base, v.hypothesis),
    shipped: v.shipped,
    checkOn: v.checkOn,
    measuredBy: v.measuredBy,
  };
}

/** The hypothesis measured by `m`, or with no measure (null). */
export function withMeasuredBy(h: Hypothesis, m: HypothesisMeasuredBy | null): Hypothesis {
  const next = { ...h };
  if (m) next.measuredBy = m;
  else delete next.measuredBy;
  return next;
}

/** A measure in words, for a card, a step or the export: "Sign-ups (a metric)", "metric removed". */
export function measuredByText(
  m: HypothesisMeasuredBy | undefined,
  sources: ValueCheckSources
): string | null {
  if (!m) return null;
  if (m.kind === "words") return m.note?.trim() || null;
  const measure = measureOf(m, sources);
  if (measure === "missing") return m.kind === "metric" ? "metric removed" : "key result removed";
  if (!measure) return null;
  return `${measure.name} (${measure.kind === "metric" ? "a product metric" : "a key result"})`;
}

/* ── "Use the A/B result" ────────────────────────────────────────────── */

export type AbResultUpdate =
  | {
      ok: true;
      next: Hypothesis;
      /** "A/B test “name”: B converted better than A by …" (below the plan, "…: Too early to call: …. So far: …"). */
      sentence: string;
      /** Whether the measured result was set (B's rate in %). */
      actualSet: boolean;
      /** The verdict that result suggests, when it was set. */
      suggestedVerdict: VerdictSuggestion | null;
    }
  | { ok: false; reason: "no_result" | "already_used" | "too_long" };

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The hypothesis with its A/B test's result: the result sentence added to
 * what we learned (on its own line, once), and B's rate × 100 as the
 * measured result only when the target is in "%", the test has its
 * planned sample per version and the result is significant at the plan's
 * confidence. Below the planned sample the line starts "Too early to
 * call: …. So far:", as the page reads it, so an early peek's
 * "significant" never stands as a result. It never sets the status.
 */
export function abResultUpdate(h: Hypothesis, test: AbTest): AbResultUpdate {
  const s = testSummary(test);
  if (!s.result) return { ok: false, reason: "no_result" };
  const { early } = s.result;
  const reading =
    early.planned !== null && !early.met
      ? `${tooEarlyText(early)}. So far: ${s.result.sentence}`
      : s.result.sentence;
  const sentence = `A/B test “${cut(test.name, 120) || "Untitled"}”: ${reading}`;
  const prev = (h.outcome ?? "").trim();
  if (prev.includes(sentence)) return { ok: false, reason: "already_used" };
  const outcome = prev ? `${prev}\n${sentence}` : sentence;
  if (outcome.length > HYPOTHESIS_TEXT_MAX) return { ok: false, reason: "too_long" };
  const ready =
    s.result.early.met && s.result.analysis.significant && h.target?.unit?.trim() === "%";
  const next: Hypothesis = { ...h, outcome };
  if (ready) next.actual = round2(s.result.analysis.b.rate * 100);
  return {
    ok: true,
    next,
    sentence,
    actualSet: ready,
    suggestedVerdict: ready ? suggestVerdict(next) : null,
  };
}

/** Why "Use the A/B result" did nothing, in the page's words. */
export const AB_RESULT_REASON: Record<
  "no_result" | "already_used" | "too_long" | "no_test",
  string
> = {
  no_test: "No A/B test is linked to it.",
  no_result: "Its A/B test has no counts yet.",
  already_used: "Its A/B result is in “What we learned” already.",
  too_long: "“What we learned” is too long to add the result: shorten it first.",
};

/* ── The summary ─────────────────────────────────────────────────────── */

export interface ValueSummary extends ValidationRate {
  total: number;
  due: number;
}

/**
 * How the value checks stand, over the rows given (the page passes the
 * rows its rate counts; examples count only with `includeExamples`).
 */
export function valueSummary(
  rows: readonly Hypothesis[],
  today: string,
  { includeExamples = false }: { includeExamples?: boolean } = {}
): ValueSummary {
  const checks = rows.filter((h) => isValueCheck(h) && (includeExamples || !isExampleId(h.id)));
  return {
    ...validationRate(checks, { includeExamples: true }),
    total: checks.length,
    due: checks.filter((h) => isDue(h, today)).length,
  };
}

/** "Value validated: 2 of 3 decisive (67%)", or "… no check has a result yet (1 open)". */
export function valueSummaryText(s: ValueSummary): string {
  if (s.rate === null) {
    return `Value validated: no check has a result yet (${s.open} open${s.inconclusive > 0 ? `, ${s.inconclusive} inconclusive` : ""})`;
  }
  return `Value validated: ${s.validated} of ${s.decisive} decisive (${Math.round(s.rate * 100)}%)`;
}

/** A check's shipped line: "Shipped “Onboarding checklist” on 2026-10-20 · check on 2026-11-19". */
export function shippedText(h: Pick<Hypothesis, "shipped" | "checkOn">): string | null {
  if (!h.shipped) return null;
  const on = isDay(h.shipped.doneAt) ? ` on ${h.shipped.doneAt}` : "";
  const check = h.checkOn ? ` · check on ${h.checkOn}` : "";
  return `Shipped “${h.shipped.title || "untitled"}”${on}${check}`;
}

/** The measured value a reading gives, in the hypothesis's unit: "14%". */
export const readingText = (value: number, unit?: string) => formatMetric(value, unit);
