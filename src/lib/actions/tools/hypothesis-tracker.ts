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
 *   3. set_status       — move through the lifecycle; stamps resolvedAt (a
 *                         day that can be backdated) on a result. A hand-off
 *                         draft needs its missing lines before it moves on.
 *   4. record_result    — the measured number; returns the suggested
 *                         verdict and never applies it.
 *
 * Every rule comes from lib/hypotheses (the page uses it too). Entity kind
 * "workspace:hypothesisTracker" + the fixed HYPOTHESIS_TRACKER_ID match
 * hypothesis-tracker-client.tsx, so MCP writes round-trip into the UI.
 */

import { z } from "zod";
import { nanoid } from "nanoid";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import type { Hypothesis, HypothesisStatus, HypothesisTracker } from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";
import { addDays } from "@/lib/impediments/model";
import {
  HYPOTHESIS_STATUSES,
  HYPOTHESIS_TEXT_MAX,
  HYPOTHESIS_TRACKER_ID,
  HYPOTHESIS_UNIT_MAX,
  applyHypothesisValues,
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
  /** Over MCP the server's day may be behind the user's (see latestDay). */
  onServer: boolean;
}

const browserStore: TrackerStore = {
  get: async () =>
    (ws().hypothesisTrackers ?? []).find((d) => d.id === HYPOTHESIS_TRACKER_ID) ?? null,
  put: async (doc) => ws().upsertHypothesisTracker(doc),
  onServer: false,
};

function serverStore(userId: string): TrackerStore {
  return {
    get: async () =>
      (await serverGetEntity<HypothesisTracker>(userId, KIND_HT, HYPOTHESIS_TRACKER_ID)) ?? null,
    put: async (doc) => {
      await serverUpsertEntity<HypothesisTracker>(userId, KIND_HT, doc);
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
  const byStatus: Record<HypothesisStatus, number> = {
    drafted: 0,
    running: 0,
    validated: 0,
    invalidated: 0,
    inconclusive: 0,
  };
  for (const h of hypotheses) if (h.status in byStatus) byStatus[h.status] += 1;
  const rate = validationRate(hypotheses);
  return {
    exists: doc !== null,
    total: hypotheses.length,
    byStatus,
    decisive: rate.decisive,
    inconclusive: rate.inconclusive,
    validationRate: rate.rate === null ? null : round2(rate.rate),
    verdict: hypothesisVerdict(rate),
    needsDetail: hypotheses.filter((h) => missingFields(h).length > 0).length,
    hypotheses: hypotheses.map((h) => ({
      ...h,
      missing: missingFields(h),
      suggestedVerdict: suggestVerdict(h),
      suggestion: suggestionText(h),
    })),
  };
}

registry.register({
  id: "tool.hypothesis_tracker.list_state",
  toolId: "tool.hypothesis_tracker",
  name: "list_state",
  category: "read",
  description:
    "Summarise hypotheses, as the page does. Returns {exists, total, byStatus: {drafted, running, validated, invalidated, inconclusive}, decisive (validated + invalidated), inconclusive, validationRate (0..1, validated over decisive; null while no result is decisive; inconclusive results and example rows aren't counted), verdict (one sentence), needsDetail (hypotheses missing what we'll do or the success metric, e.g. hand-off drafts), hypotheses: each stored row plus missing ('willDo' | 'successMetric')[], suggestedVerdict ({verdict: 'validated' | 'invalidated', met, margin (actual − target, positive = better), moved? (actual − baseline)} or null without a target and a measured actual) and suggestion (that in words, or null)}. A suggestion is never applied: set_status does that.",
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
  if (!checked.ok) {
    const errors = Object.fromEntries(
      Object.entries(checked.errors).map(([k, v]) => [PARAM_OF[k as HypothesisField] ?? k, v])
    );
    return { added: false, reason: "invalid", errors };
  }
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
    if (missing.length > 0) return { updated: false, reason: "needs_detail", missing };
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
    "Set a hypothesis's status (drafted | running | validated | invalidated | inconclusive). A status with a result stamps resolvedAt: the resolvedAt param (YYYY-MM-DD, backdated; not before raisedAt; not in the future), else the day already stamped, else today; moving back to drafted or running clears it. A hypothesis missing what we'll do or its success metric (a hand-off draft) stays drafted until they're filled. Returns {updated: true, status, resolvedAt?} or {updated: false, reason: 'not_found' | 'needs_detail' (with missing) | 'not_a_day' | 'future_day' | 'before_raised' | 'no_result' (resolvedAt with a status that has no result)}.",
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
  if (p.actual !== null && !h.target) return { updated: false, reason: "no_target" };
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
    "Record the measured result of a hypothesis with a target (null clears it). Returns the verdict it suggests (target met → validated, missed → invalidated) without applying it: the status changes only through set_status, once the user agrees. Returns {updated: true, actual, suggestedVerdict: {verdict, met, margin, moved?} | null, suggestion} or {updated: false, reason: 'not_found' | 'no_target'}.",
  paramsSchema: RecordSchema,
  handler: async (params) => recordResult(browserStore, params),
  mcpHandler: async (params, ctx) => recordResult(serverStore(ctx.userId), params),
});
