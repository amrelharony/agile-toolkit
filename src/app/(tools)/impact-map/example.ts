/**
 * Impact Map's example: a meal-kit app that wants more repeat orders, in
 * our own words (nothing from the Impact Mapping book). Every id is an
 * example id, so "Clear example" removes exactly this map. No actor links
 * a persona, so loading and clearing it stays inside the tool's own data.
 */

import type { StrategyMap, StrategyMapNode } from "@/lib/stores/workspace-types";
import { exampleId } from "@/lib/utils/example-id";

/** The example's map id. */
export const EXAMPLE_MAP_ID = exampleId("impact-map");

/** The end of June after `now` (this year's, before July). */
function nextJune(now: Date): string {
  const year = now.getMonth() < 6 ? now.getFullYear() : now.getFullYear() + 1;
  return `${year}-06-30`;
}

export function buildExample(now = new Date()): StrategyMap {
  const at = now.toISOString();
  const id = (k: string) => exampleId(`im-${k}`);
  const node = (
    k: string,
    parent: string | null,
    level: StrategyMapNode["level"],
    text: string,
    extra: Partial<StrategyMapNode> = {}
  ): StrategyMapNode => ({
    id: id(k),
    parentId: parent === null ? null : id(parent),
    level,
    text,
    ...extra,
  });
  return {
    id: EXAMPLE_MAP_ID,
    format: "impact-map",
    title: "Grow repeat orders by 20% by June",
    targetDate: nextJune(now),
    nodes: [
      node("goal", null, 0, "Grow repeat orders by 20% by June", {
        measure: "Share of customers who order again within 30 days",
      }),
      node("parents", "goal", 1, "Busy parents"),
      node("skip", "parents", 2, "Skip a week instead of cancelling", { focus: true }),
      node("pause", "skip", 3, "Pause instead of cancel"),
      node("reminder", "skip", 3, "Reminder before the order cut-off"),
      node("reorder", "parents", 2, "Reorder a favourite box in two taps"),
      node("favourites", "reorder", 3, "Favourites on the home screen"),
      node("office", "goal", 1, "Office lunch buyers"),
      node("friday", "office", 2, "Order for the whole team every Friday"),
      node("team-link", "friday", 3, "A team order link to share"),
      node("drivers", "goal", 1, "Delivery partners"),
      node("cool", "drivers", 2, "Leave boxes in a cool spot more often"),
      node("safe-spot", "cool", 3, "The customer's safe spot on the delivery note"),
      node("support", "goal", 1, "Customer support"),
      node("offer", "support", 2, "Offer a skip before a cancel"),
      node("script", "offer", 3, "A short guide for cancel calls"),
    ],
    createdAt: at,
    updatedAt: at,
  };
}
