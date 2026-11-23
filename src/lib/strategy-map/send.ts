/**
 * What a strategy map hands to another tool: a deliverable to the backlog
 * or the roadmap, an impact or a bet to the Hypothesis Tracker, a tree's
 * initiative or priority to the roadmap. Hand-off sources only: nothing
 * here imports a route or the store, so Amr's verbs build the very same
 * items on the MCP server. Pure.
 */

import type { HandoffSource } from "@/lib/handoffs/types";
import type { StrategyMap, StrategyMapNode } from "@/lib/stores/workspace-types";
import { believeLine } from "@/lib/hypotheses/model";
import { levelSends, type StrategySendRoute } from "./formats";
import { childrenOf, nodeTitle, pathOf } from "./model";
import { asClause } from "./ideas";

/** A hand-off description's cap (the epic route's, the widest any target keeps). */
const DESCRIPTION_MAX = 2000;

const cut = (s: string, max = DESCRIPTION_MAX) => (s.length > max ? s.slice(0, max).trimEnd() : s);
const text = (n: StrategyMapNode | undefined) => (n?.text ?? "").replace(/\s+/g, " ").trim();
const live = (n: StrategyMapNode) => n.status !== "dropped";

/** An impact map's deliverable, for the backlog or the roadmap. */
export function deliverableSource(map: StrategyMap, node: StrategyMapNode): HandoffSource {
  const [goal, actor, impact] = pathOf(map, node);
  const parts = [
    actor && impact && actor !== node && impact !== node
      ? `For ${text(actor)}: ${text(impact)}.`
      : "",
    goal && goal !== node
      ? `Goal: ${text(goal)}${goal.measure?.trim() ? ` (${goal.measure.trim()})` : ""}`
      : "",
  ].filter(Boolean);
  const description = cut(parts.join(" "));
  return {
    title: text(node),
    ...(description ? { description } : {}),
    sourceRef: { tool: "impact-map", id: node.id, doc: map.id },
  };
}

/**
 * An impact to test: we believe its deliverables will lead the actor to
 * change (or that the actor will, when it has none), to learn whether
 * they really do, measured by the goal's measure.
 */
export function impactHypothesisSource(map: StrategyMap, impact: StrategyMapNode): HandoffSource {
  const [goal, actor] = pathOf(map, impact);
  const who = actor && actor !== impact ? text(actor) : "they";
  const what = asClause(text(impact));
  const deliverables = childrenOf(map, impact.id).map(text).filter(Boolean);
  const title =
    deliverables.length > 0
      ? believeLine(`${deliverables.join(" and ")} will lead ${who} to ${what}`)
      : believeLine(`${who} will ${what}`);
  const measure = goal && goal !== impact ? (goal.measure ?? "").trim() : "";
  return {
    title,
    description: `Whether ${who} really changes: ${text(impact)}`,
    hypothesis: {
      ...(deliverables.length > 0 ? { willDo: deliverables.join("; ") } : {}),
      ...(measure ? { successMetric: measure } : {}),
    },
    sourceRef: { tool: "impact-map", id: impact.id, doc: map.id },
  };
}

/**
 * A strategy tree's bet to test: a DIBB bet (we believe the belief above
 * it, the bet is what we'll do), a Lean Value Tree bet (we believe it,
 * its initiatives are what we'll do) or initiative (we believe the bet
 * above it, the initiative is what we'll do).
 */
export function betHypothesisSource(map: StrategyMap, node: StrategyMapNode): HandoffSource {
  const path = pathOf(map, node);
  const parent = path.length >= 2 ? path[path.length - 2] : undefined;
  const measureOf = (n: StrategyMapNode | undefined) => (n?.measure ?? "").trim();
  const sourceRef = { tool: "strategy-tree", id: node.id, doc: map.id };
  if (map.format === "dibb") {
    const data = path[0] !== node ? path[0] : undefined;
    const measure = measureOf(node);
    return {
      title: believeLine(text(parent) || text(node)),
      description: cut(
        `Whether “${text(node)}” changes what the data showed${data ? `: ${text(data)}` : ""}`
      ),
      hypothesis: { willDo: text(node), ...(measure ? { successMetric: measure } : {}) },
      sourceRef,
    };
  }
  // A Lean Value Tree: a bet at level 2, an initiative at level 3.
  const bet = node.level === 2 ? node : parent;
  const goal = bet ? pathOf(map, bet).find((n) => n.level === 1) : undefined;
  const willDo =
    node.level === 2
      ? childrenOf(map, node.id).filter(live).map(text).filter(Boolean).join("; ")
      : text(node);
  const measure = measureOf(node) || measureOf(node.level === 2 ? goal : bet);
  return {
    title: believeLine(text(bet) || text(node)),
    description: cut(`Whether it moves the goal${goal ? `: ${text(goal)}` : ""}`),
    hypothesis: {
      ...(willDo ? { willDo } : {}),
      ...(measure ? { successMetric: measure } : {}),
    },
    sourceRef,
  };
}

/** A strategy tree's initiative or improvement priority, for the roadmap. */
export function treeItemSource(map: StrategyMap, node: StrategyMapNode): HandoffSource {
  const above = pathOf(map, node)
    .filter((n) => n !== node)
    .map((n) => nodeTitle(n, map.format));
  const owner = (node.owner ?? "").trim();
  return {
    title: text(node),
    ...(above.length > 0 ? { description: cut(`Part of: ${above.join(" → ")}`) } : {}),
    ...(owner ? { owner } : {}),
    sourceRef: { tool: "strategy-tree", id: node.id, doc: map.id },
  };
}

/**
 * What sending `node` on `route` hands over, or null when its level can't
 * go there (lib/strategy-map/formats levelSends) or it is dropped.
 */
export function strategySource(
  map: StrategyMap,
  node: StrategyMapNode,
  route: StrategySendRoute
): HandoffSource | null {
  if (!levelSends(map.format, node.level, route) || !live(node)) return null;
  if (map.format === "impact-map") {
    return route === "hypothesis"
      ? impactHypothesisSource(map, node)
      : deliverableSource(map, node);
  }
  return route === "hypothesis" ? betHypothesisSource(map, node) : treeItemSource(map, node);
}
