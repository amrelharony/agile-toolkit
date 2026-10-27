/**
 * OKR Tracker — tool-local actions.
 *
 * Category: Outcomes & Pulse (squad S6)
 * Agent surface: tool.okrs.*
 * Backing CRUD : workspace.okr.* (already synced — this is a WIRE, not a
 *                migration). create/list/update/delete exist generically;
 *                this file adds the OKR-domain verbs an agent reaches for:
 *
 *   1. list_state          — every OKR as the page reads it: progress from
 *                            baseline to target either way, confidence,
 *                            both over time, the last check-in, the
 *                            verdict and the sprint goals that link it.
 *   2. check_in            — a dated check-in on one key result (the value
 *                            that day, a confidence, a note): it joins the
 *                            key result's history and confidence trend.
 *   3. update_key_result   — the older verb: sets `current` by recording a
 *                            check-in, so an agent's update leaves a trend
 *                            point like the page's.
 *   4. remove_check_in     — delete one check-in, as the page's check-in
 *                            history does: current and confidence follow
 *                            the newest check-in left.
 *
 * Every number comes from lib/okrs (progress and links), the formula the
 * page, Sprint Goal and the AI prompt share. Example rows (`example-` ids)
 * are left out of list_state.
 *
 * Entity kind "workspace:okr" (single word — no snake/camel transform). Both
 * browser + MCP paths agree, so agent writes round-trip into the UI.
 */

import { z } from "zod";
import { nanoid } from "nanoid";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverListEntities, serverUpsertEntity } from "../server-store";
import {
  KR_CHECK_IN_CAP,
  type KeyResult,
  type KeyResultCheckIn,
  type Okr,
  type Sprint,
  type SprintGoal,
} from "@/lib/stores/workspace-types";
import {
  CHECK_IN_NOTE_MAX,
  confidenceBand,
  confidenceTrend,
  daysSinceCheckIn,
  isConfidence,
  krBaseline,
  krDirection,
  krPercent,
  krProgressText,
  lastCheckIn,
  latestCheckInDay,
  objectiveConfidence,
  objectivePercent,
  okrVerdict,
  overallProgress,
  progressTrend,
  replacesUndated,
  type UndatedReplaced,
  withCheckIn,
  withoutCheckIn,
} from "@/lib/okrs/progress";
import { sprintGoalsFor } from "@/lib/okrs/links";
import { normalizeQuarter } from "@/lib/roadmap/quarters";
import { isIsoDate } from "@/lib/sprints/calendar";
import { isExampleId } from "@/lib/utils/example-id";
import { todayLocalISO } from "@/lib/utils/formatters";

const KIND_OKR = "workspace:okr";
const KIND_SPRINT_GOAL = "workspace:sprintGoal";
const KIND_SPRINT = "workspace:sprint";

const ws = () => useWorkspaceStore.getState();

interface OkrStore {
  okrs(): Promise<Okr[]>;
  okr(id: string): Promise<Okr | null>;
  goals(): Promise<SprintGoal[]>;
  sprints(): Promise<Sprint[]>;
  put(okr: Okr): Promise<void>;
}

const browserStore: OkrStore = {
  okrs: async () => ws().okrs ?? [],
  okr: async (id) => (ws().okrs ?? []).find((o) => o.id === id) ?? null,
  goals: async () => ws().sprintGoals ?? [],
  sprints: async () => ws().sprints ?? [],
  put: async (okr) => ws().upsertOkr(okr),
};

function serverStore(userId: string): OkrStore {
  return {
    okrs: () => serverListEntities<Okr>(userId, KIND_OKR),
    okr: async (id) => (await serverGetEntity<Okr>(userId, KIND_OKR, id)) ?? null,
    goals: () => serverListEntities<SprintGoal>(userId, KIND_SPRINT_GOAL),
    sprints: () => serverListEntities<Sprint>(userId, KIND_SPRINT),
    put: async (okr) => {
      await serverUpsertEntity<Okr>(userId, KIND_OKR, okr);
    },
  };
}

/* ── list_state ─────────────────────────────────────────────────────── */

/** One key result as list_state returns it. */
function keyResultView(kr: KeyResult, today: string) {
  const last = lastCheckIn(kr);
  const confidence = isConfidence(kr.confidence) ? kr.confidence : null;
  return {
    id: kr.id,
    title: kr.title,
    description: kr.description ?? null,
    unit: kr.unit ?? null,
    baseline: krBaseline(kr),
    direction: krDirection(kr),
    target: kr.target,
    current: kr.current,
    progressPct: krPercent(kr),
    progressText: krProgressText(kr),
    confidence,
    confidenceBand: confidenceBand(confidence),
    lastCheckIn: last
      ? {
          id: last.id,
          date: last.date,
          value: last.value,
          confidence: isConfidence(last.confidence) ? last.confidence : null,
          note: last.note ?? null,
        }
      : null,
    daysSinceCheckIn: daysSinceCheckIn(kr, today),
    checkInCount: (kr.checkIns ?? []).length,
  };
}

/** One objective as list_state returns it. */
function okrView(
  okr: Okr,
  goals: readonly SprintGoal[],
  sprints: readonly Sprint[],
  now: Date,
  today: string
) {
  return {
    id: okr.id,
    objective: okr.objective,
    description: okr.description ?? null,
    // "2026 Q4" whichever way it was stored; text that isn't a quarter as stored.
    quarter: normalizeQuarter(okr.quarter) || okr.quarter,
    owner: okr.owner ?? null,
    progressPct: objectivePercent(okr),
    confidence: objectiveConfidence(okr),
    verdict: okrVerdict(okr, now),
    confidenceTrend: confidenceTrend(okr),
    // The page's "Progress over time" chart, rounded as progressPct is.
    progressTrend: progressTrend(okr).map((p) => ({
      date: p.date,
      progressPct: Math.round(p.progress * 100),
      measured: p.measured,
    })),
    linkedSprintGoals: sprintGoalsFor(okr.id, goals, sprints),
    keyResults: (okr.keyResults ?? []).map((kr) => keyResultView(kr, today)),
  };
}

async function listState(store: OkrStore) {
  const [okrs, goals, sprints] = await Promise.all([store.okrs(), store.goals(), store.sprints()]);
  const real = okrs.filter((o) => !isExampleId(o.id));
  const now = new Date();
  const today = todayLocalISO(now);
  // The page's headline: only objectives with a key result are measured, so
  // one with none isn't averaged in as 0% (as the health dashboard reads it).
  const measured = real.filter((o) => (o.keyResults ?? []).length > 0);
  return {
    total: real.length,
    overallProgressPct: Math.round(overallProgress(real) * 100),
    measuredObjectives: measured.length,
    measuredProgressPct: measured.length > 0 ? Math.round(overallProgress(measured) * 100) : null,
    items: real.map((o) => okrView(o, goals, sprints, now, today)),
  };
}

registry.register({
  id: "tool.okrs.list_state",
  toolId: "tool.okrs",
  name: "list_state",
  category: "read",
  description:
    "List the team's OKRs as the OKR page reads them. Returns {total, overallProgressPct (the mean of each objective's progress, an objective with no key results counting as 0), measuredObjectives (how many have at least one key result), measuredProgressPct (the page's headline: the mean over those measured objectives only) | null (null: none has a key result), items: {id, objective, description, quarter ('2026 Q4' however it was stored; text that isn't a quarter as stored), owner | null, progressPct (mean of its key results'), confidence (mean of the scored key results', 0-10) | null, verdict (one sentence: progress against the days gone in its quarter, confidence and its direction), confidenceTrend: {date, confidence, scored}[] (per day a check-in scored confidence: the mean of each key result's latest score by then, a key result scored without a dated check-in counting on every day), progressTrend: {date, progressPct, measured}[] (per check-in day: the objective's progress with each key result at its latest check-in value by then, at its baseline before its first, one never checked in at its current value; measured = how many key results had a check-in by then; the last point is progressPct), linkedSprintGoals: {goalId, sprintId | null (null: the draft goal), sprintName, goal, met?: 'met' | 'partly' | 'not-met'}[] (Sprint Goal writes these links), keyResults: {id, title, description, unit, baseline | null (null: not set, progress reads it as 0), direction: 'increase' | 'decrease', target, current, progressPct (baseline → target, clamped 0-100), progressText, confidence 0-10 | null (null: not scored), confidenceBand: 'off-track' (≤3) | 'at-risk' (4-6) | 'on-track' (≥7) | null, lastCheckIn: {id, date, value, confidence | null, note | null} | null, daysSinceCheckIn | null, checkInCount}[]}[]}. Example rows are left out; the full check-in history is on workspace.okr.get.",
  paramsSchema: z.object({}),
  handler: () => listState(browserStore),
  mcpHandler: (_params, ctx) => listState(serverStore(ctx.userId)),
});

/* ── check_in ───────────────────────────────────────────────────────── */

const DaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD")
  .refine((d) => isIsoDate(d), "Not a day on the calendar")
  .describe(
    "YYYY-MM-DD, the user's local day the value was read (backdate a missed week; never a future day). Default today: over MCP the server's (UTC) day, and the day after it is still taken, as the user's day may be ahead."
  );

const checkInParams = z.object({
  okrId: z.string(),
  keyResultId: z.string(),
  value: z.number().finite().describe("The key result's value that day."),
  confidence: z
    .number()
    .min(0)
    .max(10)
    .optional()
    .describe("0-10, how sure the owner is of reaching the target; leave out when not scored."),
  date: DaySchema.optional(),
  note: z.string().max(CHECK_IN_NOTE_MAX).optional(),
});

type CheckInParams = z.infer<typeof checkInParams>;

/**
 * The day a check-in with no date is for: today, or the key result's
 * newest check-in day when that is after today and still allowed (the
 * server's today can be the user's yesterday). A default before the newest
 * would file the agent's update as backdated and leave `current` as it was.
 */
function defaultDay(kr: KeyResult, today: string, latest: string): string {
  const newest = lastCheckIn(kr)?.date;
  return newest !== undefined && newest > today && newest <= latest ? newest : today;
}

/** A backdated first check-in's roll-back, with a sentence for the agent to relay. */
type ReplacedUndated = (UndatedReplaced & { message: string }) | null;

type CheckInResult =
  | {
      recorded: true;
      checkInId: string;
      date: string;
      /**
       * The key result's value after it: unchanged by a check-in older than
       * its newest; a key result's first check-in sets it whatever its date.
       */
      current: number;
      confidence: number | null;
      keyResultProgressPct: number;
      /** The objective's progress after it. */
      progressPct: number;
      /** Set when a first check-in dated before today replaced a different undated value. */
      replacedUndated: ReplacedUndated;
    }
  | { recorded: false; reason: "not_found" | "future_day" | "too_old"; message: string };

/**
 * What a backdated first check-in replaced (lib/okrs replacesUndated), told
 * plainly: the agent may have meant to add history, not to roll a newer
 * typed value back, and can check that value in for today.
 */
function replacedUndated(kr: KeyResult, entry: KeyResultCheckIn, today: string): ReplacedUndated {
  const r = replacesUndated(kr, entry, today);
  if (!r) return null;
  const parts = [
    ...(r.current !== null ? [`the undated current ${r.current} with ${entry.value}`] : []),
    ...(r.confidence !== null
      ? [`the undated confidence ${r.confidence} with ${entry.confidence}`]
      : []),
  ];
  const many = parts.length > 1;
  return {
    ...r,
    message: `A key result's first check-in becomes its current reading whatever its date, so this one (${entry.date}) replaced ${parts.join(" and ")}. If the old ${many ? "values were" : "value was"} newer, check ${many ? "them" : "it"} in for today.`,
  };
}

async function checkIn(
  store: OkrStore,
  p: CheckInParams,
  onServer: boolean
): Promise<CheckInResult> {
  const okr = await store.okr(p.okrId);
  if (!okr) return { recorded: false, reason: "not_found", message: `No OKR "${p.okrId}".` };
  const kr = (okr.keyResults ?? []).find((k) => k.id === p.keyResultId);
  if (!kr) {
    return {
      recorded: false,
      reason: "not_found",
      message: `OKR "${p.okrId}" has no key result "${p.keyResultId}".`,
    };
  }
  const today = todayLocalISO();
  // In the browser, today; on the server, whose day (UTC on a typical
  // deploy) isn't the user's, the day after it too, so a user ahead of UTC
  // can check in on their own today.
  const latest = latestCheckInDay(today, onServer);
  const date = p.date ?? defaultDay(kr, today, latest);
  if (date > latest) {
    return {
      recorded: false,
      reason: "future_day",
      message: `${date} is in the future; a check-in is for today or a day before.`,
    };
  }
  const note = p.note?.trim();
  const entry: KeyResultCheckIn = {
    id: `ci_${nanoid(8)}`,
    date,
    value: p.value,
    ...(p.confidence !== undefined ? { confidence: p.confidence } : {}),
    ...(note ? { note } : {}),
  };
  const replaced = replacedUndated(kr, entry, today);
  const nextKr = withCheckIn(kr, entry);
  if (!(nextKr.checkIns ?? []).some((c) => c.id === entry.id)) {
    return {
      recorded: false,
      reason: "too_old",
      message: `A key result keeps its ${KR_CHECK_IN_CAP} newest check-ins, and ${date} is older than all of them.`,
    };
  }
  const next: Okr = {
    ...okr,
    keyResults: okr.keyResults.map((k) => (k.id === kr.id ? nextKr : k)),
  };
  await store.put(next);
  return {
    recorded: true,
    checkInId: entry.id,
    date,
    current: nextKr.current,
    confidence: isConfidence(nextKr.confidence) ? nextKr.confidence : null,
    keyResultProgressPct: krPercent(nextKr),
    progressPct: objectivePercent(next),
    replacedUndated: replaced,
  };
}

registry.register({
  id: "tool.okrs.check_in",
  toolId: "tool.okrs",
  name: "check_in",
  category: "write",
  requiresConfirmation: false,
  description: `Record a dated check-in on one key result: its value that day, and optionally a 0-10 confidence and a note (≤${CHECK_IN_NOTE_MAX}). It joins the key result's history (the newest ${KR_CHECK_IN_CAP} kept) and its objective's confidence trend; the key result's current value and confidence follow the newest-dated check-in, so a backdated one older than the newest leaves them as they are. A key result's first check-in becomes its current value (and, scored, its confidence) whatever its date, as a typed value has no date to weigh it against: when one dated before today replaces a different value, replacedUndated says which, so check that value in for today if it was newer. Params: {okrId, keyResultId, value, confidence?, date? (YYYY-MM-DD, the user's local day; default today; never a future day; over MCP the day after the server's is taken too), note?}. Returns {recorded: true, checkInId, date, current, confidence | null, keyResultProgressPct, progressPct (the objective's), replacedUndated: {current | null, confidence | null, message} | null} or {recorded: false, reason: 'not_found' | 'future_day' | 'too_old', message}.`,
  paramsSchema: checkInParams,
  handler: (params) => checkIn(browserStore, params, false),
  mcpHandler: (params, ctx) => checkIn(serverStore(ctx.userId), params, true),
});

/* ── update_key_result ──────────────────────────────────────────────── */

const updateParams = z.object({
  okrId: z.string(),
  keyResultId: z.string(),
  current: z.number().finite().describe("The key result's value now."),
  confidence: checkInParams.shape.confidence,
  date: DaySchema.optional(),
  note: checkInParams.shape.note,
});

/** update_key_result's older result shape, over check_in. */
async function updateKeyResult(
  store: OkrStore,
  p: z.infer<typeof updateParams>,
  onServer: boolean
) {
  const { current, ...rest } = p;
  const r = await checkIn(store, { ...rest, value: current }, onServer);
  if (!r.recorded) return { updated: false, reason: r.reason, message: r.message };
  return {
    updated: true,
    progressPct: r.progressPct,
    checkInId: r.checkInId,
    current: r.current,
    replacedUndated: r.replacedUndated,
  };
}

registry.register({
  id: "tool.okrs.update_key_result",
  toolId: "tool.okrs",
  name: "update_key_result",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set a key result's value by recording a check-in for it (tool.okrs.check_in with value = current), so the update joins its history and trend. Params: {okrId, keyResultId, current, confidence? (0-10), date? (YYYY-MM-DD; default today; never a future day), note?}. Returns {updated: true, progressPct (the objective's), checkInId, current, replacedUndated (as check_in's: set when a backdated first check-in replaced a different undated value) | null} or {updated: false, reason: 'not_found' | 'future_day' | 'too_old', message}.",
  paramsSchema: updateParams,
  handler: (params) => updateKeyResult(browserStore, params, false),
  mcpHandler: (params, ctx) => updateKeyResult(serverStore(ctx.userId), params, true),
});

/* ── remove_check_in ────────────────────────────────────────────────── */

const removeParams = z.object({
  okrId: z.string(),
  keyResultId: z.string(),
  checkInId: z.string().describe("A check-in's id, from workspace.okr.get or check_in's result."),
});

type RemoveResult =
  | {
      removed: true;
      /** The key result's value after it: the newest check-in left's, else its baseline. */
      current: number;
      confidence: number | null;
      keyResultProgressPct: number;
      progressPct: number;
      checkInCount: number;
    }
  | { removed: false; reason: "not_found"; message: string };

/**
 * The page's check-in delete (lib/okrs withoutCheckIn): the rest re-mirror
 * the key result's current value and confidence; with none left, current
 * goes back to the baseline. The page offers Undo; an agent re-records the
 * check-in with check_in instead.
 */
async function removeCheckIn(
  store: OkrStore,
  p: z.infer<typeof removeParams>
): Promise<RemoveResult> {
  const okr = await store.okr(p.okrId);
  const kr = okr?.keyResults.find((k) => k.id === p.keyResultId);
  if (!okr || !kr) {
    return {
      removed: false,
      reason: "not_found",
      message: okr
        ? `OKR "${p.okrId}" has no key result "${p.keyResultId}".`
        : `No OKR "${p.okrId}".`,
    };
  }
  const nextKr = withoutCheckIn(kr, p.checkInId);
  if (nextKr === kr) {
    return {
      removed: false,
      reason: "not_found",
      message: `Key result "${p.keyResultId}" has no check-in "${p.checkInId}".`,
    };
  }
  const next: Okr = {
    ...okr,
    keyResults: okr.keyResults.map((k) => (k.id === kr.id ? nextKr : k)),
  };
  await store.put(next);
  return {
    removed: true,
    current: nextKr.current,
    confidence: isConfidence(nextKr.confidence) ? nextKr.confidence : null,
    keyResultProgressPct: krPercent(nextKr),
    progressPct: objectivePercent(next),
    checkInCount: (nextKr.checkIns ?? []).length,
  };
}

registry.register({
  id: "tool.okrs.remove_check_in",
  toolId: "tool.okrs",
  name: "remove_check_in",
  category: "write",
  requiresConfirmation: true,
  description:
    "Delete one check-in from a key result, as the OKR page's check-in history does. The key result's current value and confidence then follow the newest check-in left; with none left, current goes back to its baseline (a key result with no baseline keeps its value) and an unscored key result has no confidence. Params: {okrId, keyResultId, checkInId}. Returns {removed: true, current, confidence | null, keyResultProgressPct, progressPct (the objective's), checkInCount} or {removed: false, reason: 'not_found', message}.",
  paramsSchema: removeParams,
  handler: (params) => removeCheckIn(browserStore, params),
  mcpHandler: (params, ctx) => removeCheckIn(serverStore(ctx.userId), params),
});
