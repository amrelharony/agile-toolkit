/**
 * Reading a stored causal loop safely, on its own so that `model.ts` (which
 * every page with the hand-off routes loads, through the root-cause target)
 * reads an analysis's loop without bringing in the loop finder, the changers
 * and the layout in `loops.ts`. `loops.ts` re-exports all of these.
 *
 * Pure: no store, no browser globals.
 */

import {
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

/** An id on the loop, as the CRUD takes it. */
export const LOOP_ID_MAX = 64;
/** A loop's key, as the CRUD takes it. */
export const LOOP_KEY_MAX = 1000;

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
