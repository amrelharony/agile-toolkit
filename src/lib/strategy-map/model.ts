/**
 * A strategy map: an Impact Map or a Strategy Tree (DIBB, Lean Value Tree,
 * Hoshin Kanri), kept as one StrategyMap row with its `format`. One root at
 * level 0, each node one level below its parent, never past level 3 (the
 * rules, lib/strategy-map/rules, which every write keeps).
 *
 * What the two pages and Amr's verbs share: reading a synced or imported
 * row into one that keeps the rules (readStrategyMap), the edits (add a
 * node, change one, the impact map's focus, a tree's status), the two
 * moments the pages celebrate (the first focus, the whole tree agreed),
 * the node form's check, and the size a row may grow to. Pure and
 * server-safe: no React, no store, no "use client" module.
 */

import {
  ENTITY_ROW_MAX_BYTES,
  HANDOFF_ROUTE_IDS,
  STRATEGY_MAP_FORMATS,
  STRATEGY_NODE_STATUSES,
  TOOL_LIST_MAX,
  TOOL_TEXT_MAX,
  type HandoffLink,
  type StrategyMap,
  type StrategyMapFormat,
  type StrategyMapNode,
  type StrategyNodeStatus,
} from "@/lib/stores/workspace-types";
import { isIsoDate } from "@/lib/sprints/calendar";
import { jsonBytes } from "@/lib/utils/json-bytes";
import type { FormErrors, Validation } from "@/lib/utils/form";
import { subtreeIds } from "@/lib/trees/parent-tree";
import { LAST_LEVEL, STRATEGY_FORMATS, hasStatus, levelHas, levelOf } from "./formats";

// The path from the root to a node lives in ./path (the Epic Roadmap reads it too).
export { pathOf, sourcePath } from "./path";

/** A node's text, measure and owner (the CRUD's caps). */
export const NODE_TEXT_MAX = TOOL_TEXT_MAX.short;
export const NODE_FIELD_MAX = TOOL_TEXT_MAX.short;
/** A node's detail and a tree's note. */
export const NODE_DETAIL_MAX = TOOL_TEXT_MAX.text;
/** A map's title. */
export const MAP_TITLE_MAX = TOOL_TEXT_MAX.short;
/** The most nodes one map holds. */
export const STRATEGY_NODES_MAX = TOOL_LIST_MAX.strategyNodes;
/** A node id, as the CRUD bounds it. */
const NODE_ID_MAX = 64;

/* ── Text ────────────────────────────────────────────────────────────── */

/** `v` as text: trimmed and cut to `max` (one line when `oneLine`), "" for anything else. */
export function cleanText(v: unknown, max: number, oneLine = true): string {
  if (typeof v !== "string") return "";
  const t = (oneLine ? v.replace(/\s+/g, " ") : v).trim();
  return t.length > max ? t.slice(0, max).trimEnd() : t;
}

/** A node's text, or "Untitled <level>" for a blank one. */
export function nodeTitle(
  node: Pick<StrategyMapNode, "text" | "level">,
  format: StrategyMapFormat
) {
  const t = (node.text ?? "").replace(/\s+/g, " ").trim();
  return t || `Untitled ${levelOf(format, node.level).label.toLowerCase()}`;
}

/** A map's name: its title, else its root's text, else the format's name. */
export function mapTitle(map: Pick<StrategyMap, "title" | "nodes" | "format">): string {
  const t = (map.title ?? "").trim();
  if (t) return t;
  const root = map.nodes.find((n) => n.parentId === null);
  return root?.text?.trim() || STRATEGY_FORMATS[map.format].label;
}

/* ── Reading a row ───────────────────────────────────────────────────── */

const isFormat = (f: unknown): f is StrategyMapFormat =>
  typeof f === "string" && (STRATEGY_MAP_FORMATS as readonly string[]).includes(f);

const isStatus = (s: unknown): s is StrategyNodeStatus =>
  typeof s === "string" && (STRATEGY_NODE_STATUSES as readonly string[]).includes(s);

function isHandoffLink(v: unknown): v is HandoffLink {
  if (!v || typeof v !== "object") return false;
  const l = v as Record<string, unknown>;
  return (
    typeof l.route === "string" &&
    (HANDOFF_ROUTE_IDS as readonly string[]).includes(l.route) &&
    typeof l.targetId === "string" &&
    l.targetId !== "" &&
    typeof l.at === "string"
  );
}

/** The valid links, the latest one per route; undefined when none. */
function cleanLinks(raw: unknown): HandoffLink[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const byRoute = new Map<string, HandoffLink>();
  for (const l of raw) {
    if (isHandoffLink(l)) byRoute.set(l.route, { route: l.route, targetId: l.targetId, at: l.at });
  }
  return byRoute.size > 0 ? Array.from(byRoute.values()) : undefined;
}

/** A raw node's own fields, before its place in the tree is known. */
interface RawNode {
  id: string;
  parentId: string | null;
  raw: Record<string, unknown>;
}

/**
 * A synced, imported or agent-written row as a map that keeps the rules,
 * or null when it has no id or no format the tools know:
 *   - the first parentless node, in stored order, is the root at level 0
 *     (a row with none, a hand-edited cycle, roots at its first node);
 *   - a node whose parent is gone, a second root, or a loop cut off from
 *     the root, is put back under the root as level 1 with what's under it:
 *     nothing is ever promoted to the root;
 *   - levels are counted again from the root, and anything that would sit
 *     past level 3, or past the node cap, is left out;
 *   - an actor's persona, an impact's focus (the first one) and a tree's
 *     status and note are kept only where the rules allow them;
 *   - text is cut to its caps, and only valid links are kept.
 * Whatever it returns passes strategyMapProblems.
 */
export function readStrategyMap(row: unknown): StrategyMap | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (typeof r.id !== "string" || r.id === "" || !isFormat(r.format)) return null;
  const format = r.format;

  // Nodes with a usable id, the first of each id.
  const raws: RawNode[] = [];
  const known = new Set<string>();
  for (const n of Array.isArray(r.nodes) ? r.nodes : []) {
    if (!n || typeof n !== "object") continue;
    const o = n as Record<string, unknown>;
    if (typeof o.id !== "string" || o.id === "" || o.id.length > NODE_ID_MAX || known.has(o.id)) {
      continue;
    }
    known.add(o.id);
    const parentId = typeof o.parentId === "string" && o.parentId !== o.id ? o.parentId : null;
    raws.push({ id: o.id, parentId, raw: o });
  }

  const nodes: StrategyMapNode[] = [];
  if (raws.length > 0) {
    const root = raws.find((n) => n.parentId === null) ?? raws[0];
    const children = new Map<string, RawNode[]>();
    for (const n of raws) {
      if (n === root || n.parentId === null || !known.has(n.parentId)) continue;
      const list = children.get(n.parentId) ?? [];
      list.push(n);
      children.set(n.parentId, list);
    }
    const placed = new Map<string, { parentId: string | null; level: number }>();
    const order: string[] = [];
    // Breadth first, so a parent is always placed (and counted) before its children.
    const place = (start: RawNode, parentId: string | null, level: number) => {
      const queue: { n: RawNode; parentId: string | null; level: number }[] = [
        { n: start, parentId, level },
      ];
      while (queue.length > 0) {
        const { n, parentId: p, level: l } = queue.shift()!;
        if (placed.has(n.id) || l > LAST_LEVEL || order.length >= STRATEGY_NODES_MAX) continue;
        placed.set(n.id, { parentId: p, level: l });
        order.push(n.id);
        for (const c of children.get(n.id) ?? [])
          queue.push({ n: c, parentId: n.id, level: l + 1 });
      }
    };
    place(root, null, 0);
    // Orphans, extra roots and loops: each branch goes back under the root.
    const byId = new Map(raws.map((n) => [n.id, n]));
    for (const n of raws) {
      if (placed.has(n.id)) continue;
      let top = n;
      let reattach = true;
      const climbed = new Set<string>([n.id]);
      for (;;) {
        const parent = top.parentId ? byId.get(top.parentId) : undefined;
        // A parent that is gone, or none (a second root): the branch goes back under the root.
        if (!parent) break;
        // Under a placed node yet not placed: too deep, or past the cap. Left out.
        if (placed.has(parent.id)) {
          reattach = false;
          break;
        }
        // A loop cut off from the root: it goes back under the root from here.
        if (climbed.has(parent.id)) break;
        climbed.add(parent.id);
        top = parent;
      }
      if (reattach) place(top, root.id, 1);
    }

    let focusTaken = false;
    for (const n of raws) {
      const at = placed.get(n.id);
      if (!at) continue;
      const lvl = at.level as StrategyMapNode["level"];
      const o = n.raw;
      const node: StrategyMapNode = {
        id: n.id,
        parentId: at.parentId,
        level: lvl,
        text:
          cleanText(o.text, NODE_TEXT_MAX) ||
          `Untitled ${levelOf(format, lvl).label.toLowerCase()}`,
      };
      const detail = cleanText(o.detail, NODE_DETAIL_MAX, false);
      if (detail) node.detail = detail;
      const measure = cleanText(o.measure, NODE_FIELD_MAX);
      if (measure) node.measure = measure;
      const owner = cleanText(o.owner, NODE_FIELD_MAX);
      if (owner) node.owner = owner;
      if (hasStatus(format)) {
        if (isStatus(o.status)) node.status = o.status;
        const note = cleanText(o.note, NODE_DETAIL_MAX, false);
        if (note) node.note = note;
      } else {
        const personaId = cleanText(o.personaId, NODE_FIELD_MAX);
        if (personaId && lvl === 1) node.personaId = personaId;
        if (o.focus === true && lvl === 2 && !focusTaken) {
          node.focus = true;
          focusTaken = true;
        }
      }
      const sentTo = cleanLinks(o.sentTo);
      if (sentTo) node.sentTo = sentTo;
      nodes.push(node);
    }
  }

  const map: StrategyMap = {
    id: r.id,
    format,
    title: cleanText(r.title, MAP_TITLE_MAX),
    nodes,
    createdAt: typeof r.createdAt === "string" ? r.createdAt : "",
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : "",
  };
  if (!map.title) map.title = cleanText(mapTitle(map), MAP_TITLE_MAX);
  const goalId = cleanText(r.productGoalId, TOOL_TEXT_MAX.short);
  if (goalId) map.productGoalId = goalId;
  if (
    typeof r.targetDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(r.targetDate) &&
    isIsoDate(r.targetDate)
  ) {
    map.targetDate = r.targetDate;
  }
  return map;
}

/** Every readable map in `rows` (a row the tools can't read is left out). */
export function readStrategyMaps(rows: readonly unknown[] | undefined): StrategyMap[] {
  const out: StrategyMap[] = [];
  for (const row of rows ?? []) {
    const m = readStrategyMap(row);
    if (m) out.push(m);
  }
  return out;
}

/** Newest first, by the last change (then by when it was made). */
export function newestFirst(maps: readonly StrategyMap[]): StrategyMap[] {
  return [...maps].sort(
    (a, b) =>
      (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt) ||
      b.createdAt.localeCompare(a.createdAt)
  );
}

/* ── The tree ────────────────────────────────────────────────────────── */

export const rootOf = (map: Pick<StrategyMap, "nodes">): StrategyMapNode | undefined =>
  map.nodes.find((n) => n.parentId === null);

export const childrenOf = (map: Pick<StrategyMap, "nodes">, id: string): StrategyMapNode[] =>
  map.nodes.filter((n) => n.parentId === id);

export const nodesAt = (map: Pick<StrategyMap, "nodes">, level: number): StrategyMapNode[] =>
  map.nodes.filter((n) => n.level === level);

/** The level a child of `node` takes, or null under the last level. */
export function childLevel(node: Pick<StrategyMapNode, "level">): 1 | 2 | 3 | null {
  return node.level >= LAST_LEVEL ? null : ((node.level + 1) as 1 | 2 | 3);
}

/** Whether a node can go under `parent` on `map`: not under the last level, and the map isn't full. */
export function canAddUnder(map: Pick<StrategyMap, "nodes">, parent: StrategyMapNode): boolean {
  return childLevel(parent) !== null && map.nodes.length < STRATEGY_NODES_MAX;
}

/** How many nodes sit at each level, 0 to 3. */
export function levelCounts(map: Pick<StrategyMap, "nodes">): [number, number, number, number] {
  const counts: [number, number, number, number] = [0, 0, 0, 0];
  for (const n of map.nodes) if (n.level >= 0 && n.level <= LAST_LEVEL) counts[n.level] += 1;
  return counts;
}

/** The impact map's focus impact. */
export const focusOf = (map: Pick<StrategyMap, "nodes">): StrategyMapNode | undefined =>
  map.nodes.find((n) => n.focus === true && n.level === 2);

/* ── Making and changing a map ───────────────────────────────────────── */

export interface NewMapInput {
  id: string;
  rootId: string;
  format: StrategyMapFormat;
  /** The root's text: the impact map's goal, a tree's vision, data or breakthrough. */
  root: string;
  measure?: string;
  title?: string;
  productGoalId?: string;
  targetDate?: string;
  /** ISO time it is made. */
  now: string;
}

/** A new map holding just its root (a strategy tree's root starts "proposed"). */
export function newStrategyMap(i: NewMapInput): StrategyMap {
  const text = cleanText(i.root, NODE_TEXT_MAX);
  const measure = cleanText(i.measure, NODE_FIELD_MAX);
  const root: StrategyMapNode = {
    id: i.rootId,
    parentId: null,
    level: 0,
    text,
    ...(measure && levelHas(i.format, 0, "measure") ? { measure } : {}),
    ...(hasStatus(i.format) ? { status: "proposed" as const } : {}),
  };
  const title = cleanText(i.title, MAP_TITLE_MAX) || text;
  return {
    id: i.id,
    format: i.format,
    title,
    nodes: [root],
    ...(i.productGoalId ? { productGoalId: i.productGoalId } : {}),
    ...(i.targetDate ? { targetDate: i.targetDate } : {}),
    createdAt: i.now,
    updatedAt: i.now,
  };
}

/** The map with `nodes` added at the end. */
export function withNodes(map: StrategyMap, nodes: readonly StrategyMapNode[]): StrategyMap {
  return { ...map, nodes: [...map.nodes, ...nodes] };
}

/** The map with `node` added at the end. */
export function withNode(map: StrategyMap, node: StrategyMapNode): StrategyMap {
  return withNodes(map, [node]);
}

/** The node `id` with `patch` applied; a key set to undefined is removed. */
export function withNodePatch(
  map: StrategyMap,
  id: string,
  patch: Partial<Omit<StrategyMapNode, "id" | "parentId" | "level">>
): StrategyMap {
  return {
    ...map,
    nodes: map.nodes.map((n) => {
      if (n.id !== id) return n;
      const next = { ...n, ...patch } as StrategyMapNode & Record<string, unknown>;
      for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
      return next;
    }),
  };
}

/**
 * The impact map with `impactId` as its one focus impact, or no focus
 * (null). Anything but an impact (level 2) is left alone.
 */
export function withFocus(map: StrategyMap, impactId: string | null): StrategyMap {
  if (impactId !== null && !map.nodes.some((n) => n.id === impactId && n.level === 2)) return map;
  return {
    ...map,
    nodes: map.nodes.map((n) => {
      if (n.id === impactId) return n.focus ? n : { ...n, focus: true };
      if (!n.focus) return n;
      const next = { ...n };
      delete next.focus;
      return next;
    }),
  };
}

/**
 * A strategy tree's node with `status`; a note given replaces the stored
 * one ("" removes it). An impact map's nodes take no status.
 */
export function withStatus(
  map: StrategyMap,
  id: string,
  status: StrategyNodeStatus,
  note?: string
): StrategyMap {
  if (!hasStatus(map.format)) return map;
  const clean = note === undefined ? undefined : cleanText(note, NODE_DETAIL_MAX, false);
  return withNodePatch(map, id, {
    status,
    ...(clean === undefined ? {} : { note: clean || undefined }),
  });
}

/**
 * The nodes after an Undo puts a deleted branch back (`after`), kept to
 * one focus: a focus in the branch gives way to one picked while it was
 * gone (`before`, the nodes without it). On the delete itself nothing
 * comes back, so nothing changes.
 */
export function keepOneFocus(
  before: readonly StrategyMapNode[],
  after: StrategyMapNode[]
): StrategyMapNode[] {
  if (!before.some((n) => n.focus)) return after;
  const had = new Set(before.map((n) => n.id));
  return after.map((n) => {
    if (had.has(n.id) || !n.focus) return n;
    const next = { ...n };
    delete next.focus;
    return next;
  });
}

/** The node `id` and everything under it, in the map's order (what a delete takes). */
export function branchOf(map: Pick<StrategyMap, "nodes">, id: string): StrategyMapNode[] {
  const ids = subtreeIds(map.nodes, id);
  return map.nodes.filter((n) => ids.has(n.id));
}

/* ── Moments ─────────────────────────────────────────────────────────── */

/** Every part that isn't dropped is agreed, with at least two of them. */
function allAgreed(map: StrategyMap | undefined): boolean {
  if (!map) return false;
  const live = map.nodes.filter((n) => n.status !== "dropped");
  return live.length >= 2 && live.every((n) => n.status === "agreed");
}

/**
 * Whether a change made a strategy tree agreed: every part that isn't
 * dropped now agreed, at least two of them, and it wasn't all agreed
 * before. Loading, editing text or toggling an agreed part again never is.
 */
export function becameAgreed(before: StrategyMap | undefined, after: StrategyMap): boolean {
  return hasStatus(after.format) && allAgreed(after) && !allAgreed(before);
}

/** Whether a change gave an impact map its first focus impact. */
export function focusFirstSet(before: StrategyMap | undefined, after: StrategyMap): boolean {
  return !(before && focusOf(before)) && Boolean(focusOf(after));
}

/* ── The node form ───────────────────────────────────────────────────── */

export interface NodeDraft {
  text: string;
  detail: string;
  measure: string;
  owner: string;
  status: StrategyNodeStatus | "";
  note: string;
  personaId: string;
}

export type NodeField = keyof NodeDraft;

export interface NodeValues {
  text: string;
  detail?: string;
  measure?: string;
  owner?: string;
  status?: StrategyNodeStatus;
  note?: string;
  personaId?: string;
}

export const emptyNodeDraft = (format: StrategyMapFormat): NodeDraft => ({
  text: "",
  detail: "",
  measure: "",
  owner: "",
  status: hasStatus(format) ? "proposed" : "",
  note: "",
  personaId: "",
});

export const nodeDraftFrom = (n: StrategyMapNode): NodeDraft => ({
  text: n.text ?? "",
  detail: n.detail ?? "",
  measure: n.measure ?? "",
  owner: n.owner ?? "",
  status: n.status ?? "",
  note: n.note ?? "",
  personaId: n.personaId ?? "",
});

const tooLong = (max: number) => `Keep it to ${max} characters or fewer.`;

/**
 * Check a node's fields for its level: its text, every field within the
 * CRUD's caps (so an agent's update of the same node isn't refused). A
 * level's asked-for measure or owner isn't required here: the checks list
 * it, so a first draft can be saved and filled in later.
 */
export function validateNode(
  d: NodeDraft,
  where: { format: StrategyMapFormat; level: number }
): Validation<NodeValues, NodeField> {
  const errors: FormErrors<NodeField> = {};
  const text = d.text.replace(/\s+/g, " ").trim();
  const detail = d.detail.trim();
  const measure = d.measure.replace(/\s+/g, " ").trim();
  const owner = d.owner.replace(/\s+/g, " ").trim();
  const note = d.note.trim();
  if (!text) errors.text = `Say the ${levelOf(where.format, where.level).label.toLowerCase()}.`;
  else if (text.length > NODE_TEXT_MAX) errors.text = tooLong(NODE_TEXT_MAX);
  if (detail.length > NODE_DETAIL_MAX) errors.detail = tooLong(NODE_DETAIL_MAX);
  if (measure.length > NODE_FIELD_MAX) errors.measure = tooLong(NODE_FIELD_MAX);
  if (owner.length > NODE_FIELD_MAX) errors.owner = tooLong(NODE_FIELD_MAX);
  if (note.length > NODE_DETAIL_MAX) errors.note = tooLong(NODE_DETAIL_MAX);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const shows = (f: "measure" | "owner" | "status" | "persona") =>
    levelHas(where.format, where.level, f);
  return {
    ok: true,
    values: {
      text,
      ...(detail ? { detail } : {}),
      ...(measure && shows("measure") ? { measure } : {}),
      ...(owner && shows("owner") ? { owner } : {}),
      ...(d.status && shows("status") ? { status: d.status } : {}),
      ...(note && shows("status") ? { note } : {}),
      ...(d.personaId && shows("persona") ? { personaId: d.personaId } : {}),
    },
  };
}

/**
 * The node saved with checked values. The fields its level shows are set
 * or removed; a field it doesn't show (an agent's owner on a deliverable)
 * is kept, as are its links and focus.
 */
export function applyNodeValues(
  n: StrategyMapNode,
  v: NodeValues,
  format: StrategyMapFormat
): StrategyMapNode {
  const next: StrategyMapNode = { ...n, text: v.text };
  const set = <K extends "detail" | "measure" | "owner" | "status" | "note" | "personaId">(
    key: K,
    value: StrategyMapNode[K] | undefined
  ) => {
    if (value === undefined) delete next[key];
    else next[key] = value;
  };
  set("detail", v.detail);
  if (levelHas(format, n.level, "measure")) set("measure", v.measure);
  if (levelHas(format, n.level, "owner")) set("owner", v.owner);
  if (levelHas(format, n.level, "status")) {
    set("status", v.status);
    set("note", v.note);
  }
  if (levelHas(format, n.level, "persona")) set("personaId", v.personaId);
  return next;
}

/* ── Size ────────────────────────────────────────────────────────────── */

/** Whether a map still fits one synced row (ENTITY_ROW_MAX_BYTES of UTF-8 JSON). */
export function fitsRow(map: StrategyMap): boolean {
  return jsonBytes(map) <= ENTITY_ROW_MAX_BYTES;
}

/** The plain sentence a page or verb shows when a write would pass the row's size. */
export const TOO_BIG =
  "This map is too big to save. Shorten or remove some parts. Nothing was saved.";

/** The plain sentence when a map holds STRATEGY_NODES_MAX nodes already. */
export const MAP_FULL = `A map holds at most ${STRATEGY_NODES_MAX} parts. Remove some to add more.`;
