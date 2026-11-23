/**
 * Improve: the rules every reader shares (the page, Amr's verbs in the
 * browser and on the MCP server, the next-step rule). An improvement
 * (workspace.improvements) is an A3, a problem on one page, or an
 * Improvement Kata, a target reached in small experiments with a short
 * coaching talk after each one.
 *
 * Pure and server-safe: no store, no React, no browser globals and no
 * hand-off route (a route reads the browser's store, which is empty on the
 * server). Every write goes through the caps the workspace CRUD validates
 * against (TOOL_TEXT_MAX, TOOL_LIST_MAX), so a record the page saved is
 * always one an agent can update, and the other way round.
 */

import {
  ENTITY_ROW_MAX_BYTES,
  HANDOFF_ROUTE_IDS,
  IMPROVEMENT_METHODS,
  IMPROVEMENT_STATUSES,
  IMPROVEMENT_STEP_STATUSES,
  IMPROVEMENT_UNIT_MAX,
  KATA_OBSTACLE_STATUSES,
  TOOL_LIST_MAX,
  TOOL_TEXT_MAX,
  type HandoffLink,
  type Improvement,
  type ImprovementCondition,
  type ImprovementMethod,
  type ImprovementObstacle,
  type ImprovementPastTarget,
  type ImprovementReading,
  type ImprovementStatus,
  type ImprovementStep,
  type ImprovementStepStatus,
  type KataObstacleStatus,
  type RetroBoard,
  type RetroCard,
  type RootCauseAnalysis,
  type Story,
} from "@/lib/stores/workspace-types";
import type { NextStep } from "@/lib/tools/next-steps";
import { cleanLine, cleanText } from "@/lib/root-cause/model";
import { isActionDone, targetDoneIn } from "@/lib/retro/actions";
import { krProgress } from "@/lib/okrs/progress";
import { isIsoDate } from "@/lib/sprints/calendar";
import { localDay } from "@/lib/sprints/series";
import { isExampleId } from "@/lib/utils/example-id";
import { jsonBytes } from "@/lib/utils/json-bytes";
import type { Validation } from "@/lib/utils/form";

/** Every improvement's id starts with this (the workspace.improvement CRUD's). */
export const IMPROVEMENT_ID_PREFIX = "improve_";

/** The tool id a sent step, obstacle or analysis names in its sourceRef. */
export const IMPROVE_TOOL = "improve";

export const METHOD_LABEL: Record<ImprovementMethod, string> = {
  a3: "A3",
  kata: "Improvement Kata",
};

export const STATUS_LABEL: Record<ImprovementStatus, string> = {
  open: "Open",
  checking: "Checking",
  closed: "Closed",
  dropped: "Dropped",
};

export const STEP_STATUS_LABEL: Record<ImprovementStepStatus, string> = {
  planned: "Planned",
  running: "Running",
  done: "Done",
  dropped: "Dropped",
};

export const OBSTACLE_STATUS_LABEL: Record<KataObstacleStatus, string> = {
  open: "Open",
  working: "Working on it",
  cleared: "Cleared",
};

/** Where an A3's countermeasure can be sent, in menu order (one of them, once). */
export const STEP_ROUTES = ["retro-action", "backlog-story"] as const;
export type StepRoute = (typeof STEP_ROUTES)[number];

/** The Kata experiments the AI and the coaching talk read back. */
export const PAST_EXPERIMENTS_MAX = 10;

/* ── Cleaning ───────────────────────────────────────────────────────── */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A YYYY-MM-DD day the calendar has. */
export function isDay(v: unknown): v is string {
  return typeof v === "string" && DAY.test(v) && isIsoDate(v);
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** One line, or undefined when it is blank. */
const optLine = (v: unknown, max: number): string | undefined => cleanLine(v, max) || undefined;
/** Text, or undefined when it is blank. */
const optText = (v: unknown, max: number): string | undefined => cleanText(v, max) || undefined;

/** An object with only the keys whose value isn't undefined (what the CRUD keeps). */
function compact<T extends object>(o: T): T {
  const out = { ...o } as Record<string, unknown>;
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out as T;
}

const isOf =
  <T extends string>(list: readonly T[]) =>
  (v: unknown): v is T =>
    typeof v === "string" && (list as readonly string[]).includes(v);
const isMethod = isOf(IMPROVEMENT_METHODS);
const isStatus = isOf(IMPROVEMENT_STATUSES);
const isStepStatus = isOf(IMPROVEMENT_STEP_STATUSES);
const isObstacleStatus = isOf(KATA_OBSTACLE_STATUSES);
const isRouteId = isOf(HANDOFF_ROUTE_IDS);

const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;

/** Whether an improvement fits one synced row (the CRUD refuses a bigger one). */
export function fitsRow(item: Improvement): boolean {
  return jsonBytes(item) <= ENTITY_ROW_MAX_BYTES;
}

/** What the page and the verbs say when a write would pass the row's size. */
export const TOO_BIG =
  "This improvement is too big to save. Shorten or remove some lines. Nothing was saved.";

/* ── Reading stored rows ────────────────────────────────────────────── */

function readLinks(raw: unknown): HandoffLink[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: HandoffLink[] = [];
  for (const l of raw) {
    const o = l as Record<string, unknown> | null;
    if (!o || typeof o !== "object") continue;
    if (!isRouteId(o.route) || typeof o.targetId !== "string" || !o.targetId) continue;
    if (typeof o.at !== "string") continue;
    out.push({ route: o.route, targetId: o.targetId, at: o.at });
  }
  return out.length > 0 ? out : undefined;
}

/** A stored condition made safe: capped words, a finite number, a real day. */
export function readCondition(raw: unknown): ImprovementCondition {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return compact({
    text: cleanText(o.text, TOOL_TEXT_MAX.text),
    metric: optLine(o.metric, TOOL_TEXT_MAX.short),
    value: finite(o.value) ? o.value : undefined,
    unit: optLine(o.unit, IMPROVEMENT_UNIT_MAX),
    date: isDay(o.date) ? o.date : undefined,
  });
}

/** Only the first working obstacle stays working; the rest read as open. */
function oneWorking(obstacles: ImprovementObstacle[]): ImprovementObstacle[] {
  let working = false;
  return obstacles.map((o) => {
    if (o.status !== "working") return o;
    if (!working) {
      working = true;
      return o;
    }
    return { ...o, status: "open" };
  });
}

function readObstacle(raw: unknown): ImprovementObstacle | null {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || !isId(o.id)) return null;
  const text = cleanText(o.text, TOOL_TEXT_MAX.text);
  if (!text) return null;
  return compact({
    id: o.id,
    text,
    status: isObstacleStatus(o.status) ? o.status : "open",
    sentTo: readLinks(o.sentTo),
  });
}

function readStep(raw: unknown): ImprovementStep | null {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || !isId(o.id)) return null;
  const text = cleanText(o.text, TOOL_TEXT_MAX.text);
  if (!text) return null;
  const status = isStepStatus(o.status) ? o.status : "planned";
  return compact({
    id: o.id,
    text,
    expect: optText(o.expect, TOOL_TEXT_MAX.text),
    result: optText(o.result, TOOL_TEXT_MAX.text),
    learned: optText(o.learned, TOOL_TEXT_MAX.text),
    obstacleId: isId(o.obstacleId) ? o.obstacleId : undefined,
    owner: optLine(o.owner, TOOL_TEXT_MAX.short),
    due: isDay(o.due) ? o.due : undefined,
    status,
    doneAt: status === "done" && typeof o.doneAt === "string" && o.doneAt ? o.doneAt : undefined,
    sentTo: readLinks(o.sentTo),
  });
}

function readReading(raw: unknown): ImprovementReading | null {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || !isId(o.id)) return null;
  if (!isDay(o.date) || !finite(o.value)) return null;
  return compact({
    id: o.id,
    date: o.date,
    value: o.value,
    note: optLine(o.note, TOOL_TEXT_MAX.short),
  });
}

function readPastTarget(raw: unknown): ImprovementPastTarget | null {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || typeof o.reachedAt !== "string" || !o.reachedAt) return null;
  return { ...readCondition(o), reachedAt: o.reachedAt };
}

/** Each item `read` keeps, up to `cap` of them. */
function readList<T>(raw: unknown, cap: number, read: (r: unknown) => T | null): T[] {
  const out: T[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    if (out.length >= cap) break;
    const item = read(r);
    if (item) out.push(item);
  }
  return out;
}

/**
 * A stored improvement made safe to read, rebuilt from its known fields:
 * text capped, lists cut to their caps, unknown statuses read as the first
 * (open, planned), an unknown method as an A3, rows without an id or text
 * dropped, only the first working obstacle kept working, and links rebuilt.
 * A synced row can hold anything: this keeps the page from drawing what
 * the CRUD would refuse, or crashing on it. Null for something that isn't
 * an improvement at all.
 */
export function readImprovement(raw: unknown): Improvement | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  const updatedAt = typeof r.updatedAt === "string" ? r.updatedAt : "";
  const status = isStatus(r.status) ? r.status : "open";
  const pastTargets = readList(r.pastTargets, TOOL_LIST_MAX.improvePastTargets, readPastTarget);
  return compact({
    id: r.id,
    title: cleanLine(r.title, TOOL_TEXT_MAX.short) || "Untitled improvement",
    method: isMethod(r.method) ? r.method : "a3",
    status,
    owner: optLine(r.owner, TOOL_TEXT_MAX.short),
    coach: optLine(r.coach, TOOL_TEXT_MAX.short),
    background: cleanText(r.background, TOOL_TEXT_MAX.text),
    current: readCondition(r.current),
    target: readCondition(r.target),
    pastTargets: pastTargets.length > 0 ? pastTargets : undefined,
    analysis: optText(r.analysis, TOOL_TEXT_MAX.text),
    rootCauseId: isId(r.rootCauseId) ? r.rootCauseId : undefined,
    obstacles: oneWorking(readList(r.obstacles, TOOL_LIST_MAX.kataObstacles, readObstacle)),
    steps: readList(r.steps, TOOL_LIST_MAX.improveSteps, readStep),
    readings: readList(r.readings, TOOL_LIST_MAX.improveReadings, readReading),
    check: optText(r.check, TOOL_TEXT_MAX.text),
    followUp: optText(r.followUp, TOOL_TEXT_MAX.text),
    nextCoachingAt: isDay(r.nextCoachingAt) ? r.nextCoachingAt : undefined,
    closedAt:
      (status === "closed" || status === "dropped") && typeof r.closedAt === "string" && r.closedAt
        ? r.closedAt
        : undefined,
    sentTo: readLinks(r.sentTo),
    createdAt: typeof r.createdAt === "string" ? r.createdAt : updatedAt,
    updatedAt,
  });
}

/**
 * The stored improvements made safe to read (see readImprovement), dropping
 * what isn't one at all. Anything that reads workspace.improvements outside
 * the page (a next step, Root Cause's "Used in Improve") goes through this.
 */
export function readImprovements(raw: unknown): Improvement[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => {
    const item = readImprovement(r);
    return item ? [item] : [];
  });
}

/** Newest change first. */
export function newestFirst(list: readonly Improvement[]): Improvement[] {
  return [...list].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

/* ── Starting one ───────────────────────────────────────────────────── */

export interface NewImprovement {
  title: string;
  method: ImprovementMethod;
  background?: string;
  analysis?: string;
  rootCauseId?: string;
  /** Rows to start with (a countermeasure seeded from a Root Cause analysis). */
  steps?: ImprovementStep[];
}

/** A new improvement, open, stamped `now`. */
export function blankImprovement(input: NewImprovement, id: string, now: string): Improvement {
  return compact({
    id,
    title: cleanLine(input.title, TOOL_TEXT_MAX.short),
    method: input.method,
    status: "open" as const,
    background: cleanText(input.background ?? "", TOOL_TEXT_MAX.text),
    current: { text: "" },
    target: { text: "" },
    analysis: optText(input.analysis, TOOL_TEXT_MAX.text),
    rootCauseId: isId(input.rootCauseId) ? input.rootCauseId : undefined,
    obstacles: [],
    steps: (input.steps ?? []).slice(0, TOOL_LIST_MAX.improveSteps),
    readings: [],
    createdAt: now,
    updatedAt: now,
  });
}

/** What the start form and the title box say when the title is left blank. */
export const BLANK_TITLE = "Name what you'll improve in a few words.";

export interface ImprovementDraft {
  title: string;
  method: ImprovementMethod | "";
}

export type ImprovementDraftField = "title" | "method";

/** A new improvement's draft checked: a title within its cap and a method. */
export function validateImprovementDraft(
  draft: ImprovementDraft
): Validation<{ title: string; method: ImprovementMethod }, ImprovementDraftField> {
  const errors: Partial<Record<ImprovementDraftField, string>> = {};
  const title = draft.title.replace(/\s+/g, " ").trim();
  if (!title) errors.title = BLANK_TITLE;
  else if (title.length > TOOL_TEXT_MAX.short)
    errors.title = `Keep it to ${TOOL_TEXT_MAX.short} characters.`;
  if (!isMethod(draft.method)) errors.method = "Pick an A3 or an Improvement Kata.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, values: { title, method: draft.method as ImprovementMethod } };
}

/* ── Changes (pure: each returns the next improvement, or why it can't) ── */

/** A change that worked, or why it was refused. */
export type Changed<R extends string> = { ok: true; item: Improvement } | { ok: false; reason: R };

/** The improvement with `patch` merged in and `updatedAt` = `now`. */
export function touched(item: Improvement, patch: Partial<Improvement>, now: string): Improvement {
  return compact({ ...item, ...patch, updatedAt: now });
}

/** A condition (where things are, or where they should be) changed field by field. */
export function withCondition(
  item: Improvement,
  which: "current" | "target",
  patch: Partial<ImprovementCondition>,
  now: string
): Improvement {
  const next = readCondition({ ...item[which], ...patch });
  return touched(item, { [which]: next }, now);
}

/**
 * The status changed: closedAt stamped when it is closed or dropped (when it
 * has none), and cleared when it is open or being checked again.
 */
export function withStatus(item: Improvement, status: ImprovementStatus, now: string): Improvement {
  const closing = status === "closed" || status === "dropped";
  return touched(item, { status, closedAt: closing ? (item.closedAt ?? now) : undefined }, now);
}

/** What a step is given: a countermeasure on an A3, an experiment on a Kata. */
export interface StepInput {
  text: string;
  expect?: string;
  result?: string;
  learned?: string;
  owner?: string;
  due?: string;
  obstacleId?: string;
  status?: ImprovementStepStatus;
}

export type StepRefusal =
  | "blank"
  | "list_full"
  | "unknown_obstacle"
  | "needs_expect"
  | "unknown_step"
  | "bad_due";

/** What the page says for each refusal. */
export const STEP_REFUSAL_TEXT: Record<StepRefusal, string> = {
  blank: "Say what you'll try or change.",
  list_full: `An improvement holds ${TOOL_LIST_MAX.improveSteps} steps at most. Remove one first.`,
  unknown_obstacle: "That obstacle isn't on this Kata.",
  needs_expect: "Say what you expect before you try.",
  unknown_step: "That step isn't there any more.",
  bad_due: "Give the date as a real day.",
};

/**
 * Why a step can't have its status: a Kata experiment can't be running or
 * done without what the team expects to happen. An A3 countermeasure can.
 */
export function validateStep(
  method: ImprovementMethod,
  step: Pick<ImprovementStep, "status" | "expect">
): "needs_expect" | null {
  if (method !== "kata") return null;
  if (step.status !== "running" && step.status !== "done") return null;
  return step.expect?.trim() ? null : "needs_expect";
}

/** The step a patch makes, stamping doneAt when it is done and dropping it when it isn't. */
function stepFrom(base: ImprovementStep, patch: Partial<StepInput>, now: string): ImprovementStep {
  const merged = { ...base } as ImprovementStep;
  if (patch.text !== undefined) merged.text = cleanText(patch.text, TOOL_TEXT_MAX.text);
  for (const k of ["expect", "result", "learned"] as const) {
    if (patch[k] !== undefined) merged[k] = optText(patch[k], TOOL_TEXT_MAX.text);
  }
  if (patch.owner !== undefined) merged.owner = optLine(patch.owner, TOOL_TEXT_MAX.short);
  if (patch.due !== undefined) merged.due = patch.due || undefined;
  if (patch.obstacleId !== undefined) merged.obstacleId = patch.obstacleId || undefined;
  if (patch.status !== undefined) merged.status = patch.status;
  if (merged.status === "done") merged.doneAt = merged.doneAt ?? now;
  else delete merged.doneAt;
  return compact(merged);
}

function checkStep(item: Improvement, step: ImprovementStep): StepRefusal | null {
  if (!step.text) return "blank";
  if (step.due !== undefined && !isDay(step.due)) return "bad_due";
  if (step.obstacleId !== undefined && !item.obstacles.some((o) => o.id === step.obstacleId)) {
    return "unknown_obstacle";
  }
  return validateStep(item.method, step);
}

/** A step added at the end (planned unless said); refused past the cap. */
export function withStep(
  item: Improvement,
  input: StepInput,
  id: string,
  now: string
): Changed<StepRefusal> {
  if (item.steps.length >= TOOL_LIST_MAX.improveSteps) return { ok: false, reason: "list_full" };
  const step = stepFrom({ id, text: "", status: input.status ?? "planned" }, input, now);
  const why = checkStep(item, step);
  if (why) return { ok: false, reason: why };
  return { ok: true, item: touched(item, { steps: [...item.steps, step] }, now) };
}

/** One step changed in place. */
export function withStepPatch(
  item: Improvement,
  stepId: string,
  patch: Partial<StepInput>,
  now: string
): Changed<StepRefusal> {
  const cur = item.steps.find((s) => s.id === stepId);
  if (!cur) return { ok: false, reason: "unknown_step" };
  const step = stepFrom(cur, patch, now);
  // A dangling obstacle the step already had (that obstacle was deleted) stays.
  const why = checkStep(
    item,
    step.obstacleId === cur.obstacleId ? { ...step, obstacleId: undefined } : step
  );
  if (why) return { ok: false, reason: why };
  return {
    ok: true,
    item: touched(item, { steps: item.steps.map((s) => (s.id === stepId ? step : s)) }, now),
  };
}

/** The step's links replaced (a send, or its Undo). */
export function withStepLinks(
  item: Improvement,
  stepId: string,
  links: HandoffLink[],
  now: string
): Improvement | null {
  if (!item.steps.some((s) => s.id === stepId)) return null;
  return touched(
    item,
    {
      steps: item.steps.map((s) =>
        s.id === stepId ? compact({ ...s, sentTo: links.length > 0 ? links : undefined }) : s
      ),
    },
    now
  );
}

/** A list without the row `id`, or null when it isn't there. */
function without<T extends { id: string }>(list: readonly T[], id: string): T[] | null {
  return list.some((x) => x.id === id) ? list.filter((x) => x.id !== id) : null;
}

/** A list with `row` put back at `index` (Undo), unless it is there already. */
function withAt<T extends { id: string }>(list: readonly T[], row: T, index: number): T[] {
  if (list.some((x) => x.id === row.id)) return [...list];
  const next = [...list];
  next.splice(Math.min(Math.max(0, index), next.length), 0, row);
  return next;
}

export function withoutStep(item: Improvement, stepId: string, now: string): Improvement | null {
  const steps = without(item.steps, stepId);
  return steps ? touched(item, { steps }, now) : null;
}

/** A deleted step put back where it was (Undo). */
export function withStepAt(
  item: Improvement,
  step: ImprovementStep,
  index: number,
  now: string
): Improvement {
  return touched(item, { steps: withAt(item.steps, step, index) }, now);
}

export type ObstacleRefusal = "blank" | "not_kata" | "list_full";

export const OBSTACLE_REFUSAL_TEXT: Record<ObstacleRefusal, string> = {
  blank: "Say what's in the way.",
  not_kata: "Obstacles belong to an Improvement Kata.",
  list_full: `A Kata holds ${TOOL_LIST_MAX.kataObstacles} obstacles at most. Clear or remove one first.`,
};

/** An obstacle added to a Kata, open. */
export function withObstacle(
  item: Improvement,
  text: string,
  id: string,
  now: string
): Changed<ObstacleRefusal> {
  if (item.method !== "kata") return { ok: false, reason: "not_kata" };
  const clean = cleanText(text, TOOL_TEXT_MAX.text);
  if (!clean) return { ok: false, reason: "blank" };
  if (item.obstacles.length >= TOOL_LIST_MAX.kataObstacles) {
    return { ok: false, reason: "list_full" };
  }
  return {
    ok: true,
    item: touched(
      item,
      { obstacles: [...item.obstacles, { id, text: clean, status: "open" }] },
      now
    ),
  };
}

/**
 * One obstacle changed: its words, or its status. Picking one to work on
 * moves the one worked on before back to open, so at most one is working.
 */
export function withObstaclePatch(
  item: Improvement,
  obstacleId: string,
  patch: { text?: string; status?: KataObstacleStatus },
  now: string
): Improvement | null {
  const cur = item.obstacles.find((o) => o.id === obstacleId);
  if (!cur) return null;
  const text = patch.text !== undefined ? cleanText(patch.text, TOOL_TEXT_MAX.text) : cur.text;
  if (!text) return null;
  const status = patch.status ?? cur.status;
  const obstacles = item.obstacles.map((o) => {
    if (o.id === obstacleId) return { ...o, text, status };
    if (status === "working" && o.status === "working") return { ...o, status: "open" as const };
    return o;
  });
  return touched(item, { obstacles }, now);
}

export function withObstacleLinks(
  item: Improvement,
  obstacleId: string,
  links: HandoffLink[],
  now: string
): Improvement | null {
  if (!item.obstacles.some((o) => o.id === obstacleId)) return null;
  return touched(
    item,
    {
      obstacles: item.obstacles.map((o) =>
        o.id === obstacleId ? compact({ ...o, sentTo: links.length > 0 ? links : undefined }) : o
      ),
    },
    now
  );
}

export function withoutObstacle(
  item: Improvement,
  obstacleId: string,
  now: string
): Improvement | null {
  const obstacles = without(item.obstacles, obstacleId);
  return obstacles ? touched(item, { obstacles }, now) : null;
}

export function withObstacleAt(
  item: Improvement,
  obstacle: ImprovementObstacle,
  index: number,
  now: string
): Improvement {
  return touched(item, { obstacles: oneWorking(withAt(item.obstacles, obstacle, index)) }, now);
}

export interface ReadingInput {
  date: string;
  value: number;
  note?: string;
}

export type ReadingRefusal = "list_full" | "future_date" | "bad_date" | "bad_value";

export const READING_REFUSAL_TEXT: Record<ReadingRefusal, string> = {
  list_full: `An improvement keeps ${TOOL_LIST_MAX.improveReadings} readings at most. Remove an old one first.`,
  future_date: "A reading can't be for a day that hasn't come yet.",
  bad_date: "Give the day as a real date.",
  bad_value: "Give the reading as a number.",
};

/**
 * A dated reading added. `latestDay` is the latest day one may be for
 * (latestCheckInDay from lib/okrs/progress: today on the person's own
 * clock, a day more on another one), as OKR check-ins are.
 */
export function withReading(
  item: Improvement,
  input: ReadingInput,
  id: string,
  now: string,
  latestDay: string
): Changed<ReadingRefusal> {
  if (!isDay(input.date)) return { ok: false, reason: "bad_date" };
  if (input.date > latestDay) return { ok: false, reason: "future_date" };
  if (!finite(input.value)) return { ok: false, reason: "bad_value" };
  if (item.readings.length >= TOOL_LIST_MAX.improveReadings) {
    return { ok: false, reason: "list_full" };
  }
  const reading = compact({
    id,
    date: input.date,
    value: input.value,
    note: optLine(input.note, TOOL_TEXT_MAX.short),
  });
  return { ok: true, item: touched(item, { readings: [...item.readings, reading] }, now) };
}

export function withoutReading(
  item: Improvement,
  readingId: string,
  now: string
): Improvement | null {
  const readings = without(item.readings, readingId);
  return readings ? touched(item, { readings }, now) : null;
}

export function withReadingAt(
  item: Improvement,
  reading: ImprovementReading,
  index: number,
  now: string
): Improvement {
  return touched(item, { readings: withAt(item.readings, reading, index) }, now);
}

/** Whether a condition says anything: words or a number. */
export function hasCondition(c: ImprovementCondition): boolean {
  return Boolean(c.text.trim()) || finite(c.value);
}

/**
 * "Reached it": the target joins the past targets (stamped `now`; the
 * oldest goes once there are TOOL_LIST_MAX.improvePastTargets), where
 * things stand becomes the reached target's words with the latest
 * reading's value and day (no reading: the target's value, on the day it
 * was reached), and the target is cleared (its metric and unit kept for the
 * next one). So the next target's progress starts from where the team
 * stands. Null when there is no target to reach.
 */
export function withTargetReached(item: Improvement, now: string): Improvement | null {
  const target = item.target;
  if (!hasCondition(target)) return null;
  const latest = latestReading(item);
  const reached: ImprovementPastTarget = { ...target, reachedAt: now };
  const pastTargets = [...(item.pastTargets ?? []), reached].slice(
    -TOOL_LIST_MAX.improvePastTargets
  );
  const current = compact({
    text: target.text,
    metric: target.metric ?? item.current.metric,
    value: latest?.value ?? target.value,
    unit: target.unit ?? item.current.unit,
    date: latest?.date ?? localDay(now) ?? undefined,
  });
  const next = compact({ text: "", metric: target.metric, unit: target.unit });
  return touched(item, { pastTargets, current, target: next }, now);
}

export function withoutPastTarget(
  item: Improvement,
  index: number,
  now: string
): Improvement | null {
  const list = item.pastTargets ?? [];
  if (index < 0 || index >= list.length) return null;
  const pastTargets = list.filter((_, i) => i !== index);
  return touched(item, { pastTargets: pastTargets.length > 0 ? pastTargets : undefined }, now);
}

export function withPastTargetAt(
  item: Improvement,
  target: ImprovementPastTarget,
  index: number,
  now: string
): Improvement {
  const next = [...(item.pastTargets ?? [])];
  next.splice(Math.min(Math.max(0, index), next.length), 0, target);
  return touched(item, { pastTargets: next.slice(-TOOL_LIST_MAX.improvePastTargets) }, now);
}

/* ── Reading an improvement ─────────────────────────────────────────── */

/** The readings oldest day first (same day: as logged). */
export function sortedReadings(item: Pick<Improvement, "readings">): ImprovementReading[] {
  return item.readings
    .map((r, i) => ({ r, i }))
    .sort((a, b) => a.r.date.localeCompare(b.r.date) || a.i - b.i)
    .map(({ r }) => r);
}

/** The newest-dated reading (same day: the last logged), or null. */
export function latestReading(item: Pick<Improvement, "readings">): ImprovementReading | null {
  const sorted = sortedReadings(item);
  return sorted[sorted.length - 1] ?? null;
}

/** The obstacle a Kata is working on, if any. */
export function workingObstacle(item: Improvement): ImprovementObstacle | null {
  return item.obstacles.find((o) => o.status === "working") ?? null;
}

/** The last experiment that wasn't dropped: the one a coaching talk asks about. */
export function lastExperiment(item: Improvement): ImprovementStep | null {
  return [...item.steps].reverse().find((s) => s.status !== "dropped") ?? null;
}

/** Experiments planned or running (a Kata's next try). */
export function openExperiments(item: Improvement): ImprovementStep[] {
  return item.steps.filter((s) => s.status === "planned" || s.status === "running");
}

/**
 * How far it has come towards the target, 0–100: OKR progress
 * (lib/okrs/progress krProgress) from where things stood (`current`) to
 * the target, read at the latest reading (no reading: where things stood).
 * It handles lower-is-better and a starting point equal to the target.
 * Null unless both numbers are set.
 */
export function progressToTarget(item: Improvement): number | null {
  const baseline = item.current.value;
  const target = item.target.value;
  if (!finite(baseline) || !finite(target)) return null;
  const now = latestReading(item)?.value ?? baseline;
  return Math.round(krProgress({ baseline, current: now, target }) * 100);
}

const fmtValue = (n: number) => String(Math.round(n * 100) / 100);

/** A value with its unit: "19 h". */
export function valueText(c: Pick<ImprovementCondition, "value" | "unit">): string {
  if (!finite(c.value)) return "";
  return c.unit ? `${fmtValue(c.value)} ${c.unit}` : fmtValue(c.value);
}

/**
 * A condition in one line: "Words: metric value unit by day" ("on day" for
 * where things stand). What the AI reads, and the Markdown.
 */
export function composeCondition(c: ImprovementCondition, dateWord: "by" | "on" = "by"): string {
  const measure = [c.metric?.trim(), valueText(c)].filter(Boolean).join(" ");
  const when = c.date ? `${dateWord} ${c.date}` : "";
  const tail = [measure, when].filter(Boolean).join(" ");
  return [c.text.trim(), tail].filter(Boolean).join(": ");
}

/* ── When a step is done ────────────────────────────────────────────── */

/** Whether a step is done, and the day it was (when known). */
export type StepDone = (step: ImprovementStep) => { done: boolean; day?: string };

/**
 * When a step is done, read from the workspace: its own status says done
 * (the day: its doneAt); or the action it was sent to Retro Actions as is
 * done, or a copy of it carried onto a later retro (each read with
 * isActionDone, so an action whose own hand-off target finished counts too;
 * the day: that card's doneAt); or the backlog story it was sent as is done
 * (the day: the story's doneAt). A card or story that was deleted is never
 * done, so the step reads as open again. Days are the person's local days.
 */
export function stepDoneIn(data: {
  boards: readonly RetroBoard[] | undefined;
  stories: readonly Story[] | undefined;
}): StepDone {
  const boards = Array.isArray(data.boards) ? data.boards : [];
  const stories = Array.isArray(data.stories) ? data.stories : [];
  const cards = new Map<string, RetroCard>();
  const copies = new Map<string, RetroCard[]>();
  for (const b of boards) {
    for (const c of Array.isArray(b?.cards) ? b.cards : []) {
      if (!c || typeof c.id !== "string") continue;
      cards.set(c.id, c);
      if (c.carriedFrom) copies.set(c.carriedFrom, [...(copies.get(c.carriedFrom) ?? []), c]);
    }
  }
  const targetDone = targetDoneIn({ stories });
  const doneCard = (card: RetroCard, seen: Set<string>): RetroCard | null => {
    if (isActionDone(card, targetDone)) return card;
    if (seen.has(card.id)) return null;
    seen.add(card.id);
    for (const copy of copies.get(card.id) ?? []) {
      const found = doneCard(copy, seen);
      if (found) return found;
    }
    return null;
  };
  const day = (at: string | undefined) => localDay(at) ?? undefined;
  return (step) => {
    if (step.status === "done") return compact({ done: true, day: day(step.doneAt) });
    for (const link of step.sentTo ?? []) {
      if (link.route === "retro-action") {
        const card = cards.get(link.targetId);
        const done = card ? doneCard(card, new Set()) : null;
        if (done) return compact({ done: true, day: day(done.doneAt) });
      } else if (link.route === "backlog-story") {
        const story = stories.find((s) => s.id === link.targetId && s.status === "done");
        if (story) return compact({ done: true, day: day(story.doneAt) });
      }
    }
    return { done: false };
  };
}

/** Steps nothing done reads as done (no links to look up). */
export const ownStatusOnly: StepDone = stepDoneIn({ boards: [], stories: [] });

/* ── A3 gap checks ──────────────────────────────────────────────────── */

export type A3GapId =
  | "why"
  | "current-number"
  | "target-number"
  | "target-is-current"
  | "cause"
  | "change"
  | "owners"
  | "measure-again"
  | "check";

export interface A3Gap {
  id: A3GapId;
  text: string;
}

export const A3_GAP_TEXT: Record<A3GapId, string> = {
  why: "Say why this matters now.",
  "current-number": "Give today's state a number.",
  "target-number": "Give the target a number and a date.",
  "target-is-current": "The target is where you are now.",
  cause: "Write the cause, or link a Root Cause analysis.",
  change: "Say what you'll change.",
  owners: "Give each countermeasure an owner and a date.",
  "measure-again": "Every countermeasure is done: measure again.",
  check: "Say what the check showed.",
};

/**
 * Whether the A3 was measured after its countermeasures: every one that
 * isn't dropped is done, and a reading is dated on or after the latest day
 * one was done. A done step with no known day holds back no reading. Null
 * while a countermeasure is still to do (or there is none).
 */
function a3Measured(item: Improvement, done: StepDone): boolean | null {
  const live = item.steps.filter((s) => s.status !== "dropped");
  if (live.length === 0) return null;
  const states = live.map(done);
  if (!states.every((s) => s.done)) return null;
  const days = states.map((s) => s.day).filter((d): d is string => Boolean(d));
  const latest = days.sort().pop();
  return item.readings.some((r) => latest === undefined || r.date >= latest);
}

/**
 * What an A3 still lacks, in the page's order, each line shown exactly
 * while its condition holds (`analysis` is the linked Root Cause analysis,
 * `done` reads each countermeasure's state). "Say what you'll change" and
 * "Give each countermeasure an owner and a date" never show together, nor
 * do "measure again" and "Say what the check showed". None for a Kata.
 */
export function a3Gaps(
  item: Improvement,
  { analysis, done = ownStatusOnly }: { analysis?: RootCauseAnalysis | null; done?: StepDone } = {}
): A3Gap[] {
  if (item.method !== "a3") return [];
  const ids: A3GapId[] = [];
  if (!item.background.trim()) ids.push("why");
  if (!finite(item.current.value)) ids.push("current-number");
  if (!finite(item.target.value) || !item.target.date) ids.push("target-number");
  if (finite(item.current.value) && finite(item.target.value)) {
    if (item.current.value === item.target.value) ids.push("target-is-current");
  }
  if (!item.analysis?.trim() && !analysis?.rootCause?.trim()) ids.push("cause");
  const live = item.steps.filter((s) => s.status !== "dropped");
  if (live.length === 0) ids.push("change");
  else if (live.some((s) => !done(s).done && (!s.owner?.trim() || !s.due))) ids.push("owners");
  const measured = a3Measured(item, done);
  if (measured === false) ids.push("measure-again");
  else if (measured === true && !item.check?.trim()) ids.push("check");
  return ids.map((id) => ({ id, text: A3_GAP_TEXT[id] }));
}

/* ── Kata checks and coaching ───────────────────────────────────────── */

export type KataCheckId = "target-date" | "expect";

export const KATA_CHECK_TEXT: Record<KataCheckId, string> = {
  "target-date": "The target date has passed: reached, or reset it?",
  expect: "Say what you expect before you try.",
};

/** A Kata's inline checks: a target date gone by, a planned experiment with no expectation. */
export function kataChecks(item: Improvement, today: string): { id: KataCheckId; text: string }[] {
  if (item.method !== "kata" || !isActive(item)) return [];
  const ids: KataCheckId[] = [];
  if (item.target.date && item.target.date < today && hasCondition(item.target)) {
    ids.push("target-date");
  }
  if (item.steps.some((s) => s.status === "planned" && !s.expect?.trim())) ids.push("expect");
  return ids.map((id) => ({ id, text: KATA_CHECK_TEXT[id] }));
}

/** Open or being checked: still being worked on. */
export function isActive(item: Pick<Improvement, "status">): boolean {
  return item.status === "open" || item.status === "checking";
}

/** Whether a Kata's coaching talk is due: its next coaching day is today or gone by. */
export function coachingDue(item: Improvement, today: string): boolean {
  return (
    item.method === "kata" &&
    isActive(item) &&
    typeof item.nextCoachingAt === "string" &&
    item.nextCoachingAt <= today
  );
}

/* ── Verdicts ───────────────────────────────────────────────────────── */

export interface VerdictContext {
  today: string;
  done?: StepDone;
  /** The Root Cause analyses, to find each A3's linked one. */
  analyses?: readonly RootCauseAnalysis[];
}

const linkedAnalysis = (item: Improvement, analyses: readonly RootCauseAnalysis[] = []) =>
  item.rootCauseId ? analyses.find((a) => a.id === item.rootCauseId) : undefined;

/** The A3's gaps, read against its linked analysis and the steps' links. */
export function gapsIn(item: Improvement, ctx: VerdictContext): A3Gap[] {
  return a3Gaps(item, { analysis: linkedAnalysis(item, ctx.analyses), done: ctx.done });
}

/** One line on where an improvement stands, for its row in the list. */
export function itemVerdict(item: Improvement, ctx: VerdictContext): string {
  const pct = progressToTarget(item);
  const way = pct === null ? "" : `${pct}% of the way to the target`;
  if (item.status === "closed") return way ? `Closed, ${way}.` : "Closed.";
  if (item.status === "dropped") return "Dropped.";
  if (item.method === "kata") {
    if (coachingDue(item, ctx.today)) return "The coaching talk is due.";
    if (!hasCondition(item.target)) return "Set the next target.";
    if (!workingObstacle(item)) return "Pick the obstacle you're on.";
    if (openExperiments(item).length === 0) return "Plan the next experiment.";
    return way ? `${way[0].toUpperCase()}${way.slice(1)}.` : "An experiment is under way.";
  }
  const gaps = gapsIn(item, ctx);
  if (gaps.some((g) => g.id === "measure-again")) return A3_GAP_TEXT["measure-again"];
  if (way) {
    const lead = `${way[0].toUpperCase()}${way.slice(1)}`;
    return gaps.length > 0
      ? `${lead}, ${gaps.length} ${gaps.length === 1 ? "check" : "checks"} open.`
      : `${lead}.`;
  }
  return gaps[0]?.text ?? "Every check is met: see whether it worked.";
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * One sentence on the improvements: what to do next across them. Example
 * rows are the caller's to leave out (the page and list_state do).
 */
export function improveVerdict(items: readonly Improvement[], ctx: VerdictContext): string {
  if (items.length === 0) return "No improvement yet.";
  const active = items.filter(isActive);
  if (active.length === 0) {
    return "Every improvement is closed or dropped: start the next one when a retro names it.";
  }
  const due = active.filter((i) => coachingDue(i, ctx.today)).length;
  if (due > 0) {
    return `${count(due, "coaching talk")} ${due === 1 ? "is" : "are"} due: walk ${due === 1 ? "it" : "them"} with Coach me.`;
  }
  const measure = active.filter((i) => gapsIn(i, ctx).some((g) => g.id === "measure-again")).length;
  if (measure > 0) {
    return `${count(measure, "A3")} ${measure === 1 ? "has" : "have"} every countermeasure done: measure again to see whether it worked.`;
  }
  const pcts = active.map(progressToTarget).filter((p): p is number => p !== null);
  const under = `${count(active.length, "improvement")} under way`;
  if (pcts.length === 0) return `${under}: give each a number to see how far it has come.`;
  const mean = Math.round(pcts.reduce((s, p) => s + p, 0) / pcts.length);
  return `${under}, ${mean}% of the way to target on average.`;
}

/* ── Next steps ─────────────────────────────────────────────────────── */

/** What the rule reads from the workspace. */
export interface ImproveStepsInput {
  items: readonly Improvement[] | undefined;
  boards: readonly RetroBoard[] | undefined;
  stories: readonly Story[];
}

const clip = (s: string, max = 48) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
const itemHref = (id: string) => `/improve?item=${encodeURIComponent(id)}`;

/**
 * Improve's next steps, given today (YYYY-MM-DD), for the team's own
 * improvements still being worked on (newest change first, one step of each
 * kind): a Kata's coaching talk that is due, an A3 whose countermeasures
 * are all done with no reading since, a Kata with no obstacle being worked
 * on, and a Kata with an obstacle but no experiment planned or running.
 */
export function improveSteps(s: ImproveStepsInput, today: string): NextStep[] {
  const items = newestFirst(readImprovements(s.items)).filter(
    (i) => !isExampleId(i.id) && isActive(i)
  );
  const done = stepDoneIn({ boards: s.boards, stories: s.stories });
  const steps: NextStep[] = [];
  const kata = items.filter((i) => i.method === "kata");

  const due = kata.find((i) => coachingDue(i, today));
  if (due) {
    steps.push({
      id: "improve-coach",
      label: `Coach “${clip(due.title)}”: the talk is due`,
      detail: "A few minutes on what the last try showed and what to try next.",
      href: itemHref(due.id),
    });
  }
  const measure = items.find(
    (i) => i.method === "a3" && a3Gaps(i, { done }).some((g) => g.id === "measure-again")
  );
  if (measure) {
    steps.push({
      id: "improve-check",
      label: `Measure “${clip(measure.title)}” again: did it work?`,
      detail: "Every countermeasure is done, and nothing was measured since.",
      href: itemHref(measure.id),
    });
  }
  const stuck = kata.find((i) => !workingObstacle(i));
  if (stuck) {
    const open = stuck.obstacles.some((o) => o.status === "open");
    steps.push({
      id: "improve-obstacle",
      label: open
        ? `Pick what's in the way of “${clip(stuck.title)}”`
        : `Name what's in the way of “${clip(stuck.title)}”`,
      detail: open
        ? "Work on one obstacle at a time: the next experiment goes after it."
        : "An experiment needs an obstacle to work on.",
      href: itemHref(stuck.id),
    });
  }
  const idle = kata.find((i) => workingObstacle(i) && openExperiments(i).length === 0);
  if (idle) {
    steps.push({
      id: "improve-next-experiment",
      label: `Plan the next experiment for “${clip(idle.title)}”`,
      detail: "Say what you'll try and what you expect to happen.",
      href: itemHref(idle.id),
    });
  }
  return steps;
}
