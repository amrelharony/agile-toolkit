/**
 * Hypotheses: what a test aims for, whether it got there, and how the
 * tests stand together. One model for the Hypothesis Tracker page, its
 * agent actions (tool.hypothesis_tracker), the "hypothesis" hand-off and
 * the tools that send to it (Riskiest Assumption, Opportunity Tree,
 * Cynefin, Design Sprint), so a hypothesis reads the same in each.
 *
 * A result is never copied back into the item that sent it: the source
 * reads its state from the tracker's list through `linkedTest`, and a link
 * whose hypothesis is gone reads as never sent.
 *
 * Pure and server-safe: nothing here imports a "use client" module, React
 * or the store, so the MCP route can call every function.
 */

import type {
  HandoffLink,
  Hypothesis,
  HypothesisStatus,
  HypothesisTarget,
  HypothesisTracker,
  MetricDirection,
} from "@/lib/stores/workspace-types";
import type { HandoffSource } from "@/lib/handoffs/types";
import { isExampleId } from "@/lib/utils/example-id";
import { isBlank, parseNumber, type FormErrors, type Validation } from "@/lib/utils/form";
import { isIsoDate } from "@/lib/sprints/calendar";

/**
 * The tracker's one document id: the page, tool.hypothesis_tracker, the
 * hand-off and every reader of the list use it (lib/handoffs/targets/
 * hypothesis re-exports it for its older callers).
 */
export const HYPOTHESIS_TRACKER_ID = "hypothesisTracker:current";

/**
 * One cap on each text field, for the page, the agent actions and a
 * hand-off (they were 4000, 2000 and 1000). Longer text saved before is
 * kept as it is until someone edits that field.
 */
export const HYPOTHESIS_TEXT_MAX = 2000;

/** A target's unit ("%", "sign-ups"), as the workspace schema caps it. */
export const HYPOTHESIS_UNIT_MAX = 40;

/** The lifecycle, in the order the page lists it. */
export const HYPOTHESIS_STATUSES = [
  "drafted",
  "running",
  "validated",
  "invalidated",
  "inconclusive",
] as const;

/** A status with a result: the test is over. */
export const RESOLVED: ReadonlySet<HypothesisStatus> = new Set<HypothesisStatus>([
  "validated",
  "invalidated",
  "inconclusive",
]);

export function isResolved(status: HypothesisStatus | undefined): boolean {
  return status !== undefined && RESOLVED.has(status);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Floating-point noise off a difference (0.1 + 0.2), for display. */
const tidy = (n: number) => Math.round(n * 1e6) / 1e6;

/* ── The validation rate ─────────────────────────────────────────────── */

export interface ValidationRate {
  validated: number;
  invalidated: number;
  inconclusive: number;
  /** Drafted or running (or a status the tracker doesn't know): no result yet. */
  open: number;
  /** validated + invalidated: the results that say yes or no. */
  decisive: number;
  /** validated / decisive, 0..1; null while no result is decisive ("—", never 0%). */
  rate: number | null;
}

/**
 * How the tests stand. An inconclusive result isn't counted either way (it
 * neither held up nor failed), so the rate is validated over decisive, on
 * the page and for an agent alike; example rows are left out.
 */
export function validationRate(
  hypotheses: readonly Pick<Hypothesis, "id" | "status">[] | undefined
): ValidationRate {
  const r = { validated: 0, invalidated: 0, inconclusive: 0, open: 0 };
  for (const h of hypotheses ?? []) {
    if (isExampleId(h.id)) continue;
    if (h.status === "validated") r.validated += 1;
    else if (h.status === "invalidated") r.invalidated += 1;
    else if (h.status === "inconclusive") r.inconclusive += 1;
    else r.open += 1;
  }
  const decisive = r.validated + r.invalidated;
  return { ...r, decisive, rate: decisive > 0 ? r.validated / decisive : null };
}

/**
 * The one-sentence verdict:
 * "3 of 5 decisive tests held up (60%); 2 inconclusive aren't counted; 4 still open."
 */
export function hypothesisVerdict(r: ValidationRate): string {
  if (r.decisive + r.inconclusive + r.open === 0) return "No hypotheses yet.";
  const head =
    r.rate === null
      ? "No test has a decisive result yet"
      : `${r.validated} of ${plural(r.decisive, "decisive test")} held up (${Math.round(r.rate * 100)}%)`;
  const parts = [head];
  if (r.inconclusive > 0) {
    parts.push(
      `${r.inconclusive} inconclusive ${r.inconclusive === 1 ? "isn't" : "aren't"} counted`
    );
  }
  if (r.open > 0) parts.push(`${r.open} still open`);
  return `${parts.join("; ")}.`;
}

/* ── Target and result ───────────────────────────────────────────────── */

export interface VerdictSuggestion {
  /** What the numbers say; the user applies it (a suggestion is never saved as the status). */
  verdict: "validated" | "invalidated";
  /** The target was reached: at least (increase) or at most (decrease) its value. */
  met: boolean;
  /** actual − target, signed so that positive is better (above a rise's target, below a fall's). */
  margin: number;
  /** actual − baseline as measured (up is positive), when the target has a baseline. */
  moved?: number;
}

/**
 * The verdict a measured result suggests: binary, target met → validated,
 * missed → invalidated. Null without a target or a measured number.
 */
export function suggestVerdict(h: Pick<Hypothesis, "target" | "actual">): VerdictSuggestion | null {
  const t = h.target;
  const actual = h.actual;
  if (!t || typeof actual !== "number" || !Number.isFinite(actual)) return null;
  if (typeof t.value !== "number" || !Number.isFinite(t.value)) return null;
  const margin = t.direction === "decrease" ? t.value - actual : actual - t.value;
  const met = margin >= 0;
  return {
    verdict: met ? "validated" : "invalidated",
    met,
    margin: tidy(margin),
    ...(typeof t.baseline === "number" && Number.isFinite(t.baseline)
      ? { moved: tidy(actual - t.baseline) }
      : {}),
  };
}

/** A number with its unit: "14%", "40 sign-ups", "3.5". */
export function formatMetric(value: number, unit?: string): string {
  const n = String(Math.round(value * 100) / 100);
  const u = (unit ?? "").trim();
  if (!u) return n;
  return u === "%" ? `${n}%` : `${n} ${u}`;
}

/**
 * The suggestion in words, for the page and an agent:
 * "Target met: 14% against at least 12% (up 4 from 10%). Suggested verdict: validated."
 */
export function suggestionText(h: Pick<Hypothesis, "target" | "actual">): string | null {
  const s = suggestVerdict(h);
  if (!s || !h.target || h.actual === undefined) return null;
  const { direction, value, unit, baseline } = h.target;
  const bound = direction === "decrease" ? "at most" : "at least";
  let from = "";
  if (s.moved !== undefined && baseline !== undefined) {
    const base = formatMetric(baseline, unit);
    from =
      s.moved === 0
        ? ` (no change from ${base})`
        : ` (${s.moved > 0 ? "up" : "down"} ${formatMetric(Math.abs(s.moved))} from ${base})`;
  }
  return `Target ${s.met ? "met" : "missed"}: ${formatMetric(h.actual, unit)} against ${bound} ${formatMetric(value, unit)}${from}. Suggested verdict: ${s.verdict}.`;
}

/* ── Hand-off drafts ─────────────────────────────────────────────────── */

/** The fields a test can't run without. */
export type MissingField = "willDo" | "successMetric";

/**
 * What a hypothesis still needs before it can run: a hand-off draft arrives
 * with the title (and maybe what to learn) only. The page flags these
 * "Needs detail"; the status can't move past drafted until they're filled.
 */
export function missingFields(h: Pick<Hypothesis, "willDo" | "successMetric">): MissingField[] {
  const out: MissingField[] = [];
  if (isBlank(h.willDo)) out.push("willDo");
  if (isBlank(h.successMetric)) out.push("successMetric");
  return out;
}

/**
 * An item's title as its hypothesis's "We believe" line. The tracker
 * labels that field "We believe" itself, so a leading "We believe" is
 * dropped ("We believe that X" reads "that X"); a title that is only the
 * words stays as typed.
 */
export function believeLine(title: string): string {
  const t = title.trim();
  return t.replace(/^we believe\b[\s,:]*/i, "") || t;
}

const cap = (text: string | undefined) => (text ?? "").trim().slice(0, HYPOTHESIS_TEXT_MAX);

/**
 * The drafted hypothesis a hand-off creates: the title is "We believe",
 * the description "To learn", and `src.hypothesis` fills what we'll do,
 * the experiment and the success metric when the source has them (a
 * riskiest assumption's test idea, an experiment's text). Absent fields
 * stay blank for the tracker to ask. Every field is capped.
 */
export function hypothesisFromSource(src: HandoffSource, id: string, today: string): Hypothesis {
  const experiment = cap(src.hypothesis?.experiment);
  return {
    id,
    believe: cap(src.title),
    willDo: cap(src.hypothesis?.willDo),
    toLearn: cap(src.description),
    successMetric: cap(src.hypothesis?.successMetric),
    ...(experiment ? { experiment } : {}),
    status: "drafted",
    raisedAt: today,
    sourceRef: src.sourceRef,
  };
}

/* ── A source's test ─────────────────────────────────────────────────── */

export type LinkedTest =
  | { state: "none" }
  | { state: "testing"; hypothesisId: string; status: "drafted" | "running" }
  | {
      state: "tested";
      hypothesisId: string;
      result: "validated" | "invalidated" | "inconclusive";
    };

/** The source item's link to a hypothesis, if it was sent to one. */
export function hypothesisLink(links: readonly HandoffLink[] | undefined): HandoffLink | undefined {
  return (links ?? []).find((l) => l.route === "hypothesis");
}

/**
 * Where a source item's test stands, read from the tracker's list: not
 * sent (or its hypothesis is gone), being tested, or tested with a result.
 * A riskiest assumption, an experiment and a Cynefin item all read theirs
 * this way.
 */
export function linkedTest(
  links: readonly HandoffLink[] | undefined,
  hypotheses: readonly Pick<Hypothesis, "id" | "status">[] | undefined
): LinkedTest {
  const link = hypothesisLink(links);
  if (!link) return { state: "none" };
  const h = (hypotheses ?? []).find((x) => x.id === link.targetId);
  if (!h) return { state: "none" };
  if (h.status === "validated" || h.status === "invalidated" || h.status === "inconclusive") {
    return { state: "tested", hypothesisId: h.id, result: h.status };
  }
  return {
    state: "testing",
    hypothesisId: h.id,
    status: h.status === "running" ? "running" : "drafted",
  };
}

/**
 * The tracker document with `h` saved: a new hypothesis goes first (newest
 * first, as the page and the hand-off add them), a known id is replaced in
 * place. Other fields of the document are kept.
 */
export function withHypothesis(doc: HypothesisTracker | null, h: Hypothesis): HypothesisTracker {
  const list = doc?.hypotheses ?? [];
  const known = list.some((x) => x.id === h.id);
  return {
    ...(doc ?? {}),
    id: HYPOTHESIS_TRACKER_ID,
    hypotheses: known ? list.map((x) => (x.id === h.id ? h : x)) : [h, ...list],
  };
}

/* ── The form ────────────────────────────────────────────────────────── */

/** The page's draft: what the inputs hold, as typed. */
export interface HypothesisDraft {
  believe: string;
  willDo: string;
  toLearn: string;
  successMetric: string;
  experiment: string;
  description: string;
  /** What the test showed, in words. */
  outcome: string;
  status: HypothesisStatus;
  /** YYYY-MM-DD; can be backdated. */
  raisedAt: string;
  /** YYYY-MM-DD; used when the status has a result. */
  resolvedAt: string;
  /** Blank: no numeric target. */
  direction: MetricDirection | "";
  targetValue: string;
  unit: string;
  baseline: string;
  /** The measured result, as typed. */
  actual: string;
}

export type HypothesisField = keyof HypothesisDraft;

/**
 * The checked values. Every optional key is present (undefined when blank
 * or cleared), so `applyHypothesisValues` can drop what was removed.
 */
export interface HypothesisValues {
  believe: string;
  willDo: string;
  toLearn: string;
  successMetric: string;
  experiment: string | undefined;
  description: string | undefined;
  outcome: string | undefined;
  status: HypothesisStatus;
  raisedAt: string;
  resolvedAt: string | undefined;
  target: HypothesisTarget | undefined;
  actual: number | undefined;
}

/** A blank form for a new hypothesis, raised today. */
export function emptyHypothesisDraft(today: string): HypothesisDraft {
  return {
    believe: "",
    willDo: "",
    toLearn: "",
    successMetric: "",
    experiment: "",
    description: "",
    outcome: "",
    status: "drafted",
    raisedAt: today,
    resolvedAt: "",
    direction: "",
    targetValue: "",
    unit: "",
    baseline: "",
    actual: "",
  };
}

const numText = (n: number | undefined) =>
  typeof n === "number" && Number.isFinite(n) ? String(n) : "";

/** The form for a saved hypothesis (an older row's day-and-time stamps read as their day). */
export function hypothesisDraftFrom(h: Hypothesis): HypothesisDraft {
  return {
    believe: h.believe ?? "",
    willDo: h.willDo ?? "",
    toLearn: h.toLearn ?? "",
    successMetric: h.successMetric ?? "",
    experiment: h.experiment ?? "",
    description: h.description ?? "",
    outcome: h.outcome ?? "",
    status: h.status,
    raisedAt: (h.raisedAt ?? "").slice(0, 10),
    resolvedAt: (h.resolvedAt ?? "").slice(0, 10),
    direction: h.target?.direction ?? "",
    targetValue: numText(h.target?.value),
    unit: h.target?.unit ?? "",
    baseline: numText(h.target?.baseline),
    actual: numText(h.actual),
  };
}

const TEXT_FIELDS = [
  "believe",
  "willDo",
  "toLearn",
  "successMetric",
  "experiment",
  "description",
  "outcome",
] as const;
type TextField = (typeof TEXT_FIELDS)[number];

const REQUIRED_MESSAGES: Record<"believe" | "willDo" | "toLearn" | "successMetric", string> = {
  believe: "Say what you believe, e.g. “teams will pay for a weekly report”.",
  willDo: "Say what you'll do to test it.",
  toLearn: "Say what you want to learn.",
  successMetric: "Say what result counts as success.",
};

/** A whole YYYY-MM-DD day that exists ("2026-02-30" doesn't, nor does a timestamp). */
export function isDay(value: string | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && isIsoDate(value);
}

/**
 * Why a typed day can't be used, or null. A day `kept` from the saved row
 * isn't judged against `latest` again: it was checked when it was written,
 * and an agent over MCP may have stamped the user's today (the server's
 * tomorrow, see tool.hypothesis_tracker's latestDay) while it is still the
 * page's yesterday.
 */
function dayError(
  day: string,
  latest: string,
  blank: string,
  future: string,
  kept = false
): string | null {
  if (!day.trim()) return blank;
  if (!isDay(day)) return "Pick a date from the calendar.";
  return day > latest && !kept ? future : null;
}

/** A saved row's day as the form holds it ("" when it has none). */
const storedDay = (value: string | undefined) => (value ?? "").slice(0, 10);

/**
 * Check the page's form.
 *
 * - "We believe" is always needed. A new hypothesis needs every line; a
 *   saved one can't have a line cleared, but a hand-off draft's blank
 *   "what we'll do" or success metric may stay blank while it is drafted
 *   (it reads "Needs detail") and is needed once the status moves on.
 *   What to learn may stay blank on a saved row that never had it.
 * - Text is capped at HYPOTHESIS_TEXT_MAX; a longer text saved before is
 *   kept while it is unchanged (`opts.stored`).
 * - Days are YYYY-MM-DD, never after `today` (the latest day allowed); a
 *   result's day is needed once the status has one, not before the day it
 *   was raised. Only the days an edit changes are judged: a saved row's day
 *   left as it is stays valid after `today`, and the two days' order is
 *   checked once either of them changes.
 * - A target is a direction and a number; a baseline must be on the far
 *   side of it (below a rise's target, above a fall's). A measured result
 *   needs a target to be compared with.
 */
export function validateHypothesis(
  d: HypothesisDraft,
  today: string,
  opts: { stored?: Hypothesis } = {}
): Validation<HypothesisValues, HypothesisField> {
  const stored = opts.stored;
  const errors: FormErrors<HypothesisField> = {};
  const statusChanged = !stored || stored.status !== d.status;

  if (!(HYPOTHESIS_STATUSES as readonly string[]).includes(d.status)) {
    errors.status = "Pick a status.";
  }

  const text = {} as Record<TextField, string>;
  for (const key of TEXT_FIELDS) {
    const value = (d[key] ?? "").trim();
    const kept = stored ? ((stored[key] as string | undefined) ?? "").trim() : "";
    text[key] = value;
    if (value.length > HYPOTHESIS_TEXT_MAX && value !== kept) {
      errors[key] = `Keep it to ${HYPOTHESIS_TEXT_MAX} characters or fewer.`;
    }
  }

  // The lines a test is described by.
  if (!text.believe) errors.believe = REQUIRED_MESSAGES.believe;
  for (const key of ["willDo", "successMetric"] as const) {
    if (text[key]) continue;
    const wasBlank = stored !== undefined && isBlank(stored[key]);
    // A hand-off draft's blank line may stay blank while drafted, and while
    // a saved row keeps the status it had.
    if (wasBlank && (d.status === "drafted" || !statusChanged)) continue;
    errors[key] = wasBlank
      ? `${REQUIRED_MESSAGES[key]} A test needs it before it runs.`
      : REQUIRED_MESSAGES[key];
  }
  if (!text.toLearn && !(stored !== undefined && isBlank(stored.toLearn))) {
    errors.toLearn = REQUIRED_MESSAGES.toLearn;
  }

  // Days. One the saved row already has is kept as it is (see dayError).
  const raisedKept = stored !== undefined && d.raisedAt === storedDay(stored.raisedAt);
  const resolvedKept = stored !== undefined && d.resolvedAt === storedDay(stored.resolvedAt);
  const raisedError = dayError(
    d.raisedAt,
    today,
    "Pick the day it was raised.",
    "It can't be raised on a day that hasn't happened yet.",
    raisedKept
  );
  if (raisedError) errors.raisedAt = raisedError;
  const resolved = isResolved(d.status);
  if (resolved) {
    const resolvedError = dayError(
      d.resolvedAt,
      today,
      "Pick the day the test gave its result.",
      "The result can't come on a day that hasn't happened yet.",
      resolvedKept
    );
    if (resolvedError) errors.resolvedAt = resolvedError;
    else if (!raisedError && !(raisedKept && resolvedKept) && d.resolvedAt < d.raisedAt) {
      errors.resolvedAt = "The result can't come before the day it was raised.";
    }
  }

  // Target and result.
  const value = parseNumber(d.targetValue);
  const baseline = parseNumber(d.baseline);
  const actual = parseNumber(d.actual);
  const unit = d.unit.trim();
  let target: HypothesisTarget | undefined;
  if (!d.direction) {
    if (value !== undefined || baseline !== undefined) {
      errors.direction = "Pick whether the number should rise or fall.";
    }
  } else if (value === undefined) {
    errors.targetValue = "Enter the number that counts as success.";
  } else if (!Number.isFinite(value)) {
    errors.targetValue = "Enter a number.";
  }
  if (baseline !== undefined && !Number.isFinite(baseline)) errors.baseline = "Enter a number.";
  if (unit.length > HYPOTHESIS_UNIT_MAX) {
    errors.unit = `Keep the unit to ${HYPOTHESIS_UNIT_MAX} characters or fewer.`;
  }
  if (
    d.direction &&
    value !== undefined &&
    Number.isFinite(value) &&
    baseline !== undefined &&
    Number.isFinite(baseline)
  ) {
    if (d.direction === "increase" && value <= baseline) {
      errors.targetValue = `To count as a rise, the target must be above the baseline (${formatMetric(baseline, unit)}).`;
    } else if (d.direction === "decrease" && value >= baseline) {
      errors.targetValue = `To count as a fall, the target must be below the baseline (${formatMetric(baseline, unit)}).`;
    }
  }
  if (d.direction && value !== undefined && Number.isFinite(value)) {
    target = {
      direction: d.direction,
      value,
      ...(unit ? { unit } : {}),
      ...(baseline !== undefined && Number.isFinite(baseline) ? { baseline } : {}),
    };
  }
  if (actual !== undefined) {
    if (!Number.isFinite(actual)) errors.actual = "Enter a number.";
    else if (!d.direction) {
      errors.actual = "Set a target first, so the result has something to compare with.";
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const optional = (s: string) => s || undefined;
  return {
    ok: true,
    values: {
      believe: text.believe,
      willDo: text.willDo,
      toLearn: text.toLearn,
      successMetric: text.successMetric,
      experiment: optional(text.experiment),
      description: optional(text.description),
      outcome: optional(text.outcome),
      status: d.status,
      raisedAt: d.raisedAt,
      resolvedAt: resolved ? d.resolvedAt : undefined,
      target,
      actual: target && actual !== undefined ? actual : undefined,
    },
  };
}

/**
 * The hypothesis saved with checked values: `base` keeps its id, sourceRef
 * and any field the form doesn't hold; a value left blank removes its key.
 */
export function applyHypothesisValues(
  base: Pick<Hypothesis, "id"> & Partial<Hypothesis>,
  values: HypothesisValues
): Hypothesis {
  const next = { ...base, ...values } as Hypothesis & Record<string, unknown>;
  for (const key of Object.keys(values) as (keyof HypothesisValues)[]) {
    if (values[key] === undefined) delete next[key];
  }
  return next;
}
