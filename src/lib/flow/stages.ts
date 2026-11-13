/**
 * Cycle time by stage: how long finished work spent in each status between
 * the start of work and Done, read from the moves the boards record
 * (Story.statusHistory, KanbanCard.history, as ./items places them), and
 * the flow efficiency: the share of that time the work was in an active
 * status, with the statuses the person marks as waiting (DEFAULT_WAITING
 * until they do) counted as the rest.
 *
 * The window is the item's cycle (./cycle): from the move that started its
 * last attempt (the first move into an active stage since it last waited in
 * a queue, or since a story was sent back to the Backlog, as its start
 * stamp reads it) to its last move into Done, so Backlog, To do and Ready
 * never fall inside it. Time is
 * the elapsed time between the moves' timestamps, in days with a fraction
 * (a plain "YYYY-MM-DD" from a date-only write counts from local midnight),
 * so an item's stages add up to the time it took, and a same-day item's to
 * less than a day; the cycle time itself keeps its whole-day count.
 *
 * Only items whose moves were recorded (`basis: "history"`) are read: an
 * item placed from its stamps alone would have its stages guessed, so it is
 * counted apart (`approximate`) instead. A stint in Done before the item
 * was reopened stays in its window, under "done".
 *
 * Pure, so the Cycle Time page, its export and tool.cycle_time.by_stage
 * read the same numbers.
 */

import { enoughData } from "@/lib/analytics/min-sample";
import { percentile } from "@/lib/sprints/metrics";
import { cycleDays } from "./cycle";
import { dayNumber } from "./days";
import { stageOf, workflowOf } from "./workflows";
import type { FlowItem } from "./types";

const DAY_MS = 86_400_000;

/** Every stage either board has, in the order a page lists them. */
export const STAGE_ORDER = ["backlog", "todo", "ready", "in_progress", "review", "done"] as const;
export type StageId = (typeof STAGE_ORDER)[number];

export const STAGE_LABEL: Record<StageId, string> = {
  backlog: "Backlog",
  todo: "To do",
  ready: "Ready",
  in_progress: "In progress",
  review: "Review",
  done: "Done, before a reopen",
};

export const isStageId = (v: unknown): v is StageId =>
  typeof v === "string" && (STAGE_ORDER as readonly string[]).includes(v);

/** Stage ids read back from storage or an agent: known ones only, each once, in STAGE_ORDER. */
export function cleanStageIds(raw: unknown): StageId[] {
  if (!Array.isArray(raw)) return [];
  const set = new Set<string>(raw.filter(isStageId));
  return STAGE_ORDER.filter((s) => set.has(s));
}

/**
 * The statuses counted as waiting until the person says otherwise, chosen
 * from the ones a cycle can hold (In progress, Review, a stint in Done), so
 * the flow efficiency reads out of the box:
 *  - Review: the work is built and mostly waits for a reviewer, the usual
 *    queue inside the work (unmark it where reviews start at once);
 *  - a stint in Done before a reopen.
 * In progress counts as active. Backlog, To do and Ready never fall inside
 * a cycle (a move into one restarts it), so they aren't listed: time there
 * before the work starts is lead time, not cycle time.
 */
export const DEFAULT_WAITING: readonly StageId[] = cleanStageIds(["review", "done"]);

/** A move's moment in ms; a plain "YYYY-MM-DD" is local midnight. Null when it isn't a time. */
export function momentOf(at: string): number | null {
  if (typeof at !== "string") return null;
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(at);
  if (plain) {
    const t = new Date(Number(plain[1]), Number(plain[2]) - 1, Number(plain[3])).getTime();
    return Number.isFinite(t) ? t : null;
  }
  const t = Date.parse(at);
  return Number.isFinite(t) ? t : null;
}

export interface StageTime {
  stage: StageId;
  /** Elapsed days in it during the cycle (with a fraction). */
  days: number;
}

/** A finished item's time in each stage. */
export interface ItemStageTimes {
  id: string;
  title: string;
  kind: "story" | "card";
  /** Local "YYYY-MM-DD". */
  startedOn: string;
  /** Local "YYYY-MM-DD". */
  doneOn: string;
  /** Its cycle time as every flow tool counts it: whole days, a same-day item is 1. */
  cycleDays: number;
  /** Elapsed days from the start of work to Done: the sum of `stages`. */
  elapsedDays: number;
  /** The stages it was in during the cycle, in STAGE_ORDER (one entered and left at once has 0). */
  stages: StageTime[];
}

/**
 * The item's time in each stage over its cycle, or null when there is none
 * to read: not finished, no start, or its moves were rebuilt from stamps.
 */
export function itemStageTimes(item: FlowItem): ItemStageTimes | null {
  if (item.stage !== "done" || !item.doneOn || !item.startedOn) return null;
  if (item.basis !== "history") return null;
  const cycle = cycleDays(item.startedOn, item.doneOn);
  if (cycle === null) return null;
  const wf = workflowOf(item);
  const timed = item.moves
    .map((m, i) => ({ to: m.to, t: momentOf(m.at), i }))
    .filter((m): m is { to: string; t: number; i: number } => m.t !== null)
    // Stable: moves at the same moment keep their recorded order.
    .sort((a, b) => a.t - b.t || a.i - b.i);
  let doneAt = -1;
  for (let i = timed.length - 1; i >= 0; i--) {
    if (timed[i].to === "done") {
      doneAt = i;
      break;
    }
  }
  if (doneAt < 0) return null;
  let start = -1;
  for (let i = 0; i < doneAt; i++) {
    const kind = stageOf(wf, timed[i].to)?.kind;
    // Back to a queue, or a story sent back to the Backlog (a status its
    // board has no column for), starts afresh, as the start stamp does
    // (lib/sprints/story-status clears startedAt): the window stays the
    // cycle the item's startedOn and cycleDays count.
    if (kind === "queue" || kind === undefined) start = -1;
    else if (start < 0 && kind === "active") start = i;
  }
  if (start < 0) return null;
  const totals = new Map<StageId, number>();
  for (let i = start; i < doneAt; i++) {
    const stage = timed[i].to;
    if (!isStageId(stage)) continue;
    const ms = Math.max(0, timed[i + 1].t - timed[i].t);
    totals.set(stage, (totals.get(stage) ?? 0) + ms / DAY_MS);
  }
  const stages = STAGE_ORDER.filter((s) => totals.has(s)).map((s) => ({
    stage: s,
    days: totals.get(s) as number,
  }));
  return {
    id: item.id,
    title: item.title,
    kind: item.kind,
    startedOn: item.startedOn,
    doneOn: item.doneOn,
    cycleDays: cycle,
    elapsedDays: stages.reduce((a, s) => a + s.days, 0),
    stages,
  };
}

/** One stage across the finished items. */
export interface StageStat {
  stage: StageId;
  label: string;
  /** Finished items that were in it during their cycle. */
  items: number;
  /** Days in it over those items (nearest rank); null below MIN_SAMPLE.distribution items. */
  median: number | null;
  p85: number | null;
  /** All the days in it, summed over the items. */
  totalDays: number;
  /** Its share of all the time counted, 0–100; null when no time was counted. */
  share: number | null;
  /** Marked as a waiting status. */
  waiting: boolean;
}

export type EfficiencyReason =
  /** Quoted. */
  | "ok"
  /** Fewer than MIN_SAMPLE.average items to read. */
  | "not_enough"
  /** All the time counted is in active statuses, or all in waiting ones: they can't be told apart. */
  | "one_kind";

export interface FlowEfficiency {
  /** Active time over all the time counted, 0–100, rounded; null unless `reason` is "ok". */
  pct: number | null;
  activeDays: number;
  waitingDays: number;
  reason: EfficiencyReason;
}

export interface StageBreakdown {
  /** The finished items with their stages, oldest finish first. */
  items: ItemStageTimes[];
  /** Finished items (with a cycle time) whose moves weren't recorded, so their stages aren't known. */
  approximate: number;
  /** The stages that hold time, in STAGE_ORDER. */
  stages: StageStat[];
  totalDays: number;
  efficiency: FlowEfficiency;
  /** The waiting statuses it was read with. */
  waiting: StageId[];
}

export interface StageBreakdownOptions {
  /** The statuses that count as waiting (default DEFAULT_WAITING). */
  waiting?: Iterable<string>;
  /** Only items done from this local day (included). */
  from?: string;
  /** Only items done up to this local day (included). */
  to?: string;
}

/** An item's flow efficiency (0–100) with these waiting statuses; null with no time counted. */
export function itemEfficiency(
  item: Pick<ItemStageTimes, "stages">,
  waiting: ReadonlySet<string>
): number | null {
  let active = 0;
  let total = 0;
  for (const s of item.stages) {
    total += s.days;
    if (!waiting.has(s.stage)) active += s.days;
  }
  return total > 0 ? (active / total) * 100 : null;
}

/** The finished items' time per stage, each stage's median and P85, and the flow efficiency. */
export function stageBreakdown(
  flowItems: readonly FlowItem[],
  opts: StageBreakdownOptions = {}
): StageBreakdown {
  const waiting = cleanStageIds(Array.from(opts.waiting ?? DEFAULT_WAITING));
  const waitingSet = new Set<string>(waiting);
  const from = opts.from ? dayNumber(opts.from) : null;
  const to = opts.to ? dayNumber(opts.to) : null;
  const items: ItemStageTimes[] = [];
  let approximate = 0;
  for (const item of flowItems) {
    if (item.stage !== "done" || cycleDays(item.startedOn, item.doneOn) === null) continue;
    const n = dayNumber(item.doneOn) as number;
    if ((from !== null && n < from) || (to !== null && n > to)) continue;
    const timed = itemStageTimes(item);
    if (timed) items.push(timed);
    else approximate++;
  }
  // Stable: items done the same day keep the order given.
  items.sort((a, b) => (a.doneOn < b.doneOn ? -1 : a.doneOn > b.doneOn ? 1 : 0));

  const per = new Map<StageId, number[]>();
  for (const it of items) {
    for (const s of it.stages) per.set(s.stage, [...(per.get(s.stage) ?? []), s.days]);
  }
  const totalDays = items.reduce((a, it) => a + it.elapsedDays, 0);
  const stages: StageStat[] = STAGE_ORDER.filter((s) => per.has(s)).map((s) => {
    const days = per.get(s) as number[];
    const quoted = enoughData(days.length, "distribution");
    const sum = days.reduce((a, b) => a + b, 0);
    return {
      stage: s,
      label: STAGE_LABEL[s],
      items: days.length,
      median: quoted ? percentile(days, 50) : null,
      p85: quoted ? percentile(days, 85) : null,
      totalDays: sum,
      share: totalDays > 0 ? (sum / totalDays) * 100 : null,
      waiting: waitingSet.has(s),
    };
  });

  const waitingDays = stages.filter((s) => s.waiting).reduce((a, s) => a + s.totalDays, 0);
  const activeDays = Math.max(0, totalDays - waitingDays);
  const reason: EfficiencyReason = !enoughData(items.length, "average")
    ? "not_enough"
    : activeDays <= 0 || waitingDays <= 0
      ? "one_kind"
      : "ok";
  return {
    items,
    approximate,
    stages,
    totalDays,
    efficiency: {
      pct: reason === "ok" ? Math.round((activeDays / totalDays) * 100) : null,
      activeDays,
      waitingDays,
      reason,
    },
    waiting,
  };
}

/** A stage's time for people: "5 h" under a day ("under 1 h" below an hour), else "2.3 days". */
export function stageDuration(days: number | null): string {
  if (days === null || !Number.isFinite(days)) return "—";
  if (days < 1) {
    const hours = Math.round(days * 24);
    return hours < 1 ? "under 1 h" : hours === 24 ? "1 day" : `${hours} h`;
  }
  const d = Math.round(days * 10) / 10;
  return `${d} ${d === 1 ? "day" : "days"}`;
}

/**
 * One sentence on where the time goes: the stage with the largest share,
 * and its median once that can be quoted. Null with nothing to read.
 */
export function stageSentence(b: Pick<StageBreakdown, "stages" | "items">): string | null {
  if (b.items.length === 0) return null;
  let top: StageStat | null = null;
  for (const s of b.stages) {
    if (s.share !== null && (top === null || (top.share as number) < s.share)) top = s;
  }
  if (!top || top.share === null) return null;
  const median = top.median !== null ? `, a median of ${stageDuration(top.median)} an item` : "";
  const what = top.stage === "done" ? "time in Done before a reopen" : top.label;
  return `Most of the time from start to done is in ${what}: ${Math.round(top.share)}% of it${median}.`;
}
