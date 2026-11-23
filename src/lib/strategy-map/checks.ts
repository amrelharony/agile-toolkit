/**
 * What a strategy map is still missing, as plain questions: the no-AI
 * "gaps" list both pages show (Impact Map, Strategy Tree) and Amr's
 * list_state reports. Our own wording. Pure.
 */

import type { Hypothesis, StrategyMap, StrategyMapNode } from "@/lib/stores/workspace-types";
import { linkedTest } from "@/lib/hypotheses/model";
import { LAST_LEVEL, betLevel, levelOf } from "./formats";
import { childrenOf, nodeTitle } from "./model";

export interface MapCheck {
  /** Stable for a key: the kind of check and the node. */
  id: string;
  /** The node it is about, when there is one. */
  nodeId?: string;
  text: string;
}

/** Words an impact starts with when it is really a feature to build. */
const FEATURE_START = /^(?:build|implement|launch|ship|integrate|a new)\b/i;

/** Whether an impact's text reads like something to build, not a change in behaviour. */
export function readsLikeFeature(text: string): boolean {
  return FEATURE_START.test(text.trim());
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The map's open checks, in the tree's order:
 *   - a level's asked-for measure or owner is missing;
 *   - a node that can hold others has nothing under it;
 *   - an impact reads like a feature ("what will <actor> do differently?");
 *   - two or more impacts and no focus;
 *   - Hoshin parts still proposed or with questions (the catchball);
 *   - a DIBB or Lean Value Tree bet not tested yet.
 * A dropped part is never asked about.
 */
export function mapChecks(
  map: StrategyMap,
  hypotheses: readonly Pick<Hypothesis, "id" | "status">[] = []
): MapCheck[] {
  const checks: MapCheck[] = [];
  const live = (n: StrategyMapNode) => n.status !== "dropped";
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  const title = (n: StrategyMapNode) => nodeTitle(n, map.format);

  for (const n of map.nodes) {
    if (!live(n)) continue;
    const lvl = levelOf(map.format, n.level);
    const missing = lvl.required.filter((f) => !(n[f] ?? "").trim());
    if (missing.length > 0) {
      checks.push({
        id: `missing:${n.id}`,
        nodeId: n.id,
        text: `“${title(n)}” needs ${missing.map((f) => (f === "measure" ? "a measure" : "an owner")).join(" and ")}.`,
      });
    }
    if (n.level < LAST_LEVEL && !childrenOf(map, n.id).some(live)) {
      const next = levelOf(map.format, n.level + 1);
      checks.push({
        id: `empty:${n.id}`,
        nodeId: n.id,
        text: `“${title(n)}” has no ${next.plural} yet.`,
      });
    }
    if (map.format === "impact-map" && n.level === 2 && readsLikeFeature(n.text)) {
      const actor = n.parentId ? byId.get(n.parentId) : undefined;
      checks.push({
        id: `feature:${n.id}`,
        nodeId: n.id,
        text: `“${title(n)}” reads like a feature: what will ${actor ? title(actor) : "they"} do differently?`,
      });
    }
  }

  if (map.format === "impact-map") {
    const impacts = map.nodes.filter((n) => n.level === 2);
    if (impacts.length >= 2 && !impacts.some((n) => n.focus)) {
      checks.push({ id: "focus", text: "Pick the impact to work on first." });
    }
  }

  if (map.format === "hoshin") {
    const proposed = map.nodes.filter((n) => n.status === "proposed" || !n.status).length;
    const questioned = map.nodes.filter((n) => n.status === "questioned").length;
    if (proposed + questioned > 0) {
      const parts = [
        proposed > 0 ? `${plural(proposed, "part is", "parts are")} still proposed` : "",
        questioned > 0 ? `${plural(questioned, "part has", "parts have")} questions` : "",
      ].filter(Boolean);
      checks.push({
        id: "catchball",
        text: `${parts.join(" and ")}: settle them in the catchball.`,
      });
    }
  }

  const bets = betLevel(map.format);
  if (bets !== null) {
    for (const n of map.nodes) {
      if (n.level !== bets || !live(n)) continue;
      if (linkedTest(n.sentTo, hypotheses).state === "none") {
        checks.push({
          id: `untested:${n.id}`,
          nodeId: n.id,
          text: `“${title(n)}” isn't tested yet.`,
        });
      }
    }
  }
  return checks;
}
