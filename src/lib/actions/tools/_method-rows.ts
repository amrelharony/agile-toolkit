/**
 * Shared plumbing for the prioritization method actions (tool.rice_scoring,
 * tool.wsjf, tool.ice_score, tool.moscow, tool.value_effort_matrix,
 * tool.kano_model, tool.cost_of_delay, tool.eisenhower, tool.prioritizer).
 *
 * Every number comes from the method registry (lib/prioritization/methods),
 * the code the pages use, so an agent sees what the screen shows:
 * - lists read linked rows through to their backlog items and rank with the
 *   method's own order, a row without a full set of inputs is
 *   `score: null` ("Not scored") and listed last;
 * - persist verbs check the inputs the way the forms do, recompute the
 *   score (a caller's `score` is ignored), keep an existing row's other
 *   fields and its backlog link, and for a method the backlog holds write
 *   the inputs through to the linked BacklogItem (the server twin of the
 *   pages' saveMethodRow).
 *
 * The leading underscore keeps scripts/generate-action-registry.mjs from
 * importing it as an action module.
 */

import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { BacklogItem, PrioritizationItem } from "@/lib/stores/workspace-types";
import {
  serverBulkUpsertEntities,
  serverGetEntity,
  serverListEntities,
  serverUpsertEntity,
} from "../server-store";
import {
  applyItemPatch,
  itemPatchChanges,
  methodRow,
  ownedPatch,
} from "@/lib/prioritization/binding";
import {
  method,
  readThrough,
  type EvalContext,
  type MethodId,
  type Values,
} from "@/lib/prioritization/methods";
import { defined } from "@/lib/prioritization/methods/fields";
import { rankMethodRows, type RankedRow } from "@/lib/prioritization/rank";

export const KIND_PRIORITIZATION = "workspace:prioritization";
export const KIND_BACKLOG = "workspace:backlogItem";

/** Where the actions read and write: the browser store, or the user's rows on the server. */
export interface MethodStore {
  rows(): Promise<PrioritizationItem[]>;
  items(): Promise<BacklogItem[]>;
  row(id: string): Promise<PrioritizationItem | undefined>;
  item(id: string): Promise<BacklogItem | undefined>;
  putRows(rows: PrioritizationItem[]): Promise<void>;
  putItem(item: BacklogItem): Promise<void>;
}

/** The browser store (the in-app agent's `handler` path). */
export function clientStore(): MethodStore {
  const ws = () => useWorkspaceStore.getState();
  return {
    rows: async () => ws().prioritizations ?? [],
    items: async () => ws().backlogItems ?? [],
    row: async (id) => (ws().prioritizations ?? []).find((r) => r.id === id),
    item: async (id) => (ws().backlogItems ?? []).find((b) => b.id === id),
    putRows: async (rows) => {
      for (const r of rows) ws().upsertPrioritization(r);
    },
    putItem: async (item) => ws().upsertBacklogItem(item),
  };
}

/** The user's synced rows on the server (the MCP `mcpHandler` path). */
export function serverStore(userId: string): MethodStore {
  return {
    rows: () => serverListEntities<PrioritizationItem>(userId, KIND_PRIORITIZATION),
    items: () => serverListEntities<BacklogItem>(userId, KIND_BACKLOG),
    row: async (id) =>
      (await serverGetEntity<PrioritizationItem>(userId, KIND_PRIORITIZATION, id)) ?? undefined,
    item: async (id) => (await serverGetEntity<BacklogItem>(userId, KIND_BACKLOG, id)) ?? undefined,
    putRows: async (rows) => {
      if (rows.length === 1) await serverUpsertEntity(userId, KIND_PRIORITIZATION, rows[0]);
      // One round-trip for a batch: much faster for a backlog of 50+ items.
      else if (rows.length > 1) await serverBulkUpsertEntities(userId, KIND_PRIORITIZATION, rows);
    },
    putItem: (item) => serverUpsertEntity(userId, KIND_BACKLOG, item),
  };
}

const randomId = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;

/** A fresh id for a row an agent persists. */
export const newRowId = () => randomId("prio");

/** A fresh id for a candidate that isn't stored (compute_and_rank). */
export const candidateId = (prefix: string) => randomId(prefix);

/**
 * The draft's errors as one message, or null when it is valid. `mayOmit`
 * lists inputs an agent may leave out although the form asks for them (a
 * parameter added after agents started calling the action): their
 * "missing" errors are dropped; a wrong value is still an error. `keep` is
 * what the row already shows (validate's: a held off-scale value stays
 * valid, as in the form).
 */
export function validationError(
  id: MethodId,
  values: Values,
  title?: string,
  mayOmit: readonly string[] = [],
  keep?: Values
): string | null {
  const v = method(id).validate(values, keep);
  if (v.ok) return null;
  const errors = Object.entries(v.errors).filter(
    ([key, msg]) => msg && !(mayOmit.includes(key) && values[key] === undefined)
  );
  if (errors.length === 0) return null;
  const msgs = Array.from(new Set(errors.map(([, msg]) => msg)));
  return `${title ? `“${title}”: ` : ""}${msgs.join(" ")}`;
}

/** Throw the draft's errors, as a form would show them. */
export function assertValid(
  id: MethodId,
  values: Values,
  title?: string,
  mayOmit: readonly string[] = [],
  keep?: Values
): void {
  const error = validationError(id, values, title, mayOmit, keep);
  if (error) throw new Error(error);
}

/** One row an agent asked to persist. */
export interface PersistInput {
  id?: string;
  title: string;
  values: Values;
  /** Link (or re-link) the row to this backlog item. */
  backlogItemId?: string;
}

export interface Persisted {
  row: PrioritizationItem;
  /** The engine's score; null when the row isn't scored. */
  score: number | null;
  bucket: string | null;
  /** The backlog item the row is linked to, when it exists. */
  backlogItemId: string | null;
  /** The backlog fields written through to that item (embedded methods). */
  backlogUpdated: string[];
}

/**
 * What a persist may keep although it is off a strict scale: the values
 * the existing row shows (read through to its item), else, for a new row
 * linked to an item, what the item holds. The form passes the same.
 */
function heldValues(
  id: MethodId,
  prev: PrioritizationItem | undefined,
  item: BacklogItem | undefined
): Values | undefined {
  const m = method(id);
  if (prev) return m.read(readThrough(prev, item));
  return item && m.embedded && m.fromBacklog ? m.fromBacklog(item) : undefined;
}

/**
 * Persist rows of one method: each checked like the form (throws on the
 * first invalid one, nothing written), merged over the existing row of
 * that id (its other fields and link kept), scored by the engine, and for
 * an embedded method with a linked item written through to the item.
 */
export async function persistMethodRows(
  store: MethodStore,
  id: MethodId,
  inputs: readonly PersistInput[],
  opts: { ctx?: EvalContext; mayOmit?: readonly string[] } = {}
): Promise<Persisted[]> {
  const { ctx, mayOmit = [] } = opts;
  const m = method(id);
  // Look everything up first, so an invalid input writes nothing.
  const planned: {
    input: PersistInput;
    prev: PrioritizationItem | undefined;
    linkId: string | undefined;
  }[] = [];
  for (const input of inputs) {
    const existing = input.id ? await store.row(input.id) : undefined;
    // An id that holds another method's row is overwritten, not merged.
    const prev = existing && existing.framework === id ? existing : undefined;
    const linkId = input.backlogItemId ?? prev?.backlogItemId;
    const item = linkId ? await store.item(linkId) : undefined;
    if (input.backlogItemId && !item) {
      throw new Error(
        `No backlog item ${input.backlogItemId}: list them with tool.prioritizer.list_state.`
      );
    }
    assertValid(id, input.values, input.title, mayOmit, heldValues(id, prev, item));
    planned.push({ input, prev, linkId });
  }
  const now = new Date().toISOString();
  const out: Persisted[] = [];
  const itemWrites = new Map<string, BacklogItem>();
  for (const { input, prev, linkId } of planned) {
    const rowId = input.id ?? newRowId();
    const item = linkId ? (itemWrites.get(linkId) ?? (await store.item(linkId))) : undefined;
    const row = methodRow({
      id: rowId,
      framework: id,
      title: input.title,
      values: input.values,
      prev,
      backlogItemId: item ? item.id : prev?.backlogItemId ? prev.backlogItemId : null,
      now,
      ctx,
    });
    let written: string[] = [];
    if (item && m.embedded) {
      const changes = itemPatchChanges(item, ownedPatch(id, m.read(row.fields)));
      written = Object.keys(changes);
      if (written.length > 0) itemWrites.set(item.id, applyItemPatch(item, changes, now));
    }
    const result = m.evaluate(m.read(row.fields), ctx);
    out.push({
      row,
      score: result.score,
      bucket: result.bucket,
      backlogItemId: item ? item.id : null,
      backlogUpdated: written,
    });
  }
  await store.putRows(out.map((p) => p.row));
  for (const item of Array.from(itemWrites.values())) await store.putItem(item);
  return out;
}

/** One method's rows as an agent lists them: read through, scored, ranked. */
export interface ListedRow {
  id: string;
  title: string;
  /** The stored fields with the inputs as scored (a linked row's from its backlog item). */
  fields: Record<string, number | string>;
  /** The method's inputs by key (unset ones left out). */
  values: Record<string, number | string>;
  /** The engine's score, unrounded; null when not scored (listed last). */
  score: number | null;
  /** Dense rank among scored rows (ties share it); null when not scored. */
  rank: number | null;
  /** 0..1 within the scored rows (1 = top, ties share it); null when not scored. */
  percentile: number | null;
  bucket: string | null;
  /** The inputs keeping it from a score. */
  missing: string[];
  warnings: string[];
  backlogItemId: string | null;
  /** Read through to a backlog item that still exists. */
  live: boolean;
  updatedAt: string;
  extra?: Record<string, number | string | boolean | null | undefined>;
}

/** Rows ranked by the method, as listed: unscored last. */
export function listedRows(id: MethodId, ranked: readonly RankedRow[]): ListedRow[] {
  const m = method(id);
  const maxRank = ranked.reduce((n, r) => Math.max(n, r.rank ?? 0), 0);
  return ranked.map((r) => ({
    id: r.row.id,
    title: r.row.title,
    fields: m.write(r.row.fields, r.values),
    values: defined(r.values) as Record<string, number | string>,
    score: r.result.score,
    rank: r.rank,
    percentile: r.rank === null ? null : maxRank <= 1 ? 1 : (maxRank - r.rank + 1) / maxRank,
    bucket: r.result.bucket,
    missing: r.result.missing,
    warnings: r.result.warnings,
    backlogItemId: r.row.backlogItemId ?? null,
    live: r.live,
    updatedAt: r.row.updatedAt,
    ...(r.result.extra ? { extra: r.result.extra } : {}),
  }));
}

/** One method's rows, read through to their items, ranked by the method, unscored last. */
export async function listMethodRows(
  store: MethodStore,
  id: MethodId,
  ctx?: EvalContext
): Promise<ListedRow[]> {
  const [rows, items] = await Promise.all([store.rows(), method(id).embedded ? store.items() : []]);
  return listedRows(id, rankMethodRows(id, rows, items, ctx));
}

/** A candidate an agent asks to score without storing it. */
export interface Candidate {
  id: string;
  title: string;
  /** The fields as the caller gave them (echoed back). */
  fields: Record<string, unknown>;
  values: Values;
}

/**
 * Score and rank candidates by the method (pure: nothing stored). The
 * caller's fields come back as given, with the engine's score, rank and
 * the rest of a listed row; unscored candidates are last.
 */
export function rankCandidates(
  id: MethodId,
  candidates: readonly Candidate[],
  ctx?: EvalContext
): (Omit<ListedRow, "fields"> & { fields: Record<string, unknown> })[] {
  const m = method(id);
  const rows: PrioritizationItem[] = candidates.map((c) => ({
    id: c.id,
    framework: id,
    title: c.title,
    fields: m.write(undefined, c.values),
    updatedAt: "",
  }));
  const given = new Map(candidates.map((c) => [c.id, c.fields]));
  return listedRows(id, rankMethodRows(id, rows, [], ctx)).map((r) => ({
    ...r,
    fields: given.get(r.id) ?? r.fields,
  }));
}
