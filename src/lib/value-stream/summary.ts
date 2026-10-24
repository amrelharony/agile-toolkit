/**
 * The value stream map's numbers, for the Value Stream page and its agent
 * actions (tool.value_stream.*), so both read one definition of the totals,
 * the bottleneck and the current-versus-future comparison.
 *
 * A map is the stages of one state ("current" or "future"), in `order`.
 * Stages saved before reordering have no `order`: they keep their stored
 * position, after the numbered ones. Stored order alone isn't enough: a
 * fresh device pulls the rows sorted by id, so a map without `order` comes
 * back shuffled there. Every reorder, add and future-state copy writes
 * `order` for the whole map, which pins it everywhere.
 *
 * Stored values aren't always what the types say (a hand edit, an agent
 * write from before the bounds), so every number is read clamped: times
 * at 0 or more, %C/A from 0 to 100, flow efficiency capped at 100.
 */

import type { ValueStreamStage, ValueStreamState } from "@/lib/stores/workspace-types";
import { fmt } from "@/lib/charts/chart-text";

export type { ValueStreamState };

export const VALUE_STREAM_STATES: readonly ValueStreamState[] = ["current", "future"];

export const STATE_LABEL: Record<ValueStreamState, string> = {
  current: "Current state",
  future: "Future state",
};

/** Which map a stage is on; absent (or anything unknown) reads as the current one. */
export function stageState(stage: Pick<ValueStreamStage, "state">): ValueStreamState {
  return stage.state === "future" ? "future" : "current";
}

const nonNegative = (n: unknown): number =>
  typeof n === "number" && Number.isFinite(n) ? Math.max(0, n) : 0;

/** Days of work on the item in the stage. */
export const processOf = (s: Pick<ValueStreamStage, "processTime">): number =>
  nonNegative(s.processTime);

/** Days from arriving in the stage to leaving it, waiting included. */
export const leadOf = (s: Pick<ValueStreamStage, "leadTime">): number => nonNegative(s.leadTime);

/** Days the item waits in the stage: lead minus process, never below 0. */
export const waitOf = (s: Pick<ValueStreamStage, "processTime" | "leadTime">): number =>
  Math.max(0, leadOf(s) - processOf(s));

/** The stage's percent complete and accurate, 0–100. */
export const accuracyOf = (s: Pick<ValueStreamStage, "completeAccurate">): number =>
  Math.min(100, nonNegative(s.completeAccurate));

const hasOrder = (s: ValueStreamStage): boolean =>
  typeof s.order === "number" && Number.isFinite(s.order) && s.order >= 0;

/** The stored stages that are objects (a list that isn't one reads as empty). */
function rows(stages: readonly ValueStreamStage[] | null | undefined): ValueStreamStage[] {
  const raw: unknown = stages;
  return Array.isArray(raw)
    ? raw.filter((s): s is ValueStreamStage => typeof s === "object" && s !== null)
    : [];
}

/**
 * The stages of one map in order: by `order`, then the unnumbered ones in
 * their stored order. Ties keep the stored order (two devices that each
 * moved a stage can leave two at one position until the next move).
 */
export function orderedStages(
  stages: readonly ValueStreamStage[] | null | undefined,
  state: ValueStreamState = "current"
): ValueStreamStage[] {
  const inMap = rows(stages)
    .map((stage, index) => ({ stage, index }))
    .filter(({ stage }) => stageState(stage) === state);
  const numbered = inMap
    .filter(({ stage }) => hasOrder(stage))
    .sort((a, b) => (a.stage.order as number) - (b.stage.order as number) || a.index - b.index);
  const rest = inMap.filter(({ stage }) => !hasOrder(stage));
  return [...numbered, ...rest].map(({ stage }) => stage);
}

export interface VsmSummary {
  stageCount: number;
  /** Days of work, summed over the stages. */
  totalProcess: number;
  /** Days from the first stage's start to the last one's end, summed over the stages. */
  totalLead: number;
  /** Days spent waiting: lead minus process, per stage. */
  totalWait: number;
  /** Process as a percentage of lead, capped at 100; null without any lead time. */
  flowEfficiency: number | null;
  /** The share of work that passes every stage without rework: the product of the %C/A; null without stages. */
  rolledCA: number | null;
}

/** The headline numbers of one map's stages. */
export function vsmSummary(stages: readonly ValueStreamStage[]): VsmSummary {
  const list = rows(stages);
  const totalProcess = list.reduce((sum, s) => sum + processOf(s), 0);
  const totalLead = list.reduce((sum, s) => sum + leadOf(s), 0);
  const totalWait = list.reduce((sum, s) => sum + waitOf(s), 0);
  return {
    stageCount: list.length,
    totalProcess,
    totalLead,
    totalWait,
    // Process above lead is impossible; capped so bad input can't read "183% efficient".
    flowEfficiency: totalLead > 0 ? Math.min(100, (totalProcess / totalLead) * 100) : null,
    rolledCA:
      list.length > 0 ? list.reduce((acc, s) => acc * (accuracyOf(s) / 100), 1) * 100 : null,
  };
}

export interface Bottleneck {
  stage: ValueStreamStage;
  /** Days work waits in it. */
  waitDays: number;
  /** That wait as a percentage of the map's whole lead time. */
  sharePct: number;
}

/**
 * The stage where work waits longest, in one map's ordered stages. A tie
 * goes to the longer lead time, then to the earlier stage. Null with fewer
 * than 2 stages (nothing to compare) or when nothing waits anywhere.
 */
export function bottleneck(stages: readonly ValueStreamStage[]): Bottleneck | null {
  const list = rows(stages);
  if (list.length < 2) return null;
  let best: ValueStreamStage | null = null;
  for (const s of list) {
    if (
      !best ||
      waitOf(s) > waitOf(best) ||
      (waitOf(s) === waitOf(best) && leadOf(s) > leadOf(best))
    ) {
      best = s;
    }
  }
  if (!best || waitOf(best) <= 0) return null;
  const totalLead = list.reduce((sum, s) => sum + leadOf(s), 0);
  return {
    stage: best,
    waitDays: waitOf(best),
    sharePct: totalLead > 0 ? (waitOf(best) / totalLead) * 100 : 0,
  };
}

export interface StateComparison {
  current: VsmSummary;
  future: VsmSummary;
  /** Future minus current; negative is shorter. */
  leadDelta: number;
  processDelta: number;
  waitDelta: number;
  /** Percentage points, future minus current; null when either has no lead time. */
  flowEfficiencyDelta: number | null;
  rolledCADelta: number | null;
}

/** The two maps side by side; null until the future map has a stage. */
export function compareStates(
  current: readonly ValueStreamStage[],
  future: readonly ValueStreamStage[]
): StateComparison | null {
  if (rows(future).length === 0) return null;
  const a = vsmSummary(current);
  const b = vsmSummary(future);
  const delta = (x: number | null, y: number | null) => (x === null || y === null ? null : y - x);
  return {
    current: a,
    future: b,
    leadDelta: b.totalLead - a.totalLead,
    processDelta: b.totalProcess - a.totalProcess,
    waitDelta: b.totalWait - a.totalWait,
    flowEfficiencyDelta: delta(a.flowEfficiency, b.flowEfficiency),
    rolledCADelta: delta(a.rolledCA, b.rolledCA),
  };
}

/** `stages` with the given map numbered 0..n-1 in `order` (its stages replaced, the rest untouched). */
function renumber(
  stages: readonly ValueStreamStage[],
  state: ValueStreamState,
  ordered: readonly ValueStreamStage[]
): ValueStreamStage[] {
  const position = new Map(ordered.map((s, i) => [s.id, i]));
  return rows(stages).map((s) => {
    const at = stageState(s) === state ? position.get(s.id) : undefined;
    return at === undefined || s.order === at ? s : { ...s, order: at };
  });
}

/**
 * Move a stage to `toIndex` in its map (clamped to the map), numbering the
 * whole map so every device shows the same order. Returns the stages with
 * the move made (the same array when nothing moved or the id is unknown):
 * pass the result to `changedStages` for the rows to write.
 */
export function moveStage(
  stages: readonly ValueStreamStage[],
  id: string,
  toIndex: number
): ValueStreamStage[] {
  const all = rows(stages);
  const stage = all.find((s) => s.id === id);
  if (!stage || !Number.isFinite(toIndex)) return stages as ValueStreamStage[];
  const state = stageState(stage);
  const ordered = orderedStages(all, state);
  const from = ordered.findIndex((s) => s.id === id);
  const to = Math.max(0, Math.min(ordered.length - 1, Math.trunc(toIndex)));
  const numberedAlready = ordered.every((s, i) => s.order === i);
  if (from === to && numberedAlready) return stages as ValueStreamStage[];
  const next = [...ordered];
  next.splice(from, 1);
  next.splice(to, 0, stage);
  return renumber(all, state, next);
}

/**
 * `stages` with `stage` added at the end of its map, the map numbered
 * (stages saved before reordering get their position written down, so the
 * new one can't jump ahead of them).
 */
export function appendStage(
  stages: readonly ValueStreamStage[],
  stage: ValueStreamStage
): ValueStreamStage[] {
  const state = stageState(stage);
  const ordered = orderedStages(stages, state).filter((s) => s.id !== stage.id);
  const added: ValueStreamStage = { ...stage, order: ordered.length };
  return [...renumber(stages, state, ordered).filter((s) => s.id !== stage.id), added];
}

/**
 * The future map's first draft: a copy of the current stages in order,
 * with new ids from `makeId`, as stages to add. Empty when the future map
 * already has stages, so a second click can't double it.
 */
export function copyToFuture(
  stages: readonly ValueStreamStage[],
  makeId: (index: number) => string
): ValueStreamStage[] {
  if (orderedStages(stages, "future").length > 0) return [];
  return orderedStages(stages, "current").map((s, i) => {
    const copy: ValueStreamStage = {
      id: makeId(i),
      name: s.name,
      processTime: processOf(s),
      leadTime: leadOf(s),
      completeAccurate: accuracyOf(s),
      order: i,
      state: "future",
    };
    if (s.description) copy.description = s.description;
    return copy;
  });
}

/** The stages in `after` that are new or changed since `before` (by reference): the rows to write. */
export function changedStages(
  before: readonly ValueStreamStage[],
  after: readonly ValueStreamStage[]
): ValueStreamStage[] {
  const old = new Map(rows(before).map((s) => [s.id, s]));
  return rows(after).filter((s) => old.get(s.id) !== s);
}

const days = (n: number) => `${fmt(n)} ${n === 1 ? "day" : "days"}`;
const pct = (n: number) => `${fmt(n, 0)}%`;

/**
 * One sentence on a map: how much of the lead time is waiting, and where
 * work waits longest.
 *
 *   "Waiting is 75% of the 20-day lead time; Code review waits longest (6 days)."
 */
export function vsmVerdict(stages: readonly ValueStreamStage[]): string {
  const list = rows(stages);
  if (list.length === 0) return "No stages mapped yet.";
  const s = vsmSummary(list);
  if (s.flowEfficiency === null)
    return "No lead times yet: add how long work spends in each stage.";
  const waiting = 100 - s.flowEfficiency;
  const lead = `${fmt(s.totalLead)}-day lead time`;
  const head =
    waiting <= 0 ? `Nothing waits in the ${lead}` : `Waiting is ${pct(waiting)} of the ${lead}`;
  const b = bottleneck(list);
  if (b)
    return `${head}; ${b.stage.name.trim() || "An unnamed stage"} waits longest (${days(b.waitDays)}).`;
  return list.length === 1 ? `${head}; map the next stage to see where work waits.` : `${head}.`;
}

/**
 * One sentence comparing the maps, or null without a future map.
 *
 *   "The future state cuts lead time from 20 to 12 days and lifts flow efficiency from 25% to 42%."
 */
export function comparisonVerdict(comparison: StateComparison | null): string | null {
  if (!comparison) return null;
  const { current: a, future: b } = comparison;
  const lead =
    b.totalLead < a.totalLead
      ? `cuts lead time from ${fmt(a.totalLead)} to ${days(b.totalLead)}`
      : b.totalLead > a.totalLead
        ? `lengthens lead time from ${fmt(a.totalLead)} to ${days(b.totalLead)}`
        : `keeps lead time at ${days(a.totalLead)}`;
  if (a.flowEfficiency === null || b.flowEfficiency === null) return `The future state ${lead}.`;
  const fe =
    Math.round(b.flowEfficiency) > Math.round(a.flowEfficiency)
      ? `lifts flow efficiency from ${pct(a.flowEfficiency)} to ${pct(b.flowEfficiency)}`
      : Math.round(b.flowEfficiency) < Math.round(a.flowEfficiency)
        ? `lowers flow efficiency from ${pct(a.flowEfficiency)} to ${pct(b.flowEfficiency)}`
        : `keeps flow efficiency at ${pct(a.flowEfficiency)}`;
  return `The future state ${lead} and ${fe}.`;
}
