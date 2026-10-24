/**
 * Design Sprint Tracker — tool-local actions.
 *
 * Category: Workshops & Facilitation (squad S11)
 * Tool:     5-day GV design sprint (Map / Sketch / Decide / Prototype /
 *           Test): each day's checklist and what it produced (the goal,
 *           the sprint questions, the sketches, the decision, the
 *           prototype, the findings). Today's day comes from the start date
 *           and the team's working days, as on the page.
 *
 * Agent surface: tool.design_sprint.*
 * Backing CRUD : workspace.design_sprint.* (auto-generated). Singleton: one
 *                DesignSprint document (a nullable sprint) under a fixed id.
 *
 *   1. list_state       — where the sprint stands today, each day's tasks
 *                         and outputs, the sprint questions and findings.
 *   2. start_sprint     — a sprint with the page's checklist; won't replace
 *                         one unless asked.
 *   3. add_task         — add a task to a day (1..5).
 *   4. toggle_task      — flip (or set) a task's done flag.
 *   5. add_output       — record what a day produced, on the day it belongs to.
 *   6. update_output    — edit an output in place.
 *   7. remove_output    — remove an output.
 *   8. set_answer       — Test day's answer to a Map-day sprint question.
 *   9. complete_sprint  — mark the sprint finished, or reopen it.
 *
 * Entity kind "workspace:designSprint" + DESIGN_SPRINT_ID match the page
 * (lib/design-sprint/doc, whose reads and edits both share), so MCP writes
 * round-trip into the UI.
 */

import { z } from "zod";
import { nanoid } from "nanoid";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import {
  CEREMONY_CADENCE_ID,
  type CeremonyCadenceDoc,
  type DesignSprint,
  type DesignSprintDayNumber,
  type DesignSprintOutput,
  type DesignSprintOutputKind,
  type DesignSprintPlan,
} from "@/lib/stores/workspace-types";
import { cadenceCalendar, normalizeCadence } from "@/lib/sprints/cadence";
import type { WorkingCalendar } from "@/lib/sprints/calendar";
import { todayLocalISO } from "@/lib/utils/formatters";
import {
  designSprintToday,
  shownDesignSprintDay,
  withShownDesignSprintDay,
} from "@/lib/design-sprint/day";
import { newDesignSprintPlan } from "@/lib/design-sprint/plan";
import {
  DESIGN_SPRINT_ID,
  DESIGN_SPRINT_OUTPUT_KINDS,
  INTERVIEWS,
  OUTPUT_KINDS,
  OUTPUT_TEXT_MAX,
  OUTPUT_URL_MAX,
  dayOutputs,
  findOutput,
  findingsOf,
  isWebLink,
  planDays,
  sprintQuestions,
  updateDay,
  withOutputPatch,
} from "@/lib/design-sprint/doc";

const KIND_DS = "workspace:designSprint";
/** MUST match registerCollection("ceremonyCadence", …) in workspace-store.ts. */
const KIND_CADENCE = "workspace:ceremonyCadence";

const ws = () => useWorkspaceStore.getState();

/** Where the document lives: the browser's workspace, or the user's rows on the server. */
interface DesignSprintStore {
  getDoc(): Promise<DesignSprint | null>;
  putDoc(doc: DesignSprint): Promise<void>;
  /** The team's working days and holidays, which place the five days. */
  calendar(): Promise<WorkingCalendar>;
}

const browserStore: DesignSprintStore = {
  getDoc: async () => (ws().designSprints ?? []).find((d) => d.id === DESIGN_SPRINT_ID) ?? null,
  putDoc: async (doc) => ws().upsertDesignSprint(doc),
  calendar: async () =>
    cadenceCalendar(
      normalizeCadence((ws().ceremonyCadences ?? []).find((d) => d.id === CEREMONY_CADENCE_ID))
    ),
};

function serverStore(userId: string): DesignSprintStore {
  return {
    getDoc: async () =>
      (await serverGetEntity<DesignSprint>(userId, KIND_DS, DESIGN_SPRINT_ID)) ?? null,
    putDoc: async (doc) => {
      await serverUpsertEntity<DesignSprint>(userId, KIND_DS, doc);
    },
    calendar: async () =>
      cadenceCalendar(
        normalizeCadence(
          await serverGetEntity<CeremonyCadenceDoc>(userId, KIND_CADENCE, CEREMONY_CADENCE_ID)
        )
      ),
  };
}

/**
 * Change the stored plan with `fn`, keeping `currentDay` at the day shown
 * today as the page does. `fn` gets the day shown today and returns null to
 * write nothing. Returns `fn`'s result, null when it wrote nothing, or
 * "no_sprint".
 */
async function updatePlan<T>(
  store: DesignSprintStore,
  fn: (
    plan: DesignSprintPlan,
    shownDay: DesignSprintDayNumber
  ) => { plan: DesignSprintPlan; result: T } | null
): Promise<{ result: T } | null | "no_sprint"> {
  const doc = await store.getDoc();
  if (!doc?.sprint) return "no_sprint";
  const today = todayLocalISO();
  const calendar = await store.calendar();
  const shownDay = shownDesignSprintDay(designSprintToday(doc.sprint.startDate, today, calendar));
  const changed = fn(doc.sprint, shownDay);
  if (!changed) return null;
  const plan = withShownDesignSprintDay(changed.plan, today, calendar);
  await store.putDoc({ ...doc, id: DESIGN_SPRINT_ID, sprint: plan });
  return { result: changed.result };
}

/* ── list_state ─────────────────────────────────────────────────────── */

function outputRow(o: DesignSprintOutput) {
  return {
    id: o.id,
    kind: o.kind,
    text: o.text,
    url: o.url ?? null,
    ...(o.kind === "finding"
      ? { signal: o.signal ?? null, seenIn: typeof o.seenIn === "number" ? o.seenIn : null }
      : {}),
    ...(o.kind === "sprint-question" ? { answer: o.answer ?? null } : {}),
    sentTo: (Array.isArray(o.sentTo) ? o.sentTo : []).map((l) => ({
      route: l.route,
      targetId: l.targetId,
    })),
  };
}

function summarize(doc: DesignSprint | null, today: string, calendar: WorkingCalendar) {
  const sprint = doc?.sprint ?? null;
  if (!sprint) return { exists: doc !== null, sprint: null };
  const t = designSprintToday(sprint.startDate, today, calendar);
  let totalTasks = 0;
  let doneTasks = 0;
  const days = planDays(sprint).map((d, i) => {
    const tasks = Array.isArray(d.tasks) ? d.tasks : [];
    const doneCount = tasks.filter((x) => x.done).length;
    totalTasks += tasks.length;
    doneTasks += doneCount;
    return {
      day: d.day,
      dayName: d.dayName,
      date: t.dates[i] ?? null,
      taskCount: tasks.length,
      doneCount,
      tasks: tasks.map((x) => ({ id: x.id, text: x.text, done: x.done, owner: x.owner ?? null })),
      outputs: dayOutputs(d).map(outputRow),
    };
  });
  const findings = findingsOf(sprint);
  return {
    exists: true,
    sprint: {
      id: sprint.id,
      name: sprint.name,
      description: sprint.description ?? null,
      decider: sprint.decider ?? null,
      facilitator: sprint.facilitator ?? null,
      startDate: sprint.startDate,
      status: sprint.completedAt
        ? ("completed" as const)
        : t.dates.length === 0
          ? ("invalid_start_date" as const)
          : t.status,
      day: t.day,
      ...(t.startsIn !== undefined ? { startsIn: t.startsIn } : {}),
      currentDay: shownDesignSprintDay(t),
      dates: t.dates,
      completedAt: sprint.completedAt ?? null,
      totalTasks,
      doneTasks,
      days,
      questions: sprintQuestions(sprint).map((q) => ({
        id: q.id,
        text: q.text,
        answer: q.answer ?? null,
      })),
      findings: {
        total: findings.length,
        sent: findings.filter((f) => (f.sentTo ?? []).length > 0).length,
      },
    },
  };
}

async function listState(store: DesignSprintStore) {
  return summarize(await store.getDoc(), todayLocalISO(), await store.calendar());
}

registry.register({
  id: "tool.design_sprint.list_state",
  toolId: "tool.design_sprint",
  name: "list_state",
  category: "read",
  description:
    "Where the design sprint stands. Returns {exists, sprint: null | {id, name, description, decider, facilitator, startDate, status ('upcoming' | 'running' | 'over' | 'completed' | 'invalid_start_date'), day (today's day 1-5 while running, else null), startsIn (while upcoming: day 1's place among the working days after today, 1 = the next), currentDay (the day the page shows today), dates (the five working dates, from the start date and the team's working days and holidays), completedAt, totalTasks, doneTasks, days: {day, dayName, date, taskCount, doneCount, tasks: {id, text, done, owner}[], outputs: {id, kind, text, url, signal?, seenIn?, answer?, sentTo: {route, targetId}[]}[]}[], questions: {id, text, answer}[] (the Map day's sprint questions), findings: {total, sent}}}.",
  paramsSchema: z.object({}),
  handler: async () => listState(browserStore),
  mcpHandler: async (_params, ctx) => listState(serverStore(ctx.userId)),
});

/* ── start_sprint ───────────────────────────────────────────────────── */

const ISO_DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("YYYY-MM-DD");

const StartParams = z.object({
  name: z.string().trim().min(1).max(200),
  startDate: ISO_DATE.optional().describe(
    "YYYY-MM-DD; defaults to today. Day 1 is the first working day on or after it."
  ),
  description: z.string().trim().max(4000).optional(),
  decider: z.string().trim().max(200).optional(),
  facilitator: z.string().trim().max(200).optional(),
  replace: z
    .boolean()
    .optional()
    .describe("Replace the existing sprint (its tasks and outputs are lost). Off by default."),
});

async function startSprint(store: DesignSprintStore, params: z.infer<typeof StartParams>) {
  const doc = await store.getDoc();
  if (doc?.sprint && !params.replace) {
    return { started: false, reason: "sprint_exists" as const, id: doc.sprint.id };
  }
  const today = todayLocalISO();
  const startDate = params.startDate ?? today;
  const currentDay = shownDesignSprintDay(
    designSprintToday(startDate, today, await store.calendar())
  );
  const plan = newDesignSprintPlan(
    {
      name: params.name,
      startDate,
      description: params.description || undefined,
      decider: params.decider || undefined,
      facilitator: params.facilitator || undefined,
    },
    { currentDay }
  );
  await store.putDoc({ ...(doc ?? {}), id: DESIGN_SPRINT_ID, sprint: plan });
  return { started: true, id: plan.id };
}

registry.register({
  id: "tool.design_sprint.start_sprint",
  toolId: "tool.design_sprint",
  name: "start_sprint",
  category: "write",
  requiresConfirmation: false,
  description:
    "Start a design sprint with the page's five days and each day's starting checklist (the GV agenda). startDate defaults to today; day 1 is the first working day on or after it. Refuses while a sprint exists unless replace: true. Returns {started: true, id}, or {started: false, reason: 'sprint_exists', id}.",
  paramsSchema: StartParams,
  handler: async (params) => startSprint(browserStore, params),
  mcpHandler: async (params, ctx) => startSprint(serverStore(ctx.userId), params),
});

/* ── Tasks ──────────────────────────────────────────────────────────── */

const DayParam = z
  .number()
  .int()
  .min(1)
  .max(5)
  .transform((n) => n as DesignSprintDayNumber);

const AddTaskParams = z.object({
  day: DayParam,
  text: z.string().trim().min(1).max(500),
  owner: z.string().trim().max(200).optional(),
});

async function addTask(store: DesignSprintStore, params: z.infer<typeof AddTaskParams>) {
  const id = crypto.randomUUID();
  const task = {
    id,
    text: params.text,
    done: false,
    ...(params.owner ? { owner: params.owner } : {}),
  };
  const r = await updatePlan(store, (plan) => ({
    plan: updateDay(plan, params.day, (d) => ({
      ...d,
      tasks: [...(Array.isArray(d.tasks) ? d.tasks : []), task],
    })),
    result: id,
  }));
  if (r === "no_sprint" || !r) return { added: false, reason: "no_sprint" as const };
  return { added: true, id: r.result };
}

registry.register({
  id: "tool.design_sprint.add_task",
  toolId: "tool.design_sprint",
  name: "add_task",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add a task to a sprint day (day 1..5), with an optional owner. Returns {added: true, id}, or {added: false, reason: 'no_sprint'}.",
  paramsSchema: AddTaskParams,
  handler: async (params) => addTask(browserStore, params),
  mcpHandler: async (params, ctx) => addTask(serverStore(ctx.userId), params),
});

async function toggleTask(store: DesignSprintStore, taskId: string, done: boolean | undefined) {
  const r = await updatePlan(store, (plan) => {
    const day = planDays(plan).find((d) => (d.tasks ?? []).some((t) => t.id === taskId));
    if (!day) return null;
    let value = false;
    const next = updateDay(plan, day.day, (d) => ({
      ...d,
      tasks: (d.tasks ?? []).map((t) => {
        if (t.id !== taskId) return t;
        value = done ?? !t.done;
        return { ...t, done: value };
      }),
    }));
    return { plan: next, result: value };
  });
  if (r === "no_sprint" || !r) return { updated: false };
  return { updated: true, done: r.result };
}

registry.register({
  id: "tool.design_sprint.toggle_task",
  toolId: "tool.design_sprint",
  name: "toggle_task",
  category: "write",
  requiresConfirmation: false,
  description:
    "Toggle a task's done flag by id (or set it via `done`); ids are in list_state. Returns {updated: true, done}, or {updated: false} when no sprint exists or the task id is unknown.",
  paramsSchema: z.object({
    taskId: z.string().min(1),
    done: z.boolean().optional().describe("Omit to flip the current value."),
  }),
  handler: async (params) => toggleTask(browserStore, params.taskId, params.done),
  mcpHandler: async (params, ctx) =>
    toggleTask(serverStore(ctx.userId), params.taskId, params.done),
});

/* ── Outputs ────────────────────────────────────────────────────────── */

const KindParam = z.enum(
  DESIGN_SPRINT_OUTPUT_KINDS as [DesignSprintOutputKind, ...DesignSprintOutputKind[]]
);
const SignalParam = z.enum(["positive", "negative", "mixed"]);
const UrlParam = z.string().trim().max(OUTPUT_URL_MAX);
const SeenInParam = z.number().int().min(0).max(INTERVIEWS);

type OutputRefusal = "invalid_url" | "url_not_taken" | "findings_only";

/** Why these fields don't fit an output of `kind`, as the page's form would say; null when they do. */
function refusal(
  kind: DesignSprintOutputKind,
  fields: { url?: string | null; signal?: unknown; seenIn?: unknown }
): OutputRefusal | null {
  if (fields.url) {
    if (!OUTPUT_KINDS[kind].link) return "url_not_taken";
    if (!isWebLink(fields.url)) return "invalid_url";
  }
  const judged =
    (fields.signal !== undefined && fields.signal !== null) ||
    (fields.seenIn !== undefined && fields.seenIn !== null);
  if (judged && kind !== "finding") return "findings_only";
  return null;
}

const AddOutputParams = z.object({
  kind: KindParam,
  text: z.string().trim().min(1).max(OUTPUT_TEXT_MAX),
  day: DayParam.optional().describe(
    "Only for a note (defaults to the day shown today); every other kind has its own day."
  ),
  url: UrlParam.optional().describe("A full https:// link, for the kinds that take one."),
  signal: SignalParam.optional().describe("A finding only: how the interviews took it."),
  seenIn: SeenInParam.optional().describe("A finding only: in how many of the 5 interviews."),
});

async function addOutput(store: DesignSprintStore, params: z.infer<typeof AddOutputParams>) {
  const why = refusal(params.kind, params);
  if (why) return { added: false, reason: why };
  const rule = OUTPUT_KINDS[params.kind];
  if (rule.day !== null && params.day !== undefined && params.day !== rule.day) {
    return { added: false, reason: "wrong_day" as const, day: rule.day };
  }
  const output: DesignSprintOutput = {
    id: nanoid(10),
    kind: params.kind,
    text: params.text,
    ...(params.url ? { url: params.url } : {}),
    ...(params.signal ? { signal: params.signal } : {}),
    ...(params.seenIn !== undefined ? { seenIn: params.seenIn } : {}),
    createdAt: new Date().toISOString(),
  };
  let existing: string | undefined;
  const r = await updatePlan(store, (plan, shownDay) => {
    const day = rule.day ?? params.day ?? shownDay;
    if (rule.single) {
      existing = planDays(plan)
        .flatMap(dayOutputs)
        .find((o) => o.kind === params.kind)?.id;
      if (existing) return null;
    }
    return {
      plan: updateDay(plan, day, (d) => ({ ...d, outputs: [...dayOutputs(d), output] })),
      result: day,
    };
  });
  if (r === "no_sprint") return { added: false, reason: "no_sprint" as const };
  if (!r) return { added: false, reason: "already_set" as const, id: existing };
  return { added: true, id: output.id, day: r.result };
}

registry.register({
  id: "tool.design_sprint.add_output",
  toolId: "tool.design_sprint",
  name: "add_output",
  category: "write",
  requiresConfirmation: false,
  description:
    "Record what a day produced, on the day it belongs to: long-term-goal, sprint-question, target (Map, day 1); sketch (Sketch, 2); decision, storyboard (Decide, 3); prototype (Prototype, 4); finding (Test, 5); note (any day; `day` defaults to the one shown today). The goal, target, decision, storyboard and prototype are one each: change them with update_output. url (a full https:// link) is for target, sketch, storyboard, prototype and note; signal and seenIn are for findings. Returns {added: true, id, day}, or {added: false, reason: 'no_sprint' | 'already_set' (with the id to update) | 'wrong_day' (with the kind's day) | 'invalid_url' | 'url_not_taken' | 'findings_only'}.",
  paramsSchema: AddOutputParams,
  handler: async (params) => addOutput(browserStore, params),
  mcpHandler: async (params, ctx) => addOutput(serverStore(ctx.userId), params),
});

const UpdateOutputParams = z.object({
  outputId: z.string().min(1).describe("The output's id (see list_state)."),
  text: z.string().trim().min(1).max(OUTPUT_TEXT_MAX).optional(),
  url: UrlParam.nullable().optional().describe("null or empty removes the link."),
  signal: SignalParam.nullable().optional().describe("A finding only; null: not judged."),
  seenIn: SeenInParam.nullable().optional().describe("A finding only; null clears it."),
});

async function updateOutput(store: DesignSprintStore, params: z.infer<typeof UpdateOutputParams>) {
  let why: OutputRefusal | "unknown_output" | null = null;
  const r = await updatePlan(store, (plan) => {
    const found = findOutput(plan, params.outputId);
    if (!found) {
      why = "unknown_output";
      return null;
    }
    why = refusal(found.output.kind, params);
    if (why) return null;
    const next = updateDay(plan, found.day, (d) =>
      withOutputPatch(d, params.outputId, (o) => {
        const out: DesignSprintOutput = { ...o };
        if (params.text !== undefined) out.text = params.text;
        if (params.url !== undefined) {
          if (params.url) out.url = params.url;
          else delete out.url;
        }
        if (params.signal !== undefined) {
          if (params.signal) out.signal = params.signal;
          else delete out.signal;
        }
        if (params.seenIn !== undefined) {
          if (params.seenIn !== null) out.seenIn = params.seenIn;
          else delete out.seenIn;
        }
        return out;
      })
    );
    return { plan: next, result: found.day };
  });
  if (r === "no_sprint") return { updated: false, reason: "no_sprint" as const };
  if (!r) return { updated: false, reason: why ?? ("unknown_output" as const) };
  return { updated: true, day: r.result };
}

registry.register({
  id: "tool.design_sprint.update_output",
  toolId: "tool.design_sprint",
  name: "update_output",
  category: "write",
  requiresConfirmation: false,
  description:
    "Edit an output in place, on whichever day holds it: text, url (null or empty removes it; only kinds that take a link), and for a finding signal ('positive' | 'negative' | 'mixed', null: not judged) and seenIn (0-5, null clears). Fields left out stay as they are. Returns {updated: true, day}, or {updated: false, reason: 'no_sprint' | 'unknown_output' | 'invalid_url' | 'url_not_taken' | 'findings_only'}.",
  paramsSchema: UpdateOutputParams,
  handler: async (params) => updateOutput(browserStore, params),
  mcpHandler: async (params, ctx) => updateOutput(serverStore(ctx.userId), params),
});

async function removeOutput(store: DesignSprintStore, outputId: string) {
  const r = await updatePlan(store, (plan) => {
    const found = findOutput(plan, outputId);
    if (!found) return null;
    const next = updateDay(plan, found.day, (d) => ({
      ...d,
      outputs: dayOutputs(d).filter((o) => o.id !== outputId),
    }));
    return { plan: next, result: found.output };
  });
  if (r === "no_sprint" || !r) return { removed: false };
  return { removed: true, kind: r.result.kind, text: r.result.text };
}

registry.register({
  id: "tool.design_sprint.remove_output",
  toolId: "tool.design_sprint",
  name: "remove_output",
  category: "write",
  requiresConfirmation: false,
  description:
    "Remove an output by id, on whichever day holds it. Returns {removed: true, kind, text} (to add it back), or {removed: false} when no sprint exists or the id is unknown.",
  paramsSchema: z.object({ outputId: z.string().min(1) }),
  handler: async (params) => removeOutput(browserStore, params.outputId),
  mcpHandler: async (params, ctx) => removeOutput(serverStore(ctx.userId), params.outputId),
});

async function setAnswer(
  store: DesignSprintStore,
  questionId: string,
  answer: "yes" | "no" | "unclear" | null
) {
  const r = await updatePlan(store, (plan) => {
    if (!sprintQuestions(plan).some((q) => q.id === questionId)) return null;
    const next = updateDay(plan, 1, (d) =>
      withOutputPatch(d, questionId, (o) => {
        const out = { ...o };
        if (answer) out.answer = answer;
        else delete out.answer;
        return out;
      })
    );
    return { plan: next, result: true };
  });
  if (r === "no_sprint") return { updated: false, reason: "no_sprint" as const };
  if (!r) return { updated: false, reason: "unknown_question" as const };
  return { updated: true };
}

registry.register({
  id: "tool.design_sprint.set_answer",
  toolId: "tool.design_sprint",
  name: "set_answer",
  category: "write",
  requiresConfirmation: false,
  description:
    "Record Test day's answer to one of the Map day's sprint questions (questions in list_state): 'yes' | 'no' | 'unclear', or null to clear it. Returns {updated: true}, or {updated: false, reason: 'no_sprint' | 'unknown_question'}.",
  paramsSchema: z.object({
    questionId: z.string().min(1),
    answer: z.enum(["yes", "no", "unclear"]).nullable(),
  }),
  handler: async (params) => setAnswer(browserStore, params.questionId, params.answer),
  mcpHandler: async (params, ctx) =>
    setAnswer(serverStore(ctx.userId), params.questionId, params.answer),
});

/* ── The whole sprint ───────────────────────────────────────────────── */

async function completeSprint(store: DesignSprintStore, completed: boolean) {
  const completedAt = new Date().toISOString();
  const r = await updatePlan(store, (plan) => {
    if (completed === Boolean(plan.completedAt)) return null;
    const next = { ...plan };
    if (completed) next.completedAt = completedAt;
    else delete next.completedAt;
    return { plan: next, result: completed ? completedAt : null };
  });
  if (r === "no_sprint") return { updated: false, reason: "no_sprint" as const };
  // Already in that state: nothing to write.
  if (!r) return { updated: true, unchanged: true };
  return { updated: true, completedAt: r.result };
}

registry.register({
  id: "tool.design_sprint.complete_sprint",
  toolId: "tool.design_sprint",
  name: "complete_sprint",
  category: "write",
  requiresConfirmation: false,
  description:
    "Mark the design sprint finished, as the page's Complete does, or reopen it with completed: false. Returns {updated: true, completedAt} ({unchanged: true} when it already was), or {updated: false, reason: 'no_sprint'}.",
  paramsSchema: z.object({ completed: z.boolean().optional().describe("Defaults to true.") }),
  handler: async (params) => completeSprint(browserStore, params.completed ?? true),
  mcpHandler: async (params, ctx) =>
    completeSprint(serverStore(ctx.userId), params.completed ?? true),
});
