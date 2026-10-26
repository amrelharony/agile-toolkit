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
 * inputs, and the row's own copy only matters once the item is gone. Rows
 * of the other methods are their own source, and an item shows the latest
 * row linked to it.
 *
 * Plain module (no "use client", no store): the MCP route calls it.
 */

import type { BacklogItem, PrioritizationItem } from "@/lib/stores/workspace-types";
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

/**
 * The fields a row scores from: for an embedded method with its linked
 * item, the row's fields with every owned input taken from the item (one
 * the item doesn't hold is unset, never the row's stale copy); otherwise
 * the row's own fields. lib/prioritization/binding re-exports it.
 */
export function readThrough(row: PrioritizationItem, item?: BacklogItem): RowFields {
  const m = methodFor(row.framework);
  const own = row.fields ?? {};
  if (!m || !m.embedded || !m.fromBacklog || !item || row.backlogItemId !== item.id) return own;
  const fromItem = m.fromBacklog(item);
  const keys = m.inputs.filter((i) => i.backlogKey).map((i) => i.key);
  const v: Values = { ...m.read(own) };
  for (const key of keys) v[key] = fromItem[key];
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
 * itself; any other method's from the latest row linked to it (empty when
 * there is none).
 */
export function itemValues(
  item: BacklogItem,
  rows: readonly PrioritizationItem[],
  id: MethodId
): Values {
  const m = method(id);
  if (m.embedded && m.fromBacklog) return m.fromBacklog(item);
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
