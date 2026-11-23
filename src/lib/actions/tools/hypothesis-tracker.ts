/**
 * Hypothesis Tracker — tool-local actions.
 *
 * Category: Product Discovery (squad S5)
 * Tool:     Lean-startup hypotheses (believe / will do / to learn / success
 *           metric) with a validation lifecycle, a numeric target and the
 *           measured result.
 *
 * Agent surface: tool.hypothesis_tracker.*
 * Backing CRUD : workspace.hypothesis_tracker.* (auto-generated). Singleton:
 *                one HypothesisTracker document (hypotheses[]) under a fixed id.
 *
 *   1. list_state       — byStatus, the validation rate over decisive results
 *                         (null with none), the verdict, and per hypothesis
 *                         what it still needs and the verdict its result
 *                         suggests.
 *   2. add_hypothesis   — log a hypothesis, first in the list, checked as the
 *                         page's form checks it (backdating, a target).
 *   3. update_hypothesis — edit its lines, raised day and target, as the
 *                         page's edit form does: how a hand-off draft gets
 *                         what we'll do, the success metric and a target.
 *   4. set_status       — move through the lifecycle; stamps resolvedAt (a
 *                         day that can be backdated) on a result. A hand-off
 *                         draft needs its missing lines before it moves on.
 *   5. record_result    — the measured number; returns the suggested
 *                         verdict and never applies it.
 *   Value checks (P2.5): did the shipped work deliver?
 *   6. list_value_candidates — stories done and epics finished in the
 *                         last 90 days that no hypothesis checks yet.
 *   7. add_value_check  — a running hypothesis that follows one, measured
 *                         by a metric, a key result or in words, read some
 *                         days after it shipped (checked as the page's
 *                         "Check its value" form checks it).
 *   8. set_measured_by  — how any hypothesis is measured, or none.
 *   9. read_measure     — what "Read the metric" would record (read only;
 *                         record_result writes it).
 *  10. use_ab_result    — its linked A/B test's result into what we learned,
 *                         and the measured number when the test is in.
 *
 * Every rule comes from lib/hypotheses (the page uses it too). Entity kind
 * "workspace:hypothesisTracker" + the fixed HYPOTHESIS_TRACKER_ID match
 * hypothesis-tracker-client.tsx, so MCP writes round-trip into the UI.
 */

import { z } from "zod";
import { nanoid } from "nanoid";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverListEntities, serverUpsertEntity } from "../server-store";
import type {
  AbTest,
  EpicRoadmap,
  Hypothesis,
  HypothesisMeasuredBy,
  HypothesisStatus,
  HypothesisTracker,
  Okr,
  ProductMetric,
  Story,
} from "@/lib/stores/workspace-types";
import {
  AB_TEST_KIND,
  MEASURED_BY_KINDS,
  PRODUCT_METRIC_KIND,
  SHIPPED_KINDS,
} from "@/lib/stores/workspace-types";
import { EPIC_ROADMAP_ID } from "@/lib/roadmap/epic-source";
import { testForHypothesis } from "@/lib/experiments/model";
import {
  AB_RESULT_REASON,
  DEFAULT_LOOK_AFTER,
  MEASURED_NOTE_MAX,
  SHIPPED_TITLE_MAX,
  VALUE_CHECK_DAYS,
  abResultUpdate,
  applyValueCheck,
  isDue,
  isValueCheck,
  keyResultRef,
  measuredByOf,
  readMeasure,
  shippedCandidates,
  validateValueCheck,
  valueCheckDraft,
  valueSummary,
  withMeasuredBy,
  type ValueCheckDraft,
  type ValueCheckField,
  type ValueCheckSources,
} from "@/lib/hypotheses/value";
import { todayLocalISO } from "@/lib/utils/formatters";
import { isExampleId } from "@/lib/utils/example-id";
import type { FormErrors } from "@/lib/utils/form";
import { addDays } from "@/lib/impediments/model";
import {
  HYPOTHESIS_STATUSES,
  HYPOTHESIS_TEXT_MAX,
  HYPOTHESIS_TRACKER_ID,
  HYPOTHESIS_UNIT_MAX,
  applyHypothesisValues,
  hypothesisDraftFrom,
  hypothesisVerdict,
  isDay,
  isResolved,
  missingFields,
  suggestVerdict,
  suggestionText,
  validateHypothesis,
  validationRate,
  withHypothesis,
  type HypothesisDraft,
  type HypothesisField,
} from "@/lib/hypotheses/model";

/** MUST match registerCollection("hypothesisTracker", …) in workspace-store.ts. */
const KIND_HT = "workspace:hypothesisTracker";

const StatusSchema = z.enum(HYPOTHESIS_STATUSES);
const IsoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const Text = z.string().min(1).max(HYPOTHESIS_TEXT_MAX);
const TargetSchema = z.object({
  direction: z
    .enum(["increase", "decrease"])
    .describe("increase: success is at least value; decrease: at most value."),
  value: z.number().finite(),
  unit: z
    .string()
    .max(HYPOTHESIS_UNIT_MAX)
    .optional()
    .describe('Shown after numbers: "%", "sign-ups".'),
  baseline: z
    .number()
    .finite()
    .optional()
    .describe(
      "Where the metric stood before the test: below value for increase, above it for decrease."
    ),
});

const ws = () => useWorkspaceStore.getState();

const round2 = (n: number) => Math.round(n * 100) / 100;

/* ── The store adapter ───────────────────────────────────────────────── */

interface TrackerStore {
  get(): Promise<HypothesisTracker | null>;
  put(doc: HypothesisTracker): Promise<void>;
  /** What value checks are read against: the product metrics and the OKRs (read only). */
  sources(): Promise<ValueCheckSources>;
  /** The A/B tests, read live (the A/B Calculator writes them). */
  tests(): Promise<AbTest[]>;
  /** The shipped work value checks follow: the stories and the epic roadmap (read only). */
  work(): Promise<{ stories: Story[]; roadmaps: EpicRoadmap[] }>;
  /** Over MCP the server's day may be behind the user's (see latestDay). */
  onServer: boolean;
}

/** The other tools' entity kinds the value checks read. */
const KIND_OKR = "workspace:okr";
const KIND_STORY = "workspace:story";
const KIND_EPIC_ROADMAP = "workspace:epicRoadmap";

const browserStore: TrackerStore = {
  get: async () =>
    (ws().hypothesisTrackers ?? []).find((d) => d.id === HYPOTHESIS_TRACKER_ID) ?? null,
  put: async (doc) => ws().upsertHypothesisTracker(doc),
  sources: async () => ({ metrics: ws().productMetrics ?? [], okrs: ws().okrs ?? [] }),
  tests: async () => ws().abTests ?? [],
  work: async () => ({ stories: ws().stories ?? [], roadmaps: ws().epicRoadmaps ?? [] }),
  onServer: false,
};

function serverStore(userId: string): TrackerStore {
  return {
    get: async () =>
      (await serverGetEntity<HypothesisTracker>(userId, KIND_HT, HYPOTHESIS_TRACKER_ID)) ?? null,
    put: async (doc) => {
      await serverUpsertEntity<HypothesisTracker>(userId, KIND_HT, doc);
    },
    sources: async () => {
      const [metrics, okrs] = await Promise.all([
        serverListEntities<ProductMetric>(userId, PRODUCT_METRIC_KIND),
        serverListEntities<Okr>(userId, KIND_OKR),
      ]);
      return { metrics, okrs };
    },
    tests: () => serverListEntities<AbTest>(userId, AB_TEST_KIND),
    work: async () => {
      const [stories, roadmap] = await Promise.all([
        serverListEntities<Story>(userId, KIND_STORY),
        serverGetEntity<EpicRoadmap>(userId, KIND_EPIC_ROADMAP, EPIC_ROADMAP_ID),
      ]);
      return { stories, roadmaps: roadmap ? [roadmap] : [] };
    },
    onServer: true,
  };
}

/**
 * The latest day a verb takes: today in the browser; on the server, whose
 * day (UTC on a typical deploy) can be behind the user's, the day after,
 * as the Decision Log's verbs allow.
 */
const latestDay = (today: string, onServer: boolean) => (onServer ? addDays(today, 1) : today);

/* ── list_state ──────────────────────────────────────────────────────── */

function summarize(doc: HypothesisTracker | null) {
  const hypotheses = doc?.hypotheses ?? [];
  // Example rows are the page's demo: every count leaves them out, as the
  // rate does, so one reply never gives two totals. They stay listed.
  const real = hypotheses.filter((h) => !isExampleId(h.id));
  const byStatus: Record<HypothesisStatus, number> = {
    drafted: 0,
    running: 0,
    validated: 0,
    invalidated: 0,
    inconclusive: 0,
  };
  for (const h of real) if (h.status in byStatus) byStatus[h.status] += 1;
  const rate = validationRate(real);
  const today = todayLocalISO();
  const value = valueSummary(real, today);
  return {
    exists: doc !== null,
    total: real.length,
    examples: hypotheses.length - real.length,
    byStatus,
    decisive: rate.decisive,
    inconclusive: rate.inconclusive,
    validationRate: rate.rate === null ? null : round2(rate.rate),
    verdict: hypothesisVerdict(rate),
    needsDetail: real.filter((h) => missingFields(h).length > 0).length,
    valueChecks: {
      total: value.total,
      open: value.open,
      due: value.due,
      validated: value.validated,
      invalidated: value.invalidated,
      inconclusive: value.inconclusive,
      rate: value.rate === null ? null : round2(value.rate),
    },
    hypotheses: hypotheses.map((h) => ({
      ...h,
      missing: missingFields(h),
      suggestedVerdict: suggestVerdict(h),
      suggestion: suggestionText(h),
      valueCheck: isValueCheck(h) ? { due: isDue(h, today), checkOn: h.checkOn ?? null } : null,
    })),
  };
}

registry.register({
  id: "tool.hypothesis_tracker.list_state",
  toolId: "tool.hypothesis_tracker",
  name: "list_state",
  category: "read",
  description:
    "Summarise hypotheses, as the page does. Example rows (ids starting 'example-') are the page's demo: every count and the verdict leave them out, and they are still listed in hypotheses. Returns {exists, total (hypotheses without the examples), examples (how many example rows), byStatus: {drafted, running, validated, invalidated, inconclusive}, decisive (validated + invalidated), inconclusive, validationRate (0..1, validated over decisive; null while no result is decisive; inconclusive results aren't counted), verdict (one sentence), needsDetail (hypotheses missing what we'll do or the success metric, e.g. hand-off drafts: fill them with update_hypothesis), hypotheses: each stored row plus missing ('willDo' | 'successMetric')[], suggestedVerdict ({verdict: 'validated' | 'invalidated', met, margin (actual − target, positive = better), moved? (actual − baseline)} or null without a target and a measured actual) and suggestion (that in words, or null) and valueCheck ({due, checkOn} for a value check, a hypothesis that follows shipped work, whose stored shipped, checkOn and measuredBy are in the row; else null), valueChecks: {total, open, due (open, on or past checkOn, no measured result), validated, invalidated, inconclusive, rate (validated over decisive value checks; null with none)}}. A suggestion is never applied: set_status does that.",
  paramsSchema: z.object({}),
  handler: async () => summarize(await browserStore.get()),
  mcpHandler: async (_params, ctx) => summarize(await serverStore(ctx.userId).get()),
});

/* ── add_hypothesis ──────────────────────────────────────────────────── */

const AddSchema = z.object({
  believe: Text.describe("We believe … (without the words 'We believe')."),
  willDo: Text.describe("What we'll do to test it."),
  toLearn: Text,
  successMetric: Text.describe("What counts as success, in words."),
  experiment: z.string().max(HYPOTHESIS_TEXT_MAX).optional(),
  description: z.string().max(HYPOTHESIS_TEXT_MAX).optional(),
  outcome: z.string().max(HYPOTHESIS_TEXT_MAX).optional().describe("What the test showed."),
  status: StatusSchema.optional(),
  raisedAt: IsoDay.optional().describe(
    "The user's local day it was raised (backdated; default today; not in the future)."
  ),
  resolvedAt: IsoDay.optional().describe(
    "With a status that has a result: the day of the result (default today; not before raisedAt, not in the future)."
  ),
  target: TargetSchema.optional(),
  actual: z
    .number()
    .finite()
    .optional()
    .describe("The measured result, in target.unit; needs a target."),
});
type AddParams = z.infer<typeof AddSchema>;

/** The agent's param names for the form's target fields. */
const PARAM_OF: Partial<Record<HypothesisField, string>> = {
  direction: "target.direction",
  targetValue: "target.value",
  baseline: "target.baseline",
  unit: "target.unit",
};

/** The form's errors under the agent's param names. */
function paramErrors(errors: FormErrors<HypothesisField>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(errors).map(([k, v]) => [PARAM_OF[k as HypothesisField] ?? k, v ?? ""])
  );
}

/** The params as the page's form would hold them, so validateHypothesis judges both alike. */
function draftOf(p: AddParams, today: string): HypothesisDraft {
  const status = p.status ?? "drafted";
  const raisedAt = p.raisedAt ?? today;
  return {
    believe: p.believe,
    willDo: p.willDo,
    toLearn: p.toLearn,
    successMetric: p.successMetric,
    experiment: p.experiment ?? "",
    description: p.description ?? "",
    outcome: p.outcome ?? "",
    status,
    raisedAt,
    // A result's day defaults to today, or the day it was raised when that
    // is later (over MCP the user's today can be the server's tomorrow).
    resolvedAt: isResolved(status) ? (p.resolvedAt ?? (raisedAt > today ? raisedAt : today)) : "",
    direction: p.target?.direction ?? "",
    targetValue: p.target ? String(p.target.value) : "",
    unit: p.target?.unit ?? "",
    baseline: p.target?.baseline !== undefined ? String(p.target.baseline) : "",
    actual: p.actual !== undefined ? String(p.actual) : "",
  };
}

async function addHypothesis(store: TrackerStore, p: AddParams) {
  const today = todayLocalISO();
  const status = p.status ?? "drafted";
  if (p.resolvedAt !== undefined && !isResolved(status)) {
    return {
      added: false,
      reason: "invalid",
      errors: {
        resolvedAt:
          "Only a status with a result (validated, invalidated, inconclusive) has a result's day.",
      },
    };
  }
  const checked = validateHypothesis(draftOf(p, today), latestDay(today, store.onServer));
  if (!checked.ok) return { added: false, reason: "invalid", errors: paramErrors(checked.errors) };
  const h = applyHypothesisValues({ id: nanoid(8) }, checked.values);
  await store.put(withHypothesis(await store.get(), h));
  return { added: true, id: h.id, suggestedVerdict: suggestVerdict(h) };
}

registry.register({
  id: "tool.hypothesis_tracker.add_hypothesis",
  toolId: "tool.hypothesis_tracker",
  name: "add_hypothesis",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add a hypothesis (We believe ___ / will do ___ / to learn ___ / success = ___), first in the list as on the page. status defaults to 'drafted'; raisedAt to today (YYYY-MM-DD, the user's local day; backdating is fine, the future isn't: over MCP the day after the server's is taken, as the server's day may be behind the user's). A status with a result stamps resolvedAt (default today; not before raisedAt). Optional target {direction: increase | decrease, value, unit?, baseline? (below value for increase, above it for decrease)} and actual (needs a target). Text up to 2000 characters. Creates the tracker if absent. Returns {added: true, id, suggestedVerdict} or {added: false, reason: 'invalid', errors: {field: message}}.",
  paramsSchema: AddSchema,
  handler: async (params) => addHypothesis(browserStore, params),
  mcpHandler: async (params, ctx) => addHypothesis(serverStore(ctx.userId), params),
});

/* ── update_hypothesis ───────────────────────────────────────────────── */

/** An optional line: a string sets it, null or "" clears it. */
const OptionalText = z.string().max(HYPOTHESIS_TEXT_MAX).nullable().optional();

const UpdateSchema = z.object({
  hypothesisId: z.string(),
  believe: z
    .string()
    .max(HYPOTHESIS_TEXT_MAX)
    .optional()
    .describe("We believe … (without the words 'We believe')."),
  willDo: z.string().max(HYPOTHESIS_TEXT_MAX).optional().describe("What we'll do to test it."),
  toLearn: z.string().max(HYPOTHESIS_TEXT_MAX).optional(),
  successMetric: z
    .string()
    .max(HYPOTHESIS_TEXT_MAX)
    .optional()
    .describe("What counts as success, in words."),
  experiment: OptionalText,
  description: OptionalText,
  outcome: OptionalText.describe("What the test showed; null clears it."),
  raisedAt: IsoDay.optional().describe(
    "The user's local day it was raised (backdated; not in the future; not after its result's day)."
  ),
  target: TargetSchema.nullable()
    .optional()
    .describe("The number the test aims for; null clears it (and needs no measured result)."),
});
type UpdateParams = z.infer<typeof UpdateSchema>;

/** The fields update_hypothesis edits: one of them must be given. */
const UPDATE_FIELDS = [
  "believe",
  "willDo",
  "toLearn",
  "successMetric",
  "experiment",
  "description",
  "outcome",
  "raisedAt",
  "target",
] as const;

/**
 * The saved row as the page's edit form opens it, with the params typed
 * over it: validateHypothesis then judges what changed as the page does
 * (a day or a long text left alone is kept; a hand-off draft's blank line
 * may stay blank while it is drafted).
 */
function editedDraft(h: Hypothesis, p: UpdateParams): HypothesisDraft {
  const d = hypothesisDraftFrom(h);
  for (const key of ["believe", "willDo", "toLearn", "successMetric"] as const) {
    if (p[key] !== undefined) d[key] = p[key];
  }
  for (const key of ["experiment", "description", "outcome"] as const) {
    if (p[key] !== undefined) d[key] = p[key] ?? "";
  }
  if (p.raisedAt !== undefined) d.raisedAt = p.raisedAt;
  if (p.target !== undefined) {
    d.direction = p.target?.direction ?? "";
    d.targetValue = p.target ? String(p.target.value) : "";
    d.unit = p.target?.unit ?? "";
    d.baseline = p.target?.baseline !== undefined ? String(p.target.baseline) : "";
  }
  return d;
}

async function updateHypothesis(store: TrackerStore, p: UpdateParams) {
  if (!UPDATE_FIELDS.some((key) => p[key] !== undefined)) {
    return { updated: false, reason: "nothing_to_update" };
  }
  const doc = await store.get();
  const h = doc?.hypotheses.find((x) => x.id === p.hypothesisId);
  if (!doc || !h) return { updated: false, reason: "not_found" };
  const draft = editedDraft(h, p);
  const checked = validateHypothesis(draft, latestDay(todayLocalISO(), store.onServer), {
    stored: h,
  });
  if (!checked.ok) {
    const errors = paramErrors(checked.errors);
    // The measured number isn't a param here: say which verb clears it.
    if (errors.actual && !draft.direction) {
      errors.actual =
        "It has a measured result, which needs a target to compare with: give it a target, or clear the result first with record_result (actual: null).";
    }
    return { updated: false, reason: "invalid", errors };
  }
  const next = applyHypothesisValues(h, checked.values);
  await store.put(withHypothesis(doc, next));
  return {
    updated: true,
    id: next.id,
    missing: missingFields(next),
    suggestedVerdict: suggestVerdict(next),
  };
}

registry.register({
  id: "tool.hypothesis_tracker.update_hypothesis",
  toolId: "tool.hypothesis_tracker",
  name: "update_hypothesis",
  category: "write",
  requiresConfirmation: false,
  description:
    "Edit a hypothesis in place, as the page's edit form does; how a hand-off draft (from Riskiest Assumption, the Opportunity Tree, Cynefin or a Design Sprint) gets what we'll do, its success metric and a target before set_status moves it on. Params: hypothesisId, and any of believe, willDo, toLearn, successMetric (each up to 2000 characters; a line the saved row has can't be cleared), experiment, description, outcome (null or '' clears), raisedAt (YYYY-MM-DD, backdated; not in the future, not after its result's day), target ({direction: increase | decrease, value, unit?, baseline? (below value for increase, above it for decrease)}, or null to clear it). Only what changes is judged: a day or a longer text the row already has is kept. The status and its result's day go through set_status, the measured number through record_result. Returns {updated: true, id, missing ('willDo' | 'successMetric')[] (empty once it can run), suggestedVerdict} or {updated: false, reason: 'nothing_to_update' | 'not_found' | 'invalid' (with errors: {param: message})}.",
  paramsSchema: UpdateSchema,
  handler: async (params) => updateHypothesis(browserStore, params),
  mcpHandler: async (params, ctx) => updateHypothesis(serverStore(ctx.userId), params),
});

/* ── set_status ──────────────────────────────────────────────────────── */

const SetStatusSchema = z.object({
  hypothesisId: z.string(),
  status: StatusSchema,
  resolvedAt: IsoDay.optional().describe(
    "With a status that has a result: its day (backdated; default the day already stamped, else today; not before raisedAt, not in the future)."
  ),
});

async function setStatus(store: TrackerStore, p: z.infer<typeof SetStatusSchema>) {
  const doc = await store.get();
  const h = doc?.hypotheses.find((x) => x.id === p.hypothesisId);
  if (!doc || !h) return { updated: false, reason: "not_found" };
  // A hand-off draft can't run (or be judged) without what we'll do and
  // the success metric; it can stay drafted, and a status it already had is kept.
  if (p.status !== h.status && p.status !== "drafted") {
    const missing = missingFields(h);
    if (missing.length > 0) {
      return {
        updated: false,
        reason: "needs_detail",
        missing,
        message: `Fill ${missing.join(" and ")} with update_hypothesis first.`,
      };
    }
  }
  let next: Hypothesis;
  if (isResolved(p.status)) {
    const today = todayLocalISO();
    const latest = latestDay(today, store.onServer);
    const raised = (h.raisedAt ?? "").slice(0, 10);
    if (p.resolvedAt !== undefined) {
      if (!isDay(p.resolvedAt)) return { updated: false, reason: "not_a_day" };
      if (p.resolvedAt > latest) return { updated: false, reason: "future_day" };
      if (isDay(raised) && p.resolvedAt < raised)
        return { updated: false, reason: "before_raised" };
    }
    // Today, or the day it was raised when that is later and still allowed.
    const fallback = isDay(raised) && raised > today && raised <= latest ? raised : today;
    next = { ...h, status: p.status, resolvedAt: p.resolvedAt ?? h.resolvedAt ?? fallback };
  } else {
    if (p.resolvedAt !== undefined) return { updated: false, reason: "no_result" };
    next = { ...h, status: p.status };
    delete next.resolvedAt;
  }
  await store.put(withHypothesis(doc, next));
  return {
    updated: true,
    status: next.status,
    ...(next.resolvedAt ? { resolvedAt: next.resolvedAt } : {}),
  };
}

registry.register({
  id: "tool.hypothesis_tracker.set_status",
  toolId: "tool.hypothesis_tracker",
  name: "set_status",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set a hypothesis's status (drafted | running | validated | invalidated | inconclusive). A status with a result stamps resolvedAt: the resolvedAt param (YYYY-MM-DD, backdated; not before raisedAt; not in the future), else the day already stamped, else today; moving back to drafted or running clears it. A hypothesis missing what we'll do or its success metric (a hand-off draft) stays drafted until they're filled with update_hypothesis. Returns {updated: true, status, resolvedAt?} or {updated: false, reason: 'not_found' | 'needs_detail' (with missing and a message) | 'not_a_day' | 'future_day' | 'before_raised' | 'no_result' (resolvedAt with a status that has no result)}.",
  paramsSchema: SetStatusSchema,
  handler: async (params) => setStatus(browserStore, params),
  mcpHandler: async (params, ctx) => setStatus(serverStore(ctx.userId), params),
});

/* ── record_result ───────────────────────────────────────────────────── */

const RecordSchema = z.object({
  hypothesisId: z.string(),
  actual: z
    .number()
    .finite()
    .nullable()
    .describe("The measured result, in the target's unit; null clears it."),
});

async function recordResult(store: TrackerStore, p: z.infer<typeof RecordSchema>) {
  const doc = await store.get();
  const h = doc?.hypotheses.find((x) => x.id === p.hypothesisId);
  if (!doc || !h) return { updated: false, reason: "not_found" };
  if (p.actual !== null && !h.target) {
    return {
      updated: false,
      reason: "no_target",
      message:
        "Give it a target with update_hypothesis first, so the result has something to compare with.",
    };
  }
  const next: Hypothesis = { ...h };
  if (p.actual === null) delete next.actual;
  else next.actual = p.actual;
  await store.put(withHypothesis(doc, next));
  return {
    updated: true,
    actual: p.actual,
    suggestedVerdict: suggestVerdict(next),
    suggestion: suggestionText(next),
  };
}

registry.register({
  id: "tool.hypothesis_tracker.record_result",
  toolId: "tool.hypothesis_tracker",
  name: "record_result",
  category: "write",
  requiresConfirmation: false,
  description:
    "Record the measured result of a hypothesis with a target (null clears it). Returns the verdict it suggests (target met → validated, missed → invalidated) without applying it: the status changes only through set_status, once the user agrees. Returns {updated: true, actual, suggestedVerdict: {verdict, met, margin, moved?} | null, suggestion} or {updated: false, reason: 'not_found' | 'no_target' (give it one with update_hypothesis; with a message)}.",
  paramsSchema: RecordSchema,
  handler: async (params) => recordResult(browserStore, params),
  mcpHandler: async (params, ctx) => recordResult(serverStore(ctx.userId), params),
});

/* ── Value checks (P2.5) ─────────────────────────────────────────────── */

const MeasuredBySchema = z
  .object({
    kind: z.enum(MEASURED_BY_KINDS),
    metricId: z
      .string()
      .max(200)
      .optional()
      .describe("With kind metric: a product metric's id (workspace.product_metric.list)."),
    okrId: z.string().max(200).optional().describe("With kind key-result: the objective's id."),
    keyResultId: z
      .string()
      .max(200)
      .optional()
      .describe("With kind key-result: the key result's id."),
    note: z
      .string()
      .max(MEASURED_NOTE_MAX)
      .optional()
      .describe("With kind words: how you'll tell, in words."),
  })
  .describe(
    "How it is measured: a product metric (metricId), a key result (okrId and keyResultId) or in words (note)."
  );

/** The measure params as the form holds them, so measuredByOf judges both alike. */
const measureDraftOf = (m: z.infer<typeof MeasuredBySchema>) => ({
  measuredKind: m.kind,
  metricId: m.metricId ?? "",
  keyResult: m.okrId && m.keyResultId ? keyResultRef(m.okrId, m.keyResultId) : "",
  note: m.note ?? "",
});

/** The form's value-check errors under the agent's param names. */
const VALUE_PARAM_OF: Partial<Record<ValueCheckField, string>> = {
  shippedOn: "doneAt",
  lookAfter: "lookAfterDays",
  measuredKind: "measuredBy.kind",
  metricId: "measuredBy.metricId",
  keyResult: "measuredBy.keyResultId",
  note: "measuredBy.note",
  direction: "target.direction",
  targetValue: "target.value",
  baseline: "target.baseline",
  unit: "target.unit",
};

/* ── list_value_candidates ───────────────────────────────────────────── */

async function listValueCandidates(store: TrackerStore) {
  const [doc, work] = await Promise.all([store.get(), store.work()]);
  const candidates = shippedCandidates(
    { stories: work.stories, roadmaps: work.roadmaps, hypotheses: doc?.hypotheses ?? [] },
    todayLocalISO()
  );
  return { total: candidates.length, candidates };
}

registry.register({
  id: "tool.hypothesis_tracker.list_value_candidates",
  toolId: "tool.hypothesis_tracker",
  name: "list_value_candidates",
  category: "read",
  description:
    "List the shipped work a value check could follow, as the page's 'Shipped work to check' does: stories done in the last 90 days (by the day they were done) and finished epics on the Epic Roadmap (every linked story done; on the latest day one was, else doneAt null, and the user picks the day), with no hypothesis checking them yet, the newest first. Example rows are left out. Returns {total, candidates: {kind: story | epic, id, title, doneAt (YYYY-MM-DD) | null}[]}. Add one with add_value_check.",
  paramsSchema: z.object({}),
  handler: async () => listValueCandidates(browserStore),
  mcpHandler: async (_params, ctx) => listValueCandidates(serverStore(ctx.userId)),
});

/* ── add_value_check ─────────────────────────────────────────────────── */

const LookAfter = z
  .number()
  .int()
  .refine((d) => (VALUE_CHECK_DAYS as readonly number[]).includes(d), {
    message: VALUE_CHECK_DAYS.join(", "),
  });

const AddValueCheckSchema = z.object({
  kind: z.enum(SHIPPED_KINDS).describe("What shipped: a story or an epic."),
  id: z.string().min(1).max(200).describe("Its id, from list_value_candidates."),
  doneAt: IsoDay.optional().describe(
    "The day it shipped (YYYY-MM-DD): needed for an epic whose candidate has doneAt null; else it defaults to the candidate's. Not in the future."
  ),
  lookAfterDays: LookAfter.optional().describe(
    `Days after shipping to read it: ${VALUE_CHECK_DAYS.join(", ")} (default ${DEFAULT_LOOK_AFTER}). checkOn = doneAt + these days.`
  ),
  measuredBy: MeasuredBySchema,
  target: TargetSchema.optional().describe(
    "Needed when measuredBy is a metric or a key result: the number it should reach."
  ),
  believe: Text.optional().describe(
    "Default: “shipping ‘<title>’ gave people the value we expected”."
  ),
  willDo: Text.optional(),
  toLearn: Text.optional(),
  successMetric: Text.optional(),
});

async function addValueCheck(store: TrackerStore, p: z.infer<typeof AddValueCheckSchema>) {
  const today = todayLocalISO();
  const [doc, work, sources] = await Promise.all([store.get(), store.work(), store.sources()]);
  const hypotheses = doc?.hypotheses ?? [];
  if (hypotheses.some((h) => h.shipped?.kind === p.kind && h.shipped.id === p.id)) {
    return { added: false, reason: "already_checked" };
  }
  const candidate = shippedCandidates(
    { stories: work.stories, roadmaps: work.roadmaps, hypotheses },
    today
  ).find((c) => c.kind === p.kind && c.id === p.id);
  if (!candidate) {
    return {
      added: false,
      reason: "not_found",
      message:
        "Not a story done or an epic finished in the last 90 days: see list_value_candidates.",
    };
  }
  if (!candidate.doneAt && !p.doneAt) {
    return {
      added: false,
      reason: "needs_day",
      message:
        "None of this epic's stories says when it was done: give doneAt, agreed with the user.",
    };
  }
  const base = valueCheckDraft(candidate, today);
  const draft: ValueCheckDraft = {
    ...base,
    ...measureDraftOf(p.measuredBy),
    shippedOn: p.doneAt ?? candidate.doneAt ?? today,
    title: candidate.title.slice(0, SHIPPED_TITLE_MAX),
    lookAfter: p.lookAfterDays ?? DEFAULT_LOOK_AFTER,
    believe: p.believe ?? base.believe,
    willDo: p.willDo ?? base.willDo,
    toLearn: p.toLearn ?? base.toLearn,
    successMetric: p.successMetric ?? base.successMetric,
    direction: p.target?.direction ?? "",
    targetValue: p.target ? String(p.target.value) : "",
    unit: p.target?.unit ?? "",
    baseline: p.target?.baseline !== undefined ? String(p.target.baseline) : "",
  };
  const checked = validateValueCheck(draft, latestDay(today, store.onServer), sources);
  if (!checked.ok) {
    const errors = Object.fromEntries(
      Object.entries(checked.errors).map(([k, v]) => [
        VALUE_PARAM_OF[k as ValueCheckField] ?? k,
        v ?? "",
      ])
    );
    return { added: false, reason: "invalid", errors };
  }
  const h = applyValueCheck({ id: nanoid(8) }, checked.values);
  await store.put(withHypothesis(doc, h));
  return { added: true, id: h.id, checkOn: h.checkOn, shipped: h.shipped };
}

registry.register({
  id: "tool.hypothesis_tracker.add_value_check",
  toolId: "tool.hypothesis_tracker",
  name: "add_value_check",
  category: "write",
  requiresConfirmation: false,
  description:
    "Check the value of shipped work, as the page's 'Check its value' form does: a running hypothesis that follows a story or epic from list_value_candidates, first in the list. Params: kind, id, doneAt? (the ship day; needed when the candidate has none), lookAfterDays? (7, 14, 30, 60 or 90; default 30; checkOn = doneAt + these days, never before the ship day), measuredBy {kind: metric (metricId) | key-result (okrId, keyResultId) | words (note ≤200)}, target? (needed for a metric or a key result: {direction, value, unit?, baseline?}), and the four lines believe, willDo, toLearn, successMetric (each optional, pre-filled from the title as on the page). Returns {added: true, id, checkOn, shipped} or {added: false, reason: 'already_checked' | 'not_found' | 'needs_day' (with a message) | 'invalid' (with errors: {param: message})}.",
  paramsSchema: AddValueCheckSchema,
  handler: async (params) => addValueCheck(browserStore, params),
  mcpHandler: async (params, ctx) => addValueCheck(serverStore(ctx.userId), params),
});

/* ── set_measured_by ─────────────────────────────────────────────────── */

const SetMeasuredBySchema = z.object({
  hypothesisId: z.string(),
  measuredBy: MeasuredBySchema.nullable().describe("null clears it."),
});

async function setMeasuredBy(store: TrackerStore, p: z.infer<typeof SetMeasuredBySchema>) {
  const [doc, sources] = await Promise.all([store.get(), store.sources()]);
  const h = doc?.hypotheses.find((x) => x.id === p.hypothesisId);
  if (!doc || !h) return { updated: false, reason: "not_found" };
  let measuredBy: HypothesisMeasuredBy | null = null;
  if (p.measuredBy) {
    const r = measuredByOf(measureDraftOf(p.measuredBy), sources);
    if (!r.ok) {
      return {
        updated: false,
        reason: "invalid",
        errors: { [VALUE_PARAM_OF[r.field] ?? r.field]: r.error },
      };
    }
    measuredBy = r.measuredBy;
  }
  await store.put(withHypothesis(doc, withMeasuredBy(h, measuredBy)));
  return { updated: true, id: h.id, measuredBy };
}

registry.register({
  id: "tool.hypothesis_tracker.set_measured_by",
  toolId: "tool.hypothesis_tracker",
  name: "set_measured_by",
  category: "write",
  requiresConfirmation: false,
  description:
    "Say how a hypothesis is measured, as the card's 'Measured by' does (any hypothesis, not only a value check): measuredBy {kind: metric (metricId of a product metric) | key-result (okrId and keyResultId) | words (note ≤200)}, or null to clear it. The metric or key result must exist. Returns {updated: true, id, measuredBy | null} or {updated: false, reason: 'not_found' | 'invalid' (with errors)}.",
  paramsSchema: SetMeasuredBySchema,
  handler: async (params) => setMeasuredBy(browserStore, params),
  mcpHandler: async (params, ctx) => setMeasuredBy(serverStore(ctx.userId), params),
});

/* ── read_measure ────────────────────────────────────────────────────── */

const HypothesisIdSchema = z.object({ hypothesisId: z.string() });

async function readMeasureVerb(store: TrackerStore, p: z.infer<typeof HypothesisIdSchema>) {
  const [doc, sources] = await Promise.all([store.get(), store.sources()]);
  const h = doc?.hypotheses.find((x) => x.id === p.hypothesisId);
  if (!h) return { found: false };
  const read = readMeasure(h, sources);
  if (read.state !== "ready") {
    return {
      found: true,
      state: read.state,
      ...(read.state === "no_reading" ? { measure: read.measure.name, checkOn: read.checkOn } : {}),
      ...(read.state === "no_target" ? { measure: read.measure.name } : {}),
    };
  }
  const next = { ...h, actual: read.reading.value };
  return {
    found: true,
    state: "ready",
    measure: read.measure.name,
    checkOn: read.checkOn,
    reading: read.reading,
    suggestedVerdict: suggestVerdict(next),
    suggestion: suggestionText(next),
  };
}

registry.register({
  id: "tool.hypothesis_tracker.read_measure",
  toolId: "tool.hypothesis_tracker",
  name: "read_measure",
  category: "read",
  description:
    "What the card's 'Read the metric' would record for a value check measured by a product metric or a key result: the first reading (or check-in) on or after its checkOn. Saves nothing: record_result writes the number, once the user agrees. Returns {found: false}, {found: true, state: 'none' (not a value check on a metric or key result) | 'missing' (the metric or key result is gone) | 'no_target' | 'no_reading' (with measure, checkOn)}, or {found: true, state: 'ready', measure, checkOn, reading {date, value}, suggestedVerdict, suggestion} (the verdict that reading would suggest).",
  paramsSchema: HypothesisIdSchema,
  handler: async (params) => readMeasureVerb(browserStore, params),
  mcpHandler: async (params, ctx) => readMeasureVerb(serverStore(ctx.userId), params),
});

/* ── use_ab_result ───────────────────────────────────────────────────── */

async function applyAbResult(store: TrackerStore, p: z.infer<typeof HypothesisIdSchema>) {
  const [doc, tests] = await Promise.all([store.get(), store.tests()]);
  const h = doc?.hypotheses.find((x) => x.id === p.hypothesisId);
  if (!doc || !h) return { updated: false, reason: "not_found" };
  const test = testForHypothesis(tests, h.id);
  if (!test) return { updated: false, reason: "no_test", message: AB_RESULT_REASON.no_test };
  const r = abResultUpdate(h, test);
  if (!r.ok) return { updated: false, reason: r.reason, message: AB_RESULT_REASON[r.reason] };
  await store.put(withHypothesis(doc, r.next));
  return {
    updated: true,
    testId: test.id,
    sentence: r.sentence,
    actualSet: r.actualSet,
    ...(r.actualSet ? { actual: r.next.actual } : {}),
    suggestedVerdict: r.suggestedVerdict,
  };
}

registry.register({
  id: "tool.hypothesis_tracker.use_ab_result",
  toolId: "tool.hypothesis_tracker",
  name: "use_ab_result",
  category: "write",
  requiresConfirmation: false,
  description:
    "Use a hypothesis's A/B test result, as the card's 'Use the A/B result' does: the test linked to it in the A/B Calculator (hypothesisId; the most recently updated one) adds its result sentence to what we learned, on its own line and once; below the plan's sample a version the line starts 'Too early to call: <smaller> of <planned> per variant. So far:', so an early look is never written as a result. It sets the measured result (B's rate in %) only when the target's unit is '%', the test has its planned sample a version and the result is significant at the plan's confidence. It never sets the status: apply suggestedVerdict with set_status once the user agrees. Returns {updated: true, testId, sentence, actualSet, actual?, suggestedVerdict | null} or {updated: false, reason: 'not_found' | 'no_test' | 'no_result' (no counts yet) | 'already_used' | 'too_long' (what we learned has no room), message?}.",
  paramsSchema: HypothesisIdSchema,
  handler: async (params) => applyAbResult(browserStore, params),
  mcpHandler: async (params, ctx) => applyAbResult(serverStore(ctx.userId), params),
});
