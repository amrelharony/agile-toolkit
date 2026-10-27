/**
 * The prioritization method registry: the only scoring code.
 *
 * The method tools, the Backlog Prioritizer hub, scores.ts, Sprint
 * Planning, the AI prompts and the agent actions all read a method from
 * here, so the same item gets the same number everywhere (tool = hub =
 * agent = Sprint Planning).
 *
 * A row of an embedded method (MoSCoW, WSJF, RICE, Value/Effort) that is
 * linked to a backlog item READS THROUGH to the item: the item owns those
 * inputs, and the row's own copy only matters once the item is gone, or,
 * for a link made before Phase 7, while its item still holds only the old
 * defaults for the method (legacyRowValues). Rows of the other methods are
 * their own source, and an item shows the latest row linked to it.
 *
 * Plain module (no "use client", no store): the MCP route calls it.
 */

import type { BacklogItem, PrioritizationItem } from "@/lib/stores/workspace-types";
import {
  OLD_BACKLOG_DEFAULTS,
  oldDefaultMethods,
  savedByEngine,
  withoutOldDefaults,
} from "../defaults";
import { COST_OF_DELAY } from "./cost-of-delay";
import { EISENHOWER } from "./eisenhower";
import { ICE } from "./ice";
import { KANO } from "./kano";
import { MOSCOW } from "./moscow";
import { RICE } from "./rice";
import { VALUE_EFFORT } from "./value-effort";
import { WSJF } from "./wsjf";
import type {
  EvalContext,
  MethodId,
  MethodScore,
  PrioritizationMethod,
  RowFields,
  Values,
} from "./types";

export type * from "./types";
export { COST_OF_DELAY, EISENHOWER, ICE, KANO, MOSCOW, RICE, VALUE_EFFORT, WSJF };

/** Every method: the hub's seven in its order, then Eisenhower (personal tasks, off the hub). */
export const METHODS: readonly PrioritizationMethod[] = [
  MOSCOW,
  WSJF,
  RICE,
  VALUE_EFFORT,
  ICE,
  KANO,
  COST_OF_DELAY,
  EISENHOWER,
];

/** The methods the Backlog Prioritizer compares, in its column order. */
export const HUB_METHOD_IDS: readonly MethodId[] = [
  "moscow",
  "wsjf",
  "rice",
  "value-effort",
  "ice",
  "kano",
  "cost-of-delay",
];

/** The methods whose inputs the backlog item holds. */
export const EMBEDDED_METHOD_IDS: readonly MethodId[] = METHODS.filter((m) => m.embedded).map(
  (m) => m.id
);

const BY_ID = new Map<string, PrioritizationMethod>(METHODS.map((m) => [m.id, m]));
const BY_TOOL = new Map<string, PrioritizationMethod>(METHODS.map((m) => [m.toolId, m]));

export const isMethodId = (v: unknown): v is MethodId => typeof v === "string" && BY_ID.has(v);

/** The method with this id. */
export function method(id: MethodId): PrioritizationMethod {
  return BY_ID.get(id) as PrioritizationMethod;
}

/** The method a row's `framework` names; undefined for frameworks that aren't methods ($100, Buy-a-Feature). */
export function methodFor(framework: string | undefined): PrioritizationMethod | undefined {
  return framework ? BY_ID.get(framework) : undefined;
}

/** The method a tool scores with, by tool id ("rice-scoring" → RICE). */
export function methodForTool(toolId: string): PrioritizationMethod | undefined {
  return BY_TOOL.get(toolId);
}

/* ── Links made before Phase 7 ─────────────────────────────────────── */

let oldInputsCache: Map<MethodId, Values> | undefined;

/**
 * Each embedded method's inputs as the old defaults filled them: what a
 * row copied from an untouched pre-Phase 7 item holds (MoSCoW "should",
 * WSJF 5/5/5/5, RICE 100/1/80/1, Value/Effort 5 and 5).
 */
function oldDefaultInputs(m: PrioritizationMethod): Values | undefined {
  if (!oldInputsCache) {
    // Stamped, so the defaults read as the values they are.
    const stamped: BacklogItem = { id: "", name: "", ...OLD_BACKLOG_DEFAULTS, updatedAt: "old" };
    oldInputsCache = new Map();
    for (const x of METHODS)
      if (x.embedded && x.fromBacklog) oldInputsCache.set(x.id, x.fromBacklog(stamped));
  }
  return oldInputsCache.get(m.id);
}

/** The inputs a method's backlog item holds (the ones a linked row reads through). */
const ownedInputs = (m: PrioritizationMethod) => m.inputs.filter((i) => i.backlogKey);

/** True when a row's own inputs are a copy of the old defaults: nothing was chosen in it either. */
function isOldDefaultCopy(m: PrioritizationMethod, own: Values): boolean {
  const old = oldDefaultInputs(m);
  return (
    !!old && ownedInputs(m).every((i) => old[i.key] === undefined || own[i.key] === old[i.key])
  );
}

/**
 * What a row linked before Phase 7 was given in its tool, where its item
 * can't say. Before Phase 7 a link wrote the row's inputs to the item once
 * and later edits in the tool changed only the row (MoSCoW's move, WSJF's
 * and RICE's re-score), so an untouched default item (imported unchanged,
 * then re-scored in the tool) still holds the old defaults, which read as
 * Not scored. For an item the new code never saved whose old defaults hide
 * this method (lib/prioritization/defaults oldDefaultMethods), the row's
 * own value is then the only real one: it fills each input the item reads
 * as unset (a value WSJF holds stays the one value field). A row whose own
 * inputs are the old defaults too adds nothing. Empty for any other link.
 */
export function legacyRowValues(row: PrioritizationItem, item: BacklogItem): Values {
  const m = methodFor(row.framework);
  if (!m || !m.embedded || !m.fromBacklog || row.backlogItemId !== item.id) return {};
  if (!(oldDefaultMethods(item) as readonly string[]).includes(m.id)) return {};
  const own = m.read(row.fields ?? {});
  if (isOldDefaultCopy(m, own)) return {};
  const held = m.fromBacklog(item);
  const out: Values = {};
  for (const input of ownedInputs(m)) {
    if (held[input.key] === undefined && own[input.key] !== undefined) {
      out[input.key] = own[input.key];
    }
  }
  return out;
}

/**
 * The backlog fields an item's legacy links fill (legacyRowValues of the
 * latest linked row in each method, in the hub's method order, each
 * filling only what is still unset): empty for an item the new code saved
 * or one with no such link.
 */
export function legacyLinkValues(
  item: BacklogItem,
  rows: readonly PrioritizationItem[]
): Partial<BacklogItem> {
  const legacy = oldDefaultMethods(item) as readonly string[];
  if (legacy.length === 0 || rows.length === 0) return {};
  const out: Partial<BacklogItem> = {};
  let read: BacklogItem | undefined;
  for (const m of METHODS) {
    if (!m.embedded || !m.toBacklog || !m.fromBacklog || !legacy.includes(m.id)) continue;
    const row = latestLinkedRow(rows, item.id, m.id);
    if (!row) continue;
    const own = legacyRowValues(row, item);
    // What the fills so far already answer (WSJF's value is Value/Effort's too).
    read ??= withoutOldDefaults(item);
    const held = m.fromBacklog({ ...read, ...out });
    const fill: Values = {};
    for (const [key, v] of Object.entries(own)) if (held[key] === undefined) fill[key] = v;
    Object.assign(out, m.toBacklog(fill));
  }
  return out;
}

/**
 * The item as its legacy links say it reads: the old defaults cleared and
 * each linked row's legacy values filled in (legacyLinkValues). The same
 * item when there is nothing to fill. Every save of an item starts from
 * it (lib/prioritization/backlog-links), so the first save through the
 * new code writes those values to the item, which owns them from then on.
 */
export function withLegacyLinks(
  item: BacklogItem,
  rows: readonly PrioritizationItem[]
): BacklogItem {
  const fill = legacyLinkValues(item, rows);
  return Object.keys(fill).length === 0 ? item : { ...withoutOldDefaults(item), ...fill };
}

/** One input where a legacy row and its item disagree. */
export interface LegacyDifference {
  key: string;
  /** What the row was given in its tool. */
  row: string | number;
  /** What the backlog item holds, and the row shows. */
  item: string | number;
}

/**
 * Where a row linked before Phase 7 holds another value than its item, for
 * an item the new code never saved: old items carry no date, so nothing
 * says which side is newer (a tool edit changed only the row, a hub edit
 * only the item). The item's value counts, as the binding says; the tool
 * asks once which to keep. Empty once the item is saved through the new
 * code, or when the row's own inputs are the old defaults.
 */
export function legacyDifferences(
  row: PrioritizationItem,
  item: BacklogItem | undefined
): LegacyDifference[] {
  const m = methodFor(row.framework);
  if (!m || !m.embedded || !m.fromBacklog || !item || row.backlogItemId !== item.id) return [];
  if (savedByEngine(item)) return [];
  const own = m.read(row.fields ?? {});
  if (isOldDefaultCopy(m, own)) return [];
  const shown = m.read(readThrough(row, item));
  const out: LegacyDifference[] = [];
  for (const input of ownedInputs(m)) {
    const a = own[input.key];
    const b = shown[input.key];
    if (a === undefined || b === undefined || a === b) continue;
    out.push({ key: input.key, row: a, item: b });
  }
  return out;
}

/**
 * The fields a row scores from: for an embedded method with its linked
 * item, the row's fields with every owned input taken from the item (one
 * the item doesn't hold is unset, never the row's stale copy, except where
 * a link made before Phase 7 still holds the only real value:
 * legacyRowValues); otherwise the row's own fields.
 * lib/prioritization/binding re-exports it.
 */
export function readThrough(row: PrioritizationItem, item?: BacklogItem): RowFields {
  const m = methodFor(row.framework);
  const own = row.fields ?? {};
  if (!m || !m.embedded || !m.fromBacklog || !item || row.backlogItemId !== item.id) return own;
  const fromItem = m.fromBacklog(item);
  const legacy = legacyRowValues(row, item);
  const v: Values = { ...m.read(own) };
  for (const { key } of ownedInputs(m)) v[key] = fromItem[key] ?? legacy[key];
  return m.write(own, v);
}

/** A row's score, read through to its linked item. */
export function evaluateRow(
  row: PrioritizationItem,
  item?: BacklogItem,
  ctx?: EvalContext
): MethodScore {
  const m = methodFor(row.framework);
  if (!m) return { score: null, bucket: null, sortKey: null, missing: [], warnings: [] };
  return m.evaluate(m.read(readThrough(row, item)), ctx);
}

/** The most recently updated row of `framework` linked to the backlog item. */
export function latestLinkedRow(
  rows: readonly PrioritizationItem[],
  backlogItemId: string,
  framework: string
): PrioritizationItem | undefined {
  let latest: PrioritizationItem | undefined;
  for (const row of rows) {
    if (row.backlogItemId !== backlogItemId || row.framework !== framework) continue;
    if (!latest || (row.updatedAt ?? "") >= (latest.updatedAt ?? "")) latest = row;
  }
  return latest;
}

/**
 * A backlog item's inputs in one method: an embedded method's from the item
 * itself (with what its legacy links still hold: withLegacyLinks); any
 * other method's from the latest row linked to it (empty when there is
 * none).
 */
export function itemValues(
  item: BacklogItem,
  rows: readonly PrioritizationItem[],
  id: MethodId
): Values {
  const m = method(id);
  if (m.embedded && m.fromBacklog) return m.fromBacklog(withLegacyLinks(item, rows));
  const row = latestLinkedRow(rows, item.id, id);
  return row ? m.read(row.fields) : {};
}

/** A backlog item's result in one method (see itemValues). */
export function evaluateItemIn(
  item: BacklogItem,
  rows: readonly PrioritizationItem[],
  id: MethodId,
  ctx?: EvalContext
): MethodScore {
  return method(id).evaluate(itemValues(item, rows, id), ctx);
}

/** A backlog item's result in every method. */
export function evaluateItem(
  item: BacklogItem,
  rows: readonly PrioritizationItem[],
  ctx?: EvalContext
): Record<MethodId, MethodScore> {
  const out = {} as Record<MethodId, MethodScore>;
  for (const m of METHODS) out[m.id] = evaluateItemIn(item, rows, m.id, ctx);
  return out;
}

/** True when a result has a score (the rest read "Not scored"). */
export const isScored = (s: MethodScore): boolean => s.score !== null;

/**
 * Order two results by a method: scored before unscored, then the
 * method's own compare (Cost of Delay's lanes) or sortKey descending.
 * 0 for a tie, so a stable sort keeps the stored order.
 */
export function compareResults(m: PrioritizationMethod, a: MethodScore, b: MethodScore): number {
  const as = a.sortKey !== null;
  const bs = b.sortKey !== null;
  if (as !== bs) return as ? -1 : 1;
  if (!as) return 0;
  if (m.compare) return m.compare(a, b);
  return (b.sortKey as number) - (a.sortKey as number);
}

/**
 * A row's stored score cache: the engine's score (unrounded) and status
 * "scored", or no score and status "open" ("Not scored"). A later
 * lifecycle status the row already has (decided, shipped, dropped) stays.
 */
export function scoreCache(
  s: MethodScore,
  prevStatus?: PrioritizationItem["status"]
): Pick<PrioritizationItem, "score" | "status"> {
  const lifecycle =
    prevStatus === "decided" || prevStatus === "shipped" || prevStatus === "dropped"
      ? prevStatus
      : undefined;
  return s.score === null
    ? { score: undefined, status: lifecycle ?? "open" }
    : { score: s.score, status: lifecycle ?? "scored" };
}
