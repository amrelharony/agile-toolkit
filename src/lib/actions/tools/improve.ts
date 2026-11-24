/**
 * Improve — tool-local actions.
 *
 * Category: Continuous Improvement (tools plan, phase 2)
 *
 * Agent surface: tool.improve.*
 * Backing CRUD : workspace.improvement.* (create, list, update, delete):
 *                one Improvement per A3 or Improvement Kata, under its own
 *                id ("improve_…"), kind IMPROVEMENT_KIND.
 *
 *   1. list_state   — every improvement with its method, status, progress
 *                     towards the target, readings, the A3's gap checks,
 *                     the obstacle a Kata is on, its last experiment and
 *                     whether its coaching talk is due, plus the page's
 *                     one-line verdict. Example rows are listed and marked,
 *                     but left out of the totals and the verdict.
 *   2. add_step     — a planned countermeasure (A3) or experiment (Kata).
 *   3. record_result — a step's status, what was expected, what happened
 *                     and what was learned.
 *   4. log_reading  — a dated reading of the improvement's number.
 *   5. add_obstacle — an obstacle on a Kata.
 *
 * Every write goes through lib/improve/model, so the caps and rules (a Kata
 * experiment can't run without what the team expects, a reading can't be
 * for a later day) are the page's and the CRUD's, and it stamps updatedAt
 * and doneAt as the page does. The MCP handler also reads the Root Cause
 * analyses, the retro boards and the stories, so a step sent to Retro
 * Actions or the backlog reads as done once it is done there. Nothing here
 * reaches other people: every verb is the person's own data. Sending a step
 * or an obstacle to another tool is done on the page.
 */

import { z } from "zod";
import { nanoid } from "nanoid";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverListEntities, serverUpsertEntity } from "../server-store";
import {
  IMPROVEMENT_KIND,
  IMPROVEMENT_STATUSES,
  IMPROVEMENT_STEP_STATUSES,
  ROOT_CAUSE_ANALYSIS_KIND,
  TOOL_TEXT_MAX,
  type Improvement,
  type RetroBoard,
  type RootCauseAnalysis,
  type Story,
} from "@/lib/stores/workspace-types";
import { isExampleId } from "@/lib/utils/example-id";
import { latestCheckInDay } from "@/lib/okrs/progress";
import { readAnalyses } from "@/lib/root-cause/model";
import { todayIso } from "@/lib/sprints/series";
import {
  coachingDue,
  fitsRow,
  gapsIn,
  improveVerdict,
  lastExperiment,
  latestReading,
  newestFirst,
  progressToTarget,
  readImprovement,
  readImprovements,
  stepDoneIn,
  withObstacle,
  withReading,
  withStep,
  withStepPatch,
  workingObstacle,
  type VerdictContext,
} from "@/lib/improve/model";

const ws = () => useWorkspaceStore.getState();
const nowIso = () => new Date().toISOString();

/** The retro boards and stories a sent step's done state is read from (as tool.retro_actions reads them). */
const KIND_RETRO = "workspace:retroBoard";
const KIND_STORY = "workspace:story";

interface Context {
  boards: RetroBoard[];
  stories: Story[];
  analyses: RootCauseAnalysis[];
}

/** Where the verbs read and write: the browser's store, or the user's rows on the server. */
interface Store {
  list: () => Promise<Improvement[]>;
  get: (id: string) => Promise<Improvement | null>;
  put: (item: Improvement) => Promise<void>;
  context: () => Promise<Context>;
  /**
   * The day a reading may be for at most: today on the person's own clock;
   * on the server (UTC) a day more, as OKR check-ins allow.
   */
  latestDay: () => string;
}

const browserStore: Store = {
  list: async () => ws().improvements ?? [],
  get: async (id) => (ws().improvements ?? []).find((i) => i.id === id) ?? null,
  put: async (item) => ws().upsertImprovement(item),
  context: async () => ({
    boards: ws().retroBoards ?? [],
    stories: ws().stories ?? [],
    analyses: readAnalyses(ws().rootCauseAnalyses),
  }),
  latestDay: () => latestCheckInDay(todayIso(), false),
};

const serverStore = (userId: string): Store => ({
  list: () => serverListEntities<Improvement>(userId, IMPROVEMENT_KIND),
  get: (id) => serverGetEntity<Improvement>(userId, IMPROVEMENT_KIND, id),
  put: async (item) => {
    await serverUpsertEntity<Improvement>(userId, IMPROVEMENT_KIND, item);
  },
  context: async () => {
    const [boards, stories, analyses] = await Promise.all([
      serverListEntities<RetroBoard>(userId, KIND_RETRO),
      serverListEntities<Story>(userId, KIND_STORY),
      serverListEntities<RootCauseAnalysis>(userId, ROOT_CAUSE_ANALYSIS_KIND),
    ]);
    return { boards, stories, analyses: readAnalyses(analyses) };
  },
  latestDay: () => latestCheckInDay(todayIso(), true),
});

async function load(store: Store, id: string): Promise<Improvement | null> {
  const raw = await store.get(id);
  return raw ? readImprovement(raw) : null;
}

/** Saves the improvement unless it has grown past one synced row. */
async function save(store: Store, item: Improvement): Promise<boolean> {
  if (!fitsRow(item)) return false;
  await store.put(item);
  return true;
}

function summarize(rows: readonly Improvement[], context: Context) {
  const today = todayIso();
  const done = stepDoneIn({ boards: context.boards, stories: context.stories });
  const ctx: VerdictContext = { today, done, analyses: context.analyses };
  const items = newestFirst(readImprovements(rows));
  // The example is listed (marked) but, as on the page, not counted.
  const real = items.filter((i) => !isExampleId(i.id));
  const byStatus = Object.fromEntries(IMPROVEMENT_STATUSES.map((s) => [s, 0])) as Record<
    (typeof IMPROVEMENT_STATUSES)[number],
    number
  >;
  for (const i of real) byStatus[i.status]++;
  return {
    total: real.length,
    byStatus,
    verdict: improveVerdict(real, ctx),
    items: items.map((i) => {
      const last = latestReading(i);
      const working = workingObstacle(i);
      const experiment = lastExperiment(i);
      return {
        id: i.id,
        example: isExampleId(i.id),
        title: i.title,
        method: i.method,
        status: i.status,
        owner: i.owner ?? null,
        current: i.current,
        target: i.target,
        progressPct: progressToTarget(i),
        readings: {
          count: i.readings.length,
          last: last ? { date: last.date, value: last.value } : null,
        },
        gaps: gapsIn(i, ctx).map((g) => g.text),
        workingObstacle: working ? { id: working.id, text: working.text } : null,
        lastExperiment: experiment
          ? {
              id: experiment.id,
              text: experiment.text,
              status: experiment.status,
              expect: experiment.expect ?? null,
              result: experiment.result ?? null,
              learned: experiment.learned ?? null,
            }
          : null,
        steps: {
          total: i.steps.length,
          done: i.steps.filter((s) => done(s).done).length,
          ids: i.steps.map((s) => ({ id: s.id, text: s.text, status: s.status })),
        },
        rootCauseId: i.rootCauseId ?? null,
        nextCoachingAt: i.nextCoachingAt ?? null,
        coachingDue: coachingDue(i, today),
        updatedAt: i.updatedAt,
      };
    }),
  };
}

// ──────── tool.improve.list_state ────────
registry.register({
  id: "tool.improve.list_state",
  toolId: "tool.improve",
  name: "list_state",
  category: "read",
  description:
    "Summarise the improvements (A3s and Improvement Katas), newest change first. Returns {total, byStatus:{open,checking,closed,dropped}, verdict (the page's one line) (total, byStatus and verdict leave example rows out), items:{id, example (true for an example row from Load example), title, method ('a3'|'kata'), status, owner|null, current {text, metric?, value?, unit?, date?} (where things stand), target {…} (where the team wants them), progressPct|null (0–100 from current towards target at the latest reading; null without both numbers), readings:{count, last:{date,value}|null}, gaps (an A3's missing pieces, in the page's words; [] for a Kata), workingObstacle:{id,text}|null, lastExperiment:{id,text,status,expect,result,learned}|null, steps:{total, done (a step sent to Retro Actions or the backlog counts once it is done there), ids:{id,text,status}[]}, rootCauseId|null, nextCoachingAt|null, coachingDue, updatedAt}[]}. Create, edit or delete an improvement with workspace.improvement.*.",
  paramsSchema: z.object({}),
  handler: async () => summarize(await browserStore.list(), await browserStore.context()),
  mcpHandler: async (_params, ctx) => {
    const store = serverStore(ctx.userId);
    const [rows, context] = await Promise.all([store.list(), store.context()]);
    return summarize(rows, context);
  },
});

const ItemId = z.string().min(1).max(64).describe("The improvement's id (see list_state).");
const Day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD")
  .describe("A day, YYYY-MM-DD.");

const AddStepParams = z.object({
  itemId: ItemId,
  text: z
    .string()
    .trim()
    .min(1)
    .max(TOOL_TEXT_MAX.text)
    .describe("What the team will change (an A3) or try next (a Kata)."),
  expect: z
    .string()
    .trim()
    .max(TOOL_TEXT_MAX.text)
    .optional()
    .describe("What the team expects to happen (a Kata experiment needs it before it runs)."),
  owner: z.string().trim().max(TOOL_TEXT_MAX.short).optional().describe("Who owns it."),
  due: Day.optional().describe("When it is due, YYYY-MM-DD."),
  obstacleId: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe("The obstacle a Kata experiment works on (see list_state)."),
});

async function addStep(store: Store, params: z.infer<typeof AddStepParams>) {
  const item = await load(store, params.itemId);
  if (!item) return { added: false as const, reason: "not_found" as const };
  const stepId = nanoid(8);
  const changed = withStep(
    item,
    {
      text: params.text,
      expect: params.expect,
      owner: params.owner,
      due: params.due,
      obstacleId: params.obstacleId,
    },
    stepId,
    nowIso()
  );
  if (!changed.ok) {
    const reason =
      changed.reason === "unknown_obstacle" || changed.reason === "list_full"
        ? changed.reason
        : ("bad_date" as const);
    return { added: false as const, reason };
  }
  if (!(await save(store, changed.item)))
    return { added: false as const, reason: "too_big" as const };
  return { added: true as const, stepId, count: changed.item.steps.length };
}

// ──────── tool.improve.add_step ────────
registry.register({
  id: "tool.improve.add_step",
  toolId: "tool.improve",
  name: "add_step",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add a planned step to an improvement: a countermeasure on an A3 (with an owner and a due day) or the next experiment on a Kata (with what the team expects, and the obstacle it works on). Returns {added: true, stepId, count}, or {added: false, reason: 'not_found' | 'list_full' (50 steps at most) | 'unknown_obstacle' | 'bad_date' (a due day that isn't on the calendar) | 'too_big' (the record would pass one saved row)}. Sending a countermeasure to Retro Actions or the backlog is done on the page.",
  paramsSchema: AddStepParams,
  handler: (params) => addStep(browserStore, params),
  mcpHandler: (params, ctx) => addStep(serverStore(ctx.userId), params),
});

const RecordResultParams = z.object({
  itemId: ItemId,
  stepId: z.string().min(1).max(64).describe("The step's id (see list_state items[].steps.ids)."),
  status: z
    .enum(IMPROVEMENT_STEP_STATUSES)
    .optional()
    .describe("planned | running | done | dropped. done stamps when it was done."),
  expect: z.string().trim().max(TOOL_TEXT_MAX.text).optional().describe("What the team expected."),
  result: z.string().trim().max(TOOL_TEXT_MAX.text).optional().describe("What happened."),
  learned: z.string().trim().max(TOOL_TEXT_MAX.text).optional().describe("What the team learned."),
});

async function recordResult(store: Store, params: z.infer<typeof RecordResultParams>) {
  const item = await load(store, params.itemId);
  if (!item) return { updated: false as const, reason: "not_found" as const };
  const changed = withStepPatch(
    item,
    params.stepId,
    {
      ...(params.status !== undefined ? { status: params.status } : {}),
      ...(params.expect !== undefined ? { expect: params.expect } : {}),
      ...(params.result !== undefined ? { result: params.result } : {}),
      ...(params.learned !== undefined ? { learned: params.learned } : {}),
    },
    nowIso()
  );
  if (!changed.ok) {
    const reason = changed.reason === "needs_expect" ? changed.reason : "unknown_step";
    return { updated: false as const, reason };
  }
  if (!(await save(store, changed.item))) {
    return { updated: false as const, reason: "too_big" as const };
  }
  const step = changed.item.steps.find((s) => s.id === params.stepId);
  return { updated: true as const, status: step?.status ?? "planned" };
}

// ──────── tool.improve.record_result ────────
registry.register({
  id: "tool.improve.record_result",
  toolId: "tool.improve",
  name: "record_result",
  category: "write",
  requiresConfirmation: false,
  description:
    "Record how a step went: its status, what the team expected, what happened and what it learned (fields left out stay; an empty string clears one). A Kata experiment can't be running or done without what the team expects. Returns {updated: true, status}, or {updated: false, reason: 'not_found' | 'unknown_step' | 'needs_expect' | 'too_big'}.",
  paramsSchema: RecordResultParams,
  handler: (params) => recordResult(browserStore, params),
  mcpHandler: (params, ctx) => recordResult(serverStore(ctx.userId), params),
});

const LogReadingParams = z.object({
  itemId: ItemId,
  date: Day.optional().describe("The day it was read, YYYY-MM-DD (default today); never later."),
  value: z.number().finite().describe("The improvement's number that day."),
  note: z.string().trim().max(TOOL_TEXT_MAX.short).optional().describe("A short note."),
});

async function logReading(store: Store, params: z.infer<typeof LogReadingParams>) {
  const item = await load(store, params.itemId);
  if (!item) return { added: false as const, reason: "not_found" as const };
  const changed = withReading(
    item,
    { date: params.date ?? todayIso(), value: params.value, note: params.note },
    nanoid(8),
    nowIso(),
    store.latestDay()
  );
  if (!changed.ok) {
    const reason = changed.reason === "bad_value" ? ("bad_date" as const) : changed.reason;
    return { added: false as const, reason };
  }
  if (!(await save(store, changed.item)))
    return { added: false as const, reason: "too_big" as const };
  return {
    added: true as const,
    count: changed.item.readings.length,
    progressPct: progressToTarget(changed.item),
  };
}

// ──────── tool.improve.log_reading ────────
registry.register({
  id: "tool.improve.log_reading",
  toolId: "tool.improve",
  name: "log_reading",
  category: "write",
  requiresConfirmation: false,
  description:
    "Log a dated reading of an improvement's number (the one its target names). The day defaults to today and can be earlier, never later. Returns {added: true, count, progressPct|null}, or {added: false, reason: 'not_found' | 'list_full' (100 readings at most) | 'future_date' | 'bad_date' (a day that isn't on the calendar) | 'too_big'}.",
  paramsSchema: LogReadingParams,
  handler: (params) => logReading(browserStore, params),
  mcpHandler: (params, ctx) => logReading(serverStore(ctx.userId), params),
});

const AddObstacleParams = z.object({
  itemId: ItemId,
  text: z
    .string()
    .trim()
    .min(1)
    .max(TOOL_TEXT_MAX.text)
    .describe("Something in the way of the Kata's target."),
});

async function addObstacle(store: Store, params: z.infer<typeof AddObstacleParams>) {
  const item = await load(store, params.itemId);
  if (!item) return { added: false as const, reason: "not_found" as const };
  const obstacleId = nanoid(8);
  const changed = withObstacle(item, params.text, obstacleId, nowIso());
  if (!changed.ok) {
    const reason = changed.reason === "not_kata" ? changed.reason : "list_full";
    return { added: false as const, reason };
  }
  if (!(await save(store, changed.item)))
    return { added: false as const, reason: "too_big" as const };
  return { added: true as const, obstacleId, count: changed.item.obstacles.length };
}

// ──────── tool.improve.add_obstacle ────────
registry.register({
  id: "tool.improve.add_obstacle",
  toolId: "tool.improve",
  name: "add_obstacle",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add an obstacle to an Improvement Kata, open. Picking the one being worked on is done on the page (or with workspace.improvement.update: at most one is 'working'). Returns {added: true, obstacleId, count}, or {added: false, reason: 'not_found' | 'not_kata' | 'list_full' (30 at most) | 'too_big'}.",
  paramsSchema: AddObstacleParams,
  handler: (params) => addObstacle(browserStore, params),
  mcpHandler: (params, ctx) => addObstacle(serverStore(ctx.userId), params),
});
