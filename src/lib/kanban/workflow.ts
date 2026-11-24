/**
 * Kanban's Definition of Workflow: the one document (WORKFLOW_DEFINITION_ID)
 * a team writes to say how work moves on one of its boards. What one work
 * item is, where it starts and finishes, the policies at each stage, the
 * WIP, pull and blocker policies, a policy per class of service, a service
 * level expectation, the STATIK notes it was designed from, the team's
 * Kanban cadences and its saved versions.
 *
 * Pure (no store, no React), so the page and the tool.kanban.* agent
 * actions read, cap and compare it the same way:
 *   - `normalizeWorkflowDefinition` reads a stored or agent-written row
 *     defensively and enforces every cap the CRUD schema has;
 *   - `mergeWorkflow` applies a partial change (null clears a field);
 *   - `sameWorkflowContent` tells whether a save changed anything;
 *   - `withSavedVersion` snapshots it with the board's WIP limits;
 *   - `compareVersion` reads a board's items before and after a version was
 *     saved (`compareBoard` says which board);
 *   - `sleFromHistory` suggests an SLE from the board's finished items.
 */

import {
  KANBAN_BOARD_ID,
  MEETING_CADENCES,
  TOOL_LIST_MAX,
  TOOL_TEXT_MAX,
  WORK_TYPES,
  WORKFLOW_DEFINITION_ID,
  WORKFLOW_SLE_PERCENTILES,
} from "@/lib/stores/workspace-types";
import type {
  KanbanBoard,
  KanbanCadence,
  KanbanClassOfService,
  KanbanColumnId,
  MeetingCadence,
  StatikNotes,
  Story,
  WorkType,
  WorkflowClassPolicy,
  WorkflowDefinition,
  WorkflowSlePercentile,
  WorkflowSnapshot,
  WorkflowStagePolicy,
  WorkflowVersion,
  WorkflowWorkType,
} from "@/lib/stores/workspace-types";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { cutText } from "@/lib/utils/cut-text";
import { percentile } from "@/lib/sprints/metrics";
import { todayIso } from "@/lib/sprints/series";
import { cardItems, storyItems } from "@/lib/flow/items";
import { cycleSummary, finishedItems } from "@/lib/flow/cycle";
import { dailyCounts, wipOf } from "@/lib/flow/counts";
import { weekOf } from "@/lib/flow/throughput";
import { addDays, dayNumber } from "@/lib/flow/days";
import type { FlowItem, FlowWorkflow } from "@/lib/flow/types";
import { boardWorkflow, describedBoard, isWorkflowBoard, wipColumns } from "./workflow-view";
import type { WorkflowBoard } from "./workflow-view";

// The board-side names and readers live in ./workflow-view, so the boards
// load them without this module's engine; this module re-exports them.
export {
  BOARD_NAME,
  CADENCE_LABEL,
  CLASS_LABEL,
  blockNotedPayload,
  boardWorkflow,
  describedBoard,
  isWorkflowBoard,
  policyStages,
  sleText,
  stagePolicy,
  wipColumns,
} from "./workflow-view";
export type { WorkflowBoard } from "./workflow-view";

/* ── Caps (the CRUD schema's, so a page save is always one an agent can update) ── */

/** Every policy and short text on the definition. */
export const WORKFLOW_TEXT_MAX = TOOL_TEXT_MAX.short;
/** One STATIK note. */
export const STATIK_NOTE_MAX = TOOL_TEXT_MAX.text;
/** A stage id on a policy. */
export const STAGE_ID_MAX = 20;
/** Stage policies: one per stage, Done left out. */
export const STAGE_POLICIES_MAX = 6;
export const WORKFLOW_VERSIONS_MAX = TOOL_LIST_MAX.workflowVersions;
export const KANBAN_CADENCES_MAX = TOOL_LIST_MAX.kanbanCadences;
export const CADENCE_ID_MAX = 64;
export const CADENCE_MINUTES = { min: 5, max: 240 } as const;
export const SLE_DAYS = { min: 1, max: 365 } as const;
/** The windows a version compare reads, in weeks either side of the save. */
export const COMPARE_WEEKS = [2, 4, 8] as const;
export type CompareWeeks = (typeof COMPARE_WEEKS)[number];

const KANBAN_CLASSES: readonly KanbanClassOfService[] = [
  "standard",
  "expedite",
  "fixed_date",
  "intangible",
];
const KANBAN_COLUMNS: readonly KanbanColumnId[] = [
  "backlog",
  "ready",
  "in_progress",
  "review",
  "done",
];

const round1 = (n: number) => Math.round(n * 10) / 10;

/* ── Reading a row defensively ───────────────────────────────────────── */

/** Trimmed text cut to `max` without splitting a character; undefined when blank or not text. */
export function cleanWorkflowText(raw: unknown, max: number = WORKFLOW_TEXT_MAX) {
  if (typeof raw !== "string") return undefined;
  const out = cutText(raw.trim(), max).trim();
  return out === "" ? undefined : out;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

function cleanWorkTypes(raw: unknown): WorkflowWorkType[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const byType = new Map<WorkType, WorkflowWorkType>();
  for (const entry of raw) {
    if (!isObject(entry)) continue;
    const type = entry.type as WorkType;
    if (!(WORK_TYPES as readonly unknown[]).includes(type) || byType.has(type)) continue;
    const out: WorkflowWorkType = { type };
    const meaning = cleanWorkflowText(entry.meaning);
    if (meaning) out.meaning = meaning;
    if (isInt(entry.targetPct, 0, 100)) out.targetPct = entry.targetPct;
    if (out.meaning !== undefined || out.targetPct !== undefined) byType.set(type, out);
  }
  const list = WORK_TYPES.flatMap((t) => (byType.has(t) ? [byType.get(t)!] : []));
  return list.length ? list : undefined;
}

function cleanPolicies(raw: unknown): WorkflowStagePolicy[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const out: WorkflowStagePolicy[] = [];
  for (const entry of raw) {
    if (!isObject(entry)) continue;
    const stage = cleanWorkflowText(entry.stage, STAGE_ID_MAX);
    // Done means the Definition of Done: it has no free-text policy.
    if (!stage || stage === "done" || seen.has(stage)) continue;
    const enter = cleanWorkflowText(entry.enter);
    const exit = cleanWorkflowText(entry.exit);
    if (!enter && !exit) continue;
    seen.add(stage);
    out.push({ stage, ...(enter ? { enter } : {}), ...(exit ? { exit } : {}) });
    if (out.length === STAGE_POLICIES_MAX) break;
  }
  return out.length ? out : undefined;
}

function cleanClassPolicies(raw: unknown): WorkflowClassPolicy[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const byClass = new Map<KanbanClassOfService, WorkflowClassPolicy>();
  for (const entry of raw) {
    if (!isObject(entry)) continue;
    const cls = entry.class as KanbanClassOfService;
    if (!KANBAN_CLASSES.includes(cls) || byClass.has(cls)) continue;
    const policy = cleanWorkflowText(entry.policy);
    if (policy) byClass.set(cls, { class: cls, policy });
  }
  const list = KANBAN_CLASSES.flatMap((c) => (byClass.has(c) ? [byClass.get(c)!] : []));
  return list.length ? list : undefined;
}

function cleanSle(raw: unknown): WorkflowDefinition["sle"] {
  if (!isObject(raw)) return undefined;
  const pct = raw.pct as WorkflowSlePercentile;
  if (!isInt(raw.days, SLE_DAYS.min, SLE_DAYS.max)) return undefined;
  if (!(WORKFLOW_SLE_PERCENTILES as readonly unknown[]).includes(pct)) return undefined;
  return { days: raw.days, pct };
}

export const STATIK_KEYS = [
  "inside",
  "outside",
  "demand",
  "capability",
  "workflow",
  "classes",
  "design",
  "rollout",
] as const satisfies readonly (keyof StatikNotes)[];

function cleanStatik(raw: unknown): StatikNotes | undefined {
  if (!isObject(raw)) return undefined;
  const out: StatikNotes = {};
  for (const key of STATIK_KEYS) {
    const note = cleanWorkflowText(raw[key], STATIK_NOTE_MAX);
    if (note) out[key] = note;
  }
  return Object.keys(out).length ? out : undefined;
}

/** One cadence as far as it can be read, or null without an id, a name or a known cadence. */
export function cleanCadence(raw: unknown): KanbanCadence | null {
  if (!isObject(raw)) return null;
  const id = cleanWorkflowText(raw.id, CADENCE_ID_MAX);
  const name = cleanWorkflowText(raw.name);
  const cadence = raw.cadence as MeetingCadence;
  if (!id || !name || !(MEETING_CADENCES as readonly unknown[]).includes(cadence)) return null;
  const out: KanbanCadence = { id, name, cadence };
  if (isInt(raw.minutes, CADENCE_MINUTES.min, CADENCE_MINUTES.max)) out.minutes = raw.minutes;
  const purpose = cleanWorkflowText(raw.purpose);
  if (purpose) out.purpose = purpose;
  return out;
}

function cleanCadences(raw: unknown): KanbanCadence[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const out: KanbanCadence[] = [];
  for (const entry of raw) {
    const cadence = cleanCadence(entry);
    if (!cadence || seen.has(cadence.id)) continue;
    seen.add(cadence.id);
    out.push(cadence);
  }
  const list = out.slice(0, KANBAN_CADENCES_MAX);
  return list.length ? list : undefined;
}

function cleanWipLimits(raw: unknown): Record<KanbanColumnId, number> {
  const src = isObject(raw) ? raw : {};
  return Object.fromEntries(
    KANBAN_COLUMNS.map((c) => {
      const n = src[c];
      return [c, typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.round(n) : 0];
    })
  ) as Record<KanbanColumnId, number>;
}

/** The fields a version keeps a copy of, read from any row. */
function snapshotFields(raw: Record<string, unknown>): Omit<WorkflowSnapshot, "wipLimits"> {
  const out: Omit<WorkflowSnapshot, "wipLimits"> = {};
  if (isWorkflowBoard(raw.board)) out.board = raw.board;
  for (const key of [
    "workItem",
    "startPoint",
    "finishPoint",
    "wipPolicy",
    "pullPolicy",
    "blockerPolicy",
  ] as const) {
    const text = cleanWorkflowText(raw[key]);
    if (text) out[key] = text;
  }
  const workTypes = cleanWorkTypes(raw.workTypes);
  if (workTypes) out.workTypes = workTypes;
  const policies = cleanPolicies(raw.policies);
  if (policies) out.policies = policies;
  const classPolicies = cleanClassPolicies(raw.classPolicies);
  if (classPolicies) out.classPolicies = classPolicies;
  const sle = cleanSle(raw.sle);
  if (sle) out.sle = sle;
  return out;
}

function cleanVersions(raw: unknown): WorkflowVersion[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: WorkflowVersion[] = [];
  for (const entry of raw) {
    if (!isObject(entry) || !isInt(entry.version, 1, Number.MAX_SAFE_INTEGER)) continue;
    if (typeof entry.savedAt !== "string" || !Number.isFinite(Date.parse(entry.savedAt))) continue;
    const snap = isObject(entry.snapshot) ? entry.snapshot : {};
    const version: WorkflowVersion = {
      version: entry.version,
      savedAt: entry.savedAt,
      snapshot: { ...snapshotFields(snap), wipLimits: cleanWipLimits(snap.wipLimits) },
    };
    const note = cleanWorkflowText(entry.note);
    if (note) version.note = note;
    const expect = cleanWorkflowText(entry.expect);
    if (expect) version.expect = expect;
    out.push(version);
  }
  const list = out.slice(-WORKFLOW_VERSIONS_MAX);
  return list.length ? list : undefined;
}

/**
 * The definition as far as it can be read, every cap the CRUD has applied:
 * text trimmed and cut, unknown values and repeats dropped (the first
 * wins), Done's policy dropped (Done means the Definition of Done), at most
 * 6 stage policies, 10 cadences and the latest 12 versions. Unknown keys
 * go. Its id is always WORKFLOW_DEFINITION_ID.
 */
export function normalizeWorkflowDefinition(raw: unknown): WorkflowDefinition {
  const src = isObject(raw) ? raw : {};
  const out: WorkflowDefinition = { id: WORKFLOW_DEFINITION_ID, ...snapshotFields(src) };
  const statik = cleanStatik(src.statik);
  if (statik) out.statik = statik;
  const cadences = cleanCadences(src.cadences);
  if (cadences) out.cadences = cadences;
  const versions = cleanVersions(src.versions);
  if (versions) out.versions = versions;
  if (typeof src.createdAt === "string") out.createdAt = src.createdAt;
  if (typeof src.updatedAt === "string") out.updatedAt = src.updatedAt;
  return out;
}

/** The fields a change can set; null clears one. */
export type WorkflowPatch = {
  [K in Exclude<keyof WorkflowDefinition, "id" | "createdAt" | "updatedAt">]?:
    | WorkflowDefinition[K]
    | null;
};

/** The definition's content without its stamps, to tell whether a change changed anything. */
function contentOf(def: WorkflowDefinition): string {
  const rest: Partial<WorkflowDefinition> = { ...def };
  delete rest.createdAt;
  delete rest.updatedAt;
  return JSON.stringify(rest);
}

/**
 * The definition's content in one form: normalised (so its keys are in one
 * order, whichever wrote it: Postgres jsonb reads keys back shortest first,
 * zod writes them in schema order), without its stamps, and with the stage
 * policies by stage id (their order means nothing: each names its stage).
 */
export function workflowContent(def: WorkflowDefinition | null | undefined): WorkflowDefinition {
  const out = normalizeWorkflowDefinition(def);
  delete out.createdAt;
  delete out.updatedAt;
  if (out.policies) {
    out.policies = [...out.policies].sort((a, b) =>
      a.stage < b.stage ? -1 : a.stage > b.stage ? 1 : 0
    );
  }
  return out;
}

/** Whether two definitions say the same thing, whatever their key order and stamps. */
export function sameWorkflowContent(
  a: WorkflowDefinition | null | undefined,
  b: WorkflowDefinition | null | undefined
): boolean {
  return JSON.stringify(workflowContent(a)) === JSON.stringify(workflowContent(b));
}

/**
 * `def` with `patch` applied and normalised: a field set to null is
 * cleared, a field left out stays. With no definition yet it starts one,
 * stamped `createdAt`; a change stamps `updatedAt`. The same definition
 * (by reference) when the patch changes nothing.
 */
export function mergeWorkflow(
  def: WorkflowDefinition | null | undefined,
  patch: WorkflowPatch,
  at: string = new Date().toISOString()
): WorkflowDefinition {
  const base = def ? normalizeWorkflowDefinition(def) : null;
  const next: Record<string, unknown> = { ...(base ?? { id: WORKFLOW_DEFINITION_ID }) };
  for (const [key, value] of Object.entries(patch)) {
    if (key === "id" || key === "createdAt" || key === "updatedAt") continue;
    if (value === null || value === undefined) {
      if (value === null) delete next[key];
      continue;
    }
    next[key] = value;
  }
  const merged = normalizeWorkflowDefinition(next);
  if (def && base && contentOf(merged) === contentOf(base)) return def;
  merged.createdAt = base?.createdAt ?? at;
  merged.updatedAt = at;
  return merged;
}

/* ── Versions ────────────────────────────────────────────────────────── */

/** A copy of the workflow as it is, with the board's WIP limits now. */
export function workflowSnapshot(
  def: WorkflowDefinition,
  wipLimits: Partial<Record<KanbanColumnId, number>>
): WorkflowSnapshot {
  return {
    ...snapshotFields(normalizeWorkflowDefinition(def) as unknown as Record<string, unknown>),
    wipLimits: cleanWipLimits(wipLimits),
  };
}

/** The newest saved version, or null. */
export function latestVersion(def: WorkflowDefinition | null | undefined): WorkflowVersion | null {
  const versions = def?.versions ?? [];
  return versions.length ? versions[versions.length - 1] : null;
}

/**
 * The definition with a new version saved now: the next number, a note and
 * what the team expects to change, and a snapshot with the board's WIP
 * limits. The latest WORKFLOW_VERSIONS_MAX are kept.
 */
export function withSavedVersion(
  def: WorkflowDefinition,
  { note, expect }: { note?: string; expect?: string },
  wipLimits: Partial<Record<KanbanColumnId, number>>,
  at: string = new Date().toISOString()
): { def: WorkflowDefinition; version: WorkflowVersion } {
  const base = normalizeWorkflowDefinition(def);
  const versions = base.versions ?? [];
  const number = versions.reduce((max, v) => Math.max(max, v.version), 0) + 1;
  const version: WorkflowVersion = {
    version: number,
    savedAt: at,
    snapshot: workflowSnapshot(base, wipLimits),
  };
  const cleanNote = cleanWorkflowText(note);
  if (cleanNote) version.note = cleanNote;
  const cleanExpect = cleanWorkflowText(expect);
  if (cleanExpect) version.expect = cleanExpect;
  return {
    def: {
      ...base,
      versions: [...versions, version].slice(-WORKFLOW_VERSIONS_MAX),
      createdAt: base.createdAt ?? at,
      updatedAt: at,
    },
    version,
  };
}

const stageLabel = (board: WorkflowBoard, id: string) =>
  boardWorkflow(board).stages.find((s) => s.id === id)?.label ?? id;

/**
 * What a version changed from the one before it, in short lines: "Review
 * WIP 2 (was 3)", "SLE 85% within 8 days (was none)", "Review policy".
 * The first version lists nothing: there is nothing to compare it with.
 */
export function versionChanges(
  prev: WorkflowSnapshot | null | undefined,
  next: WorkflowSnapshot
): string[] {
  if (!prev) return [];
  const board = next.board ?? prev.board ?? "flow";
  const out: string[] = [];
  for (const { key, label } of wipColumns(board)) {
    const a = prev.wipLimits[key] ?? 0;
    const b = next.wipLimits[key] ?? 0;
    if (a !== b) out.push(`${label} WIP ${b || "no limit"} (was ${a || "no limit"})`);
  }
  const sleOf = (s: WorkflowSnapshot) =>
    s.sle ? `${s.sle.pct}% within ${s.sle.days} ${s.sle.days === 1 ? "day" : "days"}` : "none";
  if (sleOf(prev) !== sleOf(next)) out.push(`SLE ${sleOf(next)} (was ${sleOf(prev)})`);
  const stages = new Set([
    ...(prev.policies ?? []).map((p) => p.stage),
    ...(next.policies ?? []).map((p) => p.stage),
  ]);
  for (const stage of Array.from(stages)) {
    const a = (prev.policies ?? []).find((p) => p.stage === stage);
    const b = (next.policies ?? []).find((p) => p.stage === stage);
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${stageLabel(board, stage)} policy`);
  }
  const named: [keyof WorkflowSnapshot, string][] = [
    ["workItem", "Work item"],
    ["startPoint", "Start point"],
    ["finishPoint", "Finish point"],
    ["wipPolicy", "WIP policy"],
    ["pullPolicy", "Pull policy"],
    ["blockerPolicy", "Blocker policy"],
    ["classPolicies", "Class policies"],
    ["workTypes", "Work types"],
  ];
  for (const [key, label] of named) {
    if (JSON.stringify(prev[key]) !== JSON.stringify(next[key])) out.push(label);
  }
  return out;
}

/* ── The described board's items ─────────────────────────────────────── */

/**
 * The items on the board the definition describes, as lib/flow reads them:
 * the stories for the Sprint board, the Flow board's cards for the Flow
 * board. Examples only when asked (an example open on the page).
 */
export function workflowItems(
  board: WorkflowBoard,
  {
    stories,
    boards,
  }: { stories?: readonly Story[] | null; boards?: readonly KanbanBoard[] | null },
  { includeExamples = false }: { includeExamples?: boolean } = {}
): FlowItem[] {
  if (board === "sprint") return storyItems(stories ?? [], { includeExamples });
  const flow = (boards ?? []).find((b) => b.id === KANBAN_BOARD_ID);
  const cards = Array.isArray(flow?.cards) ? flow.cards : [];
  return cardItems(cards, { includeExamples });
}

/** An SLE suggested from history: `pct` percent of finished items took `days` or less. */
export interface SleSuggestion {
  days: number;
  pct: WorkflowSlePercentile;
  /** Finished items it rests on. */
  sample: number;
}

/**
 * The `pct` percentile of the finished items' cycle days (whole local days,
 * both counted, as Cycle Time counts its SLE), from MIN_SAMPLE.distribution
 * finished items; null with fewer.
 */
export function sleFromHistory(
  items: readonly FlowItem[],
  pct: WorkflowSlePercentile = 85
): SleSuggestion | null {
  const days = finishedItems(items).map((f) => f.days);
  if (days.length < MIN_SAMPLE.distribution) return null;
  const at = percentile(days, pct);
  if (at === null) return null;
  return {
    days: Math.min(SLE_DAYS.max, Math.max(SLE_DAYS.min, Math.round(at))),
    pct,
    sample: days.length,
  };
}

/** What the board delivers today, for STATIK's third step. */
export interface DeliveryToday {
  /** Items finished, all time. */
  finished: number;
  /**
   * Items finished per week over the last `weeks` whole ISO weeks before
   * this one (quiet weeks count as 0); null under 2 such weeks since the
   * first finish.
   */
  perWeek: number | null;
  weeks: number;
  /** 85% of finished items took this many days or less; null under MIN_SAMPLE.distribution. */
  p85: number | null;
  /** Finished items with a start (what P85 rests on). */
  timed: number;
}

/** The last 8 weeks at most, for the throughput figure. */
const DELIVERY_WEEKS = 8;

/**
 * What the board delivers as of `today` (local "YYYY-MM-DD"). The weekly
 * rate reads the whole ISO weeks up to the one before today's, so a team
 * that has finished nothing lately reads 0 rather than the rate it had
 * when it last finished, and this week's few days don't count as a week.
 */
export function deliveryToday(
  items: readonly FlowItem[],
  today: string = todayIso()
): DeliveryToday {
  const done = items.filter((i) => i.doneOn !== null);
  const byWeek = new Map<string, number>();
  let first: string | null = null;
  for (const item of done) {
    const week = weekOf(item.doneOn);
    if (!week) continue;
    byWeek.set(week, (byWeek.get(week) ?? 0) + 1);
    if (first === null || week < first) first = week;
  }
  // Week labels ("2026-W42") sort as text in time order.
  const weeks: string[] = [];
  for (let back = DELIVERY_WEEKS; back >= 1; back--) {
    const week = weekOf(addDays(today, -7 * back));
    if (week && first !== null && week >= first) weeks.push(week);
  }
  const timed = finishedItems(items);
  const p85 =
    timed.length >= MIN_SAMPLE.distribution ? cycleSummary(timed.map((f) => f.days)).p85 : null;
  return {
    finished: done.length,
    perWeek:
      weeks.length >= 2
        ? round1(weeks.reduce((sum, w) => sum + (byWeek.get(w) ?? 0), 0) / weeks.length)
        : null,
    weeks: weeks.length,
    p85,
    timed: timed.length,
  };
}

/* ── Before and after a version ──────────────────────────────────────── */

/** One side of a compare: a window of local days and what flowed in it. */
export interface CompareSide {
  /** Local "YYYY-MM-DD", both included. */
  from: string;
  to: string;
  /** Days in the window (0 when it hasn't started). */
  days: number;
  /** Items finished in it with a start (cycle time). */
  finished: number;
  /** Whether `finished` reaches MIN_SAMPLE.distribution. */
  enough: boolean;
  median: number | null;
  p85: number | null;
  /** Items done in it per week, all of them (with a start or not). */
  throughputPerWeek: number | null;
  /** Average items in progress (In progress, Review) at the end of each day. */
  avgWip: number | null;
}

export interface VersionCompare {
  version: number;
  weeks: CompareWeeks;
  before: CompareSide;
  after: CompareSide;
  /** The after window ends after today, so it is shorter than the before one. */
  cutShort: boolean;
}

function side(
  items: readonly FlowItem[],
  workflow: FlowWorkflow,
  from: string,
  to: string
): CompareSide {
  const a = dayNumber(from);
  const b = dayNumber(to);
  const days = a !== null && b !== null && b >= a ? b - a + 1 : 0;
  if (days === 0) {
    return {
      from,
      to,
      days: 0,
      finished: 0,
      enough: false,
      median: null,
      p85: null,
      throughputPerWeek: null,
      avgWip: null,
    };
  }
  const finished = finishedItems(items, { from, to });
  const summary = cycleSummary(finished.map((f) => f.days));
  const enough = finished.length >= MIN_SAMPLE.distribution;
  const done = items.filter((i) => {
    const d = dayNumber(i.doneOn);
    return d !== null && d >= (a as number) && d <= (b as number);
  }).length;
  const counts = dailyCounts(items, workflow, { from, to }).days.map((d) => wipOf(d, workflow));
  const avgWip = counts.length ? counts.reduce((x, y) => x + y, 0) / counts.length : null;
  return {
    from,
    to,
    days,
    finished: finished.length,
    enough,
    median: enough ? summary.median : null,
    p85: enough ? summary.p85 : null,
    throughputPerWeek: round1((done * 7) / days),
    avgWip: avgWip === null ? null : round1(avgWip),
  };
}

/** The saved version numbered `version` (default: the latest), or null. */
export function versionOf(
  def: WorkflowDefinition | null | undefined,
  version?: number
): WorkflowVersion | null {
  const versions = def?.versions ?? [];
  const v =
    version === undefined
      ? versions[versions.length - 1]
      : versions.find((x) => x.version === version);
  return v ?? null;
}

/**
 * The board a version's compare reads: the one the definition described
 * when the version was saved, else the one it describes now. Null when
 * neither names one (the page then reads the board in view). The caller
 * takes its items from this board and passes it to `compareVersion`, so
 * both read the same one.
 */
export function compareBoard(
  def: WorkflowDefinition | null | undefined,
  version?: number
): WorkflowBoard | null {
  return versionOf(def, version)?.snapshot.board ?? describedBoard(def);
}

/**
 * A board's flow in the `weeks` before a version was saved against the
 * `weeks` from its save day: median and P85 cycle time over the items
 * finished in each window (shown from MIN_SAMPLE.distribution items a
 * side), throughput per week and average WIP. `items` are the items of
 * `board` (default: `compareBoard`, else the Flow board): WIP counts only
 * items of the board it reads. The after window stops at today
 * (`cutShort`). Null when the version isn't on the definition.
 */
export function compareVersion(
  def: WorkflowDefinition | null | undefined,
  items: readonly FlowItem[],
  {
    version,
    weeks = 4,
    today = todayIso(),
    board,
  }: { version?: number; weeks?: CompareWeeks; today?: string; board?: WorkflowBoard } = {}
): VersionCompare | null {
  const v = versionOf(def, version);
  if (!v) return null;
  const saved = todayIso(new Date(v.savedAt));
  const workflow = boardWorkflow(board ?? compareBoard(def, v.version) ?? "flow");
  const span = weeks * 7;
  const beforeFrom = addDays(saved, -span) as string;
  const beforeTo = addDays(saved, -1) as string;
  const afterEnd = addDays(saved, span - 1) as string;
  const cutShort = (dayNumber(afterEnd) as number) > (dayNumber(today) ?? 0);
  const afterTo = cutShort ? today : afterEnd;
  return {
    version: v.version,
    weeks,
    before: side(items, workflow, beforeFrom, beforeTo),
    after: side(items, workflow, saved, afterTo),
    cutShort,
  };
}
