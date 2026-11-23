/**
 * A draft (Amr's, or the template without AI) as the nodes it adds to a
 * map: an impact map's actor branch, a strategy tree's branch. The model
 * never supplies ids or persona links: the ids are made here, and an actor
 * links a persona only when its name matches one exactly (any case).
 * Adding stops at the map's node cap, and says how many parts were left
 * out. Pure.
 */

import type {
  Persona,
  StrategyMap,
  StrategyMapFormat,
  StrategyMapNode,
} from "@/lib/stores/workspace-types";
import { hasStatus, levelHas } from "./formats";
import { NODE_FIELD_MAX, NODE_TEXT_MAX, STRATEGY_NODES_MAX, cleanText } from "./model";

/** An actor branch as the impact map's draft holds it. */
export interface ActorDraft {
  name: string;
  persona?: string;
  impacts: readonly { text: string; deliverables: readonly string[] }[];
}

/** A part of a strategy tree's draft, with the parts under it. */
export interface PartDraft {
  text: string;
  measure?: string;
  children?: readonly PartDraft[];
}

const key = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** The persona whose name is exactly `name` (any case, any spacing), if any. */
export function personaNamed(
  personas: readonly Pick<Persona, "id" | "name">[],
  name: string | undefined
): Pick<Persona, "id" | "name"> | undefined {
  if (!name?.trim()) return undefined;
  return personas.find((p) => key(p.name) === key(name));
}

/** An actor branch's nodes under the root: the actor, its impacts and their deliverables. */
export function actorDraftNodes(
  draft: ActorDraft,
  rootId: string,
  personas: readonly Pick<Persona, "id" | "name">[],
  makeId: () => string
): StrategyMapNode[] {
  const persona = personaNamed(personas, draft.persona) ?? personaNamed(personas, draft.name);
  const actor: StrategyMapNode = {
    id: makeId(),
    parentId: rootId,
    level: 1,
    text: cleanText(draft.name, NODE_TEXT_MAX) || "Untitled actor",
    ...(persona ? { personaId: persona.id } : {}),
  };
  const out = [actor];
  for (const i of draft.impacts) {
    const impact: StrategyMapNode = {
      id: makeId(),
      parentId: actor.id,
      level: 2,
      text: cleanText(i.text, NODE_TEXT_MAX) || "Untitled impact",
    };
    out.push(impact);
    for (const d of i.deliverables) {
      const t = cleanText(d, NODE_TEXT_MAX);
      if (t) out.push({ id: makeId(), parentId: impact.id, level: 3, text: t });
    }
  }
  return out;
}

/** A strategy tree branch's nodes under the root, each "proposed", with a measure where its level has one. */
export function partDraftNodes(
  draft: PartDraft,
  rootId: string,
  format: StrategyMapFormat,
  makeId: () => string
): StrategyMapNode[] {
  const out: StrategyMapNode[] = [];
  const add = (p: PartDraft, parentId: string, level: 1 | 2 | 3) => {
    const measure = cleanText(p.measure, NODE_FIELD_MAX);
    const node: StrategyMapNode = {
      id: makeId(),
      parentId,
      level,
      text: cleanText(p.text, NODE_TEXT_MAX) || "Untitled part",
      ...(measure && levelHas(format, level, "measure") ? { measure } : {}),
      ...(hasStatus(format) ? { status: "proposed" as const } : {}),
    };
    out.push(node);
    if (level < 3) for (const c of p.children ?? []) add(c, node.id, (level + 1) as 2 | 3);
  };
  add(draft, rootId, 1);
  return out;
}

/**
 * The draft's nodes that fit `map`: in order, while the map has room
 * under STRATEGY_NODES_MAX, never a node whose parent was left out.
 */
export function fitDraftNodes(
  map: Pick<StrategyMap, "nodes">,
  nodes: readonly StrategyMapNode[]
): { nodes: StrategyMapNode[]; left: number } {
  const room = Math.max(0, STRATEGY_NODES_MAX - map.nodes.length);
  const have = new Set(map.nodes.map((n) => n.id));
  const kept: StrategyMapNode[] = [];
  for (const n of nodes) {
    if (kept.length >= room) break;
    if (n.parentId !== null && !have.has(n.parentId)) continue;
    kept.push(n);
    have.add(n.id);
  }
  return { nodes: kept, left: nodes.length - kept.length };
}
