/**
 * Root Cause's causal loop diagram: the things that go up or down, the
 * arrows between them (+ when both move the same way, − when they move
 * opposite ways, optionally "takes time"), and the loops the arrows close.
 * A loop with an even number of − arrows feeds itself (reinforcing, R);
 * an odd number holds itself back (balancing, B).
 *
 * A loop is named by its key: its node ids in loop order, starting from
 * the smallest, joined by ">". Moving a thing in the list or flipping an
 * arrow's sign leaves the key, so a loop keeps its name.
 *
 * Pure: no store, no browser globals. Every write keeps the caps the
 * workspace CRUD validates against (TOOL_LIST_MAX.loop*, LOOP_TEXT_MAX), so
 * what the page saves is what an agent can update, and the other way round.
 * `findLoops` and `busiestNode` are re-exported from `model.ts`, which the
 * lazy next-step rule loads.
 */

import {
  ENTITY_ROW_MAX_BYTES,
  LOOP_POLARITIES,
  LOOP_TEXT_MAX,
  TOOL_LIST_MAX,
  type LoopPolarity,
  type RootCauseAnalysis,
  type RootCauseLoop,
  type RootCauseLoopLink,
  type RootCauseLoopName,
  type RootCauseLoopNode,
} from "@/lib/stores/workspace-types";
import { jsonBytes } from "@/lib/utils/json-bytes";

/** Loops found before the search stops (then `truncated`). */
export const LOOP_FIND_MAX = 200;
/** Steps (arrows followed) before the search stops (then `truncated`). */
export const LOOP_STEP_BUDGET = 50_000;
/** Loops the page and Amr show at most: the shortest. */
export const LOOPS_SHOWN = 20;
/** The most things one loop goes through. */
export const LOOP_LENGTH_MAX = 12;
/** An id on the loop, as the CRUD takes it. */
export const LOOP_ID_MAX = 64;
/** A loop's key, as the CRUD takes it. */
export const LOOP_KEY_MAX = 1000;

export type LoopKind = "reinforcing" | "balancing";

export const LOOP_KIND_LABEL: Record<LoopKind, string> = {
  reinforcing: "Reinforcing",
  balancing: "Balancing",
};

/** One loop the arrows close. */
export interface FoundLoop {
  /** Its node ids in loop order, from the smallest, joined by ">". */
  key: string;
  /** Its node ids in loop order, from the smallest. */
  nodeIds: string[];
  /** The arrows, in loop order: the first leaves nodeIds[0]. */
  linkIds: string[];
  kind: LoopKind;
  /** R1, R2… and B1, B2…: shortest first, then by key. */
  label: string;
  /** How many of its arrows take time. */
  delays: number;
}

export interface LoopsFound {
  /** The shortest loops, at most LOOPS_SHOWN. */
  loops: FoundLoop[];
  /**
   * The list may be short: the search stopped early (LOOP_FIND_MAX found or
   * LOOP_STEP_BUDGET steps), or it found more than LOOPS_SHOWN.
   */
  truncated: boolean;
}

/** "There may be more loops than shown." when `truncated`. */
export const LOOPS_TRUNCATED_NOTE = "There may be more loops than shown.";

/* ── Reading ────────────────────────────────────────────────────────── */

/** One line, trimmed and capped (an ellipsis marks a cut). */
export function loopLine(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const t = value.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

const isId = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= LOOP_ID_MAX;

const isPolarity = (v: unknown): v is LoopPolarity =>
  typeof v === "string" && (LOOP_POLARITIES as readonly string[]).includes(v);

/** The empty loop: nothing on it yet. */
export const EMPTY_LOOP: RootCauseLoop = { nodes: [], links: [] };

/**
 * A stored loop made safe to read: things with an id and words (one line,
 * capped; the first of two with one id), arrows between two different
 * things that are there (the first of two from→to; an unknown sign reads as
 * "same"), names with a key and words, each list cut to its cap. It doesn't
 * look for loops: a name whose loop is gone is kept and simply never shown.
 * Undefined for something that isn't a loop at all.
 */
export function readLoop(raw: unknown): RootCauseLoop | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const nodes: RootCauseLoopNode[] = [];
  const ids = new Set<string>();
  for (const n of Array.isArray(r.nodes) ? r.nodes : []) {
    if (nodes.length >= TOOL_LIST_MAX.loopNodes) break;
    const o = n as Record<string, unknown> | null;
    if (!o || typeof o !== "object" || !isId(o.id) || ids.has(o.id)) continue;
    const text = loopLine(o.text, LOOP_TEXT_MAX.node);
    if (!text) continue;
    ids.add(o.id);
    nodes.push({ id: o.id, text });
  }
  const links: RootCauseLoopLink[] = [];
  const linkIds = new Set<string>();
  const pairs = new Set<string>();
  for (const l of Array.isArray(r.links) ? r.links : []) {
    if (links.length >= TOOL_LIST_MAX.loopLinks) break;
    const o = l as Record<string, unknown> | null;
    if (!o || typeof o !== "object" || !isId(o.id) || linkIds.has(o.id)) continue;
    if (!isId(o.from) || !isId(o.to) || o.from === o.to) continue;
    if (!ids.has(o.from) || !ids.has(o.to)) continue;
    const pair = `${o.from}\u0000${o.to}`;
    if (pairs.has(pair)) continue;
    linkIds.add(o.id);
    pairs.add(pair);
    links.push({
      id: o.id,
      from: o.from,
      to: o.to,
      polarity: isPolarity(o.polarity) ? o.polarity : "same",
      ...(o.delay === true ? { delay: true } : {}),
    });
  }
  const out: RootCauseLoop = { nodes, links };
  if (Array.isArray(r.names)) {
    const names: RootCauseLoopName[] = [];
    const keys = new Set<string>();
    for (const n of r.names) {
      if (names.length >= TOOL_LIST_MAX.loopNames) break;
      const o = n as Record<string, unknown> | null;
      if (!o || typeof o !== "object") continue;
      if (typeof o.key !== "string" || !o.key || o.key.length > LOOP_KEY_MAX || keys.has(o.key))
        continue;
      const name = loopLine(o.name, LOOP_TEXT_MAX.name);
      if (!name) continue;
      keys.add(o.key);
      names.push({ key: o.key, name });
    }
    out.names = names;
  }
  return out;
}

/** The analysis's loop, or the empty one. */
export function loopOf(a: Pick<RootCauseAnalysis, "loop">): RootCauseLoop {
  return a.loop ?? EMPTY_LOOP;
}

/** Whether the analysis has anything on a causal loop. */
export function hasLoop(a: Pick<RootCauseAnalysis, "loop">): boolean {
  return (a.loop?.nodes.length ?? 0) > 0;
}

/* ── Finding the loops ─────────────────────────────────────────────── */

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The loops the arrows close (elementary cycles): from each thing, in id
 * order, a bounded search over things with a higher id, so each loop is
 * found once, from its smallest id. Loops longer than LOOP_LENGTH_MAX
 * aren't followed. The search stops at LOOP_FIND_MAX loops or
 * LOOP_STEP_BUDGET steps; the LOOPS_SHOWN shortest are kept (then by key)
 * and labelled R1… and B1… in that order.
 */
export function findLoops(loop: RootCauseLoop | undefined): LoopsFound {
  const nodes = loop?.nodes ?? [];
  const links = loop?.links ?? [];
  const known = new Set(nodes.map((n) => n.id));
  const out: Omit<FoundLoop, "label">[] = [];
  const adjacent = new Map<string, RootCauseLoopLink[]>();
  for (const l of links) {
    if (l.from === l.to || !known.has(l.from) || !known.has(l.to)) continue;
    const list = adjacent.get(l.from) ?? [];
    list.push(l);
    adjacent.set(l.from, list);
  }
  const order = Array.from(known).sort(byId);
  let steps = 0;
  let stopped = false;

  for (const start of order) {
    if (stopped) break;
    const path: string[] = [start];
    const via: RootCauseLoopLink[] = [];
    const onPath = new Set<string>([start]);
    const walk = (at: string): void => {
      for (const l of adjacent.get(at) ?? []) {
        if (stopped) return;
        if (++steps > LOOP_STEP_BUDGET) {
          stopped = true;
          return;
        }
        if (l.to === start) {
          const linkSet = [...via, l];
          const opposite = linkSet.filter((x) => x.polarity === "opposite").length;
          out.push({
            key: path.join(">"),
            nodeIds: [...path],
            linkIds: linkSet.map((x) => x.id),
            kind: opposite % 2 === 0 ? "reinforcing" : "balancing",
            delays: linkSet.filter((x) => x.delay === true).length,
          });
          if (out.length >= LOOP_FIND_MAX) {
            stopped = true;
            return;
          }
          continue;
        }
        if (byId(l.to, start) <= 0 || onPath.has(l.to) || path.length >= LOOP_LENGTH_MAX) continue;
        path.push(l.to);
        via.push(l);
        onPath.add(l.to);
        walk(l.to);
        onPath.delete(l.to);
        via.pop();
        path.pop();
      }
    };
    walk(start);
  }

  const sorted = out.sort((a, b) => a.nodeIds.length - b.nodeIds.length || byId(a.key, b.key));
  const kept = sorted.slice(0, LOOPS_SHOWN);
  let r = 0;
  let b = 0;
  return {
    loops: kept.map((l) => ({
      ...l,
      label: l.kind === "reinforcing" ? `R${++r}` : `B${++b}`,
    })),
    truncated: stopped || sorted.length > LOOPS_SHOWN,
  };
}

/** The loops that go through `nodeId`. */
export function loopsThrough(found: LoopsFound, nodeId: string): FoundLoop[] {
  return found.loops.filter((l) => l.nodeIds.includes(nodeId));
}

/** The loops that use the arrow `linkId`. */
export function loopsUsing(found: LoopsFound, linkId: string): FoundLoop[] {
  return found.loops.filter((l) => l.linkIds.includes(linkId));
}

/** The name the team gave a loop, or null. */
export function loopName(loop: RootCauseLoop, key: string): string | null {
  return (loop.names ?? []).find((n) => n.key === key)?.name ?? null;
}

/* ── Saying what a loop does ───────────────────────────────────────── */

/** "Checkout errors" → "checkout errors"; "API errors" stays. */
function lowerFirst(text: string): string {
  if (text.length < 2) return text.toLowerCase();
  const [a, b] = [text[0], text[1]];
  return b === b.toUpperCase() && b !== b.toLowerCase() ? text : a.toLowerCase() + text.slice(1);
}

/**
 * The loop's things and arrows from the one earliest in the list, so it
 * reads from where the team started (its key still starts at the smallest
 * id). Each arrow leaves the thing at the same place.
 */
function fromListStart(loop: RootCauseLoop, found: FoundLoop) {
  const order = new Map(loop.nodes.map((n, i) => [n.id, i]));
  const place = (id: string) => order.get(id) ?? Number.MAX_SAFE_INTEGER;
  let start = 0;
  found.nodeIds.forEach((id, i) => {
    if (place(id) < place(found.nodeIds[start])) start = i;
  });
  const turn = <T>(list: readonly T[]) => [...list.slice(start), ...list.slice(0, start)];
  return { nodeIds: turn(found.nodeIds), linkIds: turn(found.linkIds) };
}

/**
 * The loop in one sentence: "More checkout errors → more support tickets
 * → … → more checkout errors: each turn adds to the last (reinforcing)."
 * It starts at the loop's thing earliest in the list; each thing goes up
 * ("more") or down ("less") as the arrows carry that first rise around.
 */
export function describeLoop(loop: RootCauseLoop, found: FoundLoop): string {
  const text = new Map(loop.nodes.map((n) => [n.id, n.text]));
  const link = new Map(loop.links.map((l) => [l.id, l]));
  const { nodeIds, linkIds } = fromListStart(loop, found);
  let up = true;
  const words: string[] = [];
  nodeIds.forEach((id, i) => {
    words.push(`${up ? "more" : "less"} ${lowerFirst(text.get(id) ?? id)}`);
    if (link.get(linkIds[i])?.polarity === "opposite") up = !up;
  });
  words.push(`${up ? "more" : "less"} ${lowerFirst(text.get(nodeIds[0]) ?? "")}`);
  const sentence = words.join(" → ");
  const tail =
    found.kind === "reinforcing"
      ? "each turn adds to the last (reinforcing)"
      : "each turn holds it back (balancing)";
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}: ${tail}.`;
}

/** The loop's things in loop order, by their words, from the one earliest in the list. */
export function loopPath(loop: RootCauseLoop, found: FoundLoop): string[] {
  const text = new Map(loop.nodes.map((n) => [n.id, n.text]));
  return fromListStart(loop, found).nodeIds.map((id) => text.get(id) ?? id);
}

/**
 * The thing in the most loops: where acting may change the most. Ties go to
 * the one more arrows lead into, then to the list's order. Null with fewer
 * than two loops (one loop has no "busiest" thing).
 */
export function busiestNode(
  loop: RootCauseLoop | undefined,
  found: LoopsFound = findLoops(loop)
): RootCauseLoopNode | null {
  if (!loop || found.loops.length < 2) return null;
  let best: { node: RootCauseLoopNode; loops: number; into: number } | null = null;
  for (const node of loop.nodes) {
    const loops = found.loops.filter((l) => l.nodeIds.includes(node.id)).length;
    if (loops === 0) continue;
    const into = loop.links.filter((l) => l.to === node.id).length;
    if (!best || loops > best.loops || (loops === best.loops && into > best.into)) {
      best = { node, loops, into };
    }
  }
  return best?.node ?? null;
}

/* ── Changes (pure: each returns the next analysis, or why it can't) ── */

export type LoopNodeRefusal = "blank" | "loop_full" | "duplicate" | "too_big";
export type LoopLinkRefusal = "unknown_node" | "self_link" | "duplicate" | "links_full" | "too_big";
export type LoopNameRefusal = "unknown_loop" | "names_full" | "too_big";

export type LoopChange<R extends string> =
  | { ok: true; analysis: RootCauseAnalysis }
  | { ok: false; reason: R };

/** What the page says when a change is refused. */
export const LOOP_REFUSAL_TEXT: Record<
  LoopNodeRefusal | LoopLinkRefusal | LoopNameRefusal | "not_found",
  string
> = {
  blank: "Write the thing that goes up or down.",
  loop_full: `The loop holds ${TOOL_LIST_MAX.loopNodes} things, the most it can. Delete one to add another.`,
  duplicate: "That's on the loop already.",
  unknown_node: "Pick two things on the loop.",
  self_link: "An arrow goes from one thing to another.",
  links_full: `The loop holds ${TOOL_LIST_MAX.loopLinks} arrows, the most it can. Delete one to add another.`,
  unknown_loop: "That loop isn't there any more.",
  names_full: `The loop keeps ${TOOL_LIST_MAX.loopNames} names at most. Clear one to name another.`,
  too_big: "This analysis is too big to save. Shorten or remove some lines. Nothing was saved.",
  not_found: "That analysis isn't there any more.",
};

const touched = (a: RootCauseAnalysis, loop: RootCauseLoop, now: string): RootCauseAnalysis => ({
  ...a,
  loop,
  updatedAt: now,
});

/** The analysis fits its row (ENTITY_ROW_MAX_BYTES of UTF-8 JSON). */
export function analysisFitsRow(a: RootCauseAnalysis): boolean {
  return jsonBytes(a) <= ENTITY_ROW_MAX_BYTES;
}

function checked<R extends string>(next: RootCauseAnalysis): LoopChange<R | "too_big"> {
  return analysisFitsRow(next) ? { ok: true, analysis: next } : { ok: false, reason: "too_big" };
}

const sameText = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Whether `text` is on the loop already, whatever its case (`except` aside). */
export function loopHasText(loop: RootCauseLoop, text: string, except?: string): boolean {
  const clean = loopLine(text, LOOP_TEXT_MAX.node);
  return loop.nodes.some((n) => n.id !== except && sameText(n.text, clean));
}

/** A new thing's words checked: words, room on the loop, not on it already. */
export function loopNodeProblem(
  loop: RootCauseLoop,
  text: string
): Exclude<LoopNodeRefusal, "too_big"> | null {
  if (!loopLine(text, LOOP_TEXT_MAX.node)) return "blank";
  if (loop.nodes.length >= TOOL_LIST_MAX.loopNodes) return "loop_full";
  if (loopHasText(loop, text)) return "duplicate";
  return null;
}

/** A thing added to the loop (the page and `add_loop_node` share this rule). */
export function withLoopNode(
  a: RootCauseAnalysis,
  text: string,
  id: string,
  now: string
): LoopChange<LoopNodeRefusal> {
  const loop = loopOf(a);
  const problem = loopNodeProblem(loop, text);
  if (problem) return { ok: false, reason: problem };
  const node = { id, text: loopLine(text, LOOP_TEXT_MAX.node) };
  return checked(touched(a, { ...loop, nodes: [...loop.nodes, node] }, now));
}

/** A thing's words changed in place: refused blank, gone, or another thing's words. */
export function withLoopNodeText(
  a: RootCauseAnalysis,
  nodeId: string,
  text: string,
  now: string
): LoopChange<"blank" | "duplicate" | "not_found" | "too_big"> {
  const loop = loopOf(a);
  const clean = loopLine(text, LOOP_TEXT_MAX.node);
  if (!clean) return { ok: false, reason: "blank" };
  if (!loop.nodes.some((n) => n.id === nodeId)) return { ok: false, reason: "not_found" };
  if (loopHasText(loop, clean, nodeId)) return { ok: false, reason: "duplicate" };
  return checked(
    touched(
      a,
      { ...loop, nodes: loop.nodes.map((n) => (n.id === nodeId ? { ...n, text: clean } : n)) },
      now
    )
  );
}

/** A thing moved one place earlier (-1) or later (1) in the list; null at an end. */
export function withLoopNodeMoved(
  a: RootCauseAnalysis,
  nodeId: string,
  by: -1 | 1,
  now: string
): RootCauseAnalysis | null {
  const loop = loopOf(a);
  const at = loop.nodes.findIndex((n) => n.id === nodeId);
  const to = at + by;
  if (at < 0 || to < 0 || to >= loop.nodes.length) return null;
  const nodes = [...loop.nodes];
  [nodes[at], nodes[to]] = [nodes[to], nodes[at]];
  return touched(a, { ...loop, nodes }, now);
}

/** What a delete took away, for Undo to put back where it was. */
export interface LoopRemoved {
  node?: { node: RootCauseLoopNode; at: number };
  links: { link: RootCauseLoopLink; at: number }[];
  names: RootCauseLoopName[];
}

/** The names of the loops `broken` (by key), and the rest. */
function splitNames(loop: RootCauseLoop, broken: ReadonlySet<string>) {
  const names = loop.names ?? [];
  return {
    kept: names.filter((n) => !broken.has(n.key)),
    dropped: names.filter((n) => broken.has(n.key)),
  };
}

/** The loop with `names`; a loop that had no names and keeps none stays without the field. */
const withNames = (loop: RootCauseLoop, names: RootCauseLoopName[]): RootCauseLoop => {
  const next: RootCauseLoop = { ...loop, names };
  if (names.length === 0 && !loop.names) delete next.names;
  return next;
};

/**
 * A thing taken off the loop, with its arrows and the names of the loops it
 * was on; null when it isn't there. `removed` is what Undo puts back.
 */
export function withoutLoopNode(
  a: RootCauseAnalysis,
  nodeId: string,
  now: string
): { analysis: RootCauseAnalysis; removed: LoopRemoved } | null {
  const loop = loopOf(a);
  const at = loop.nodes.findIndex((n) => n.id === nodeId);
  if (at < 0) return null;
  const broken = new Set(loopsThrough(findLoops(loop), nodeId).map((l) => l.key));
  const links = loop.links.flatMap((link, i) =>
    link.from === nodeId || link.to === nodeId ? [{ link, at: i }] : []
  );
  const { kept, dropped } = splitNames(loop, broken);
  const next = withNames(
    {
      nodes: loop.nodes.filter((n) => n.id !== nodeId),
      links: loop.links.filter((l) => l.from !== nodeId && l.to !== nodeId),
    },
    kept
  );
  return {
    analysis: touched(a, next, now),
    removed: { node: { node: loop.nodes[at], at }, links, names: dropped },
  };
}

/** An arrow taken away, with the names of the loops it closed; null when it isn't there. */
export function withoutLoopLink(
  a: RootCauseAnalysis,
  linkId: string,
  now: string
): { analysis: RootCauseAnalysis; removed: LoopRemoved } | null {
  const loop = loopOf(a);
  const at = loop.links.findIndex((l) => l.id === linkId);
  if (at < 0) return null;
  const broken = new Set(loopsUsing(findLoops(loop), linkId).map((l) => l.key));
  const { kept, dropped } = splitNames(loop, broken);
  const next = withNames({ ...loop, links: loop.links.filter((l) => l.id !== linkId) }, kept);
  return {
    analysis: touched(a, next, now),
    removed: { links: [{ link: loop.links[at], at }], names: dropped },
  };
}

/**
 * Undo of a delete: the thing, its arrows and its loops' names back in
 * their places. What came since stays; an arrow whose ends are gone, or
 * that's there again, and a name past the cap or there again, stay out.
 * Null when there's nothing to put back.
 */
export function withLoopRestored(
  a: RootCauseAnalysis,
  removed: LoopRemoved,
  now: string
): RootCauseAnalysis | null {
  const loop = loopOf(a);
  const nodes = [...loop.nodes];
  const back = removed.node;
  if (back) {
    if (nodes.some((n) => n.id === back.node.id)) return null;
    if (nodes.length >= TOOL_LIST_MAX.loopNodes) return null;
    nodes.splice(Math.min(back.at, nodes.length), 0, back.node);
  }
  const ids = new Set(nodes.map((n) => n.id));
  const links = [...loop.links];
  for (const { link, at } of removed.links) {
    if (links.length >= TOOL_LIST_MAX.loopLinks) break;
    if (!ids.has(link.from) || !ids.has(link.to)) continue;
    if (links.some((l) => l.id === link.id || (l.from === link.from && l.to === link.to))) continue;
    links.splice(Math.min(at, links.length), 0, link);
  }
  const names = [...(loop.names ?? [])];
  for (const n of removed.names) {
    if (names.length >= TOOL_LIST_MAX.loopNames) break;
    if (!names.some((x) => x.key === n.key)) names.push(n);
  }
  return touched(a, withNames({ nodes, links }, names), now);
}

export interface NewLoopLink {
  from: string;
  to: string;
  polarity: LoopPolarity;
  delay?: boolean;
}

/** A new arrow checked: two different things on the loop, not drawn yet, room for it. */
export function loopLinkProblem(
  loop: RootCauseLoop,
  link: Pick<NewLoopLink, "from" | "to">
): Exclude<LoopLinkRefusal, "too_big"> | null {
  const ids = new Set(loop.nodes.map((n) => n.id));
  if (!ids.has(link.from) || !ids.has(link.to)) return "unknown_node";
  if (link.from === link.to) return "self_link";
  if (loop.links.some((l) => l.from === link.from && l.to === link.to)) return "duplicate";
  if (loop.links.length >= TOOL_LIST_MAX.loopLinks) return "links_full";
  return null;
}

/** An arrow added (the page, Amr's suggestions and `add_loop_link` share this rule). */
export function withLoopLink(
  a: RootCauseAnalysis,
  link: NewLoopLink,
  id: string,
  now: string
): LoopChange<LoopLinkRefusal> {
  const loop = loopOf(a);
  const problem = loopLinkProblem(loop, link);
  if (problem) return { ok: false, reason: problem };
  const next: RootCauseLoopLink = {
    id,
    from: link.from,
    to: link.to,
    polarity: isPolarity(link.polarity) ? link.polarity : "same",
    ...(link.delay === true ? { delay: true } : {}),
  };
  return checked(touched(a, { ...loop, links: [...loop.links, next] }, now));
}

/** An arrow's sign or delay changed; null when it isn't there. */
export function withLoopLinkPatch(
  a: RootCauseAnalysis,
  linkId: string,
  patch: { polarity?: LoopPolarity; delay?: boolean },
  now: string
): RootCauseAnalysis | null {
  const loop = loopOf(a);
  if (!loop.links.some((l) => l.id === linkId)) return null;
  const links = loop.links.map((l) => {
    if (l.id !== linkId) return l;
    const next: RootCauseLoopLink = {
      ...l,
      ...(patch.polarity && isPolarity(patch.polarity) ? { polarity: patch.polarity } : {}),
    };
    if (patch.delay === true) next.delay = true;
    else if (patch.delay === false) delete next.delay;
    return next;
  });
  return touched(a, { ...loop, links }, now);
}

/**
 * A loop named (blank clears its name). Names of loops that are gone are
 * dropped first, so leftovers never block a new name at the cap.
 */
export function withLoopName(
  a: RootCauseAnalysis,
  key: string,
  name: string,
  now: string
): LoopChange<LoopNameRefusal> {
  const loop = loopOf(a);
  const found = findLoops(loop);
  if (!found.loops.some((l) => l.key === key)) return { ok: false, reason: "unknown_loop" };
  const live = new Set(found.loops.map((l) => l.key));
  const rest = (loop.names ?? []).filter((n) => live.has(n.key) && n.key !== key);
  const clean = loopLine(name, LOOP_TEXT_MAX.name);
  if (clean && rest.length >= TOOL_LIST_MAX.loopNames) return { ok: false, reason: "names_full" };
  const names = clean ? [...rest, { key, name: clean }] : rest;
  return checked(touched(a, { ...loop, names }, now));
}

/* ── Laying it out ─────────────────────────────────────────────────── */

/** The diagram's drawing box. */
export const LOOP_VIEWBOX = { width: 360, height: 360 } as const;
/** A thing's box on the diagram. */
export const LOOP_NODE_BOX = { width: 104, height: 40 } as const;

export interface LoopPoint {
  id: string;
  /** The centre of the thing's box. */
  x: number;
  y: number;
}

/**
 * The things on a circle in list order, the first at the top, going
 * clockwise; every box stays inside LOOP_VIEWBOX.
 */
export function loopLayout(nodes: readonly Pick<RootCauseLoopNode, "id">[]): LoopPoint[] {
  const { width, height } = LOOP_VIEWBOX;
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(cx - LOOP_NODE_BOX.width / 2, cy - LOOP_NODE_BOX.height / 2) - 4;
  if (nodes.length === 1) return [{ id: nodes[0].id, x: cx, y: cy }];
  return nodes.map((n, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / nodes.length;
    return {
      id: n.id,
      x: Math.round((cx + r * Math.cos(angle)) * 10) / 10,
      y: Math.round((cy + r * Math.sin(angle)) * 10) / 10,
    };
  });
}
