/**
 * Blocker clusters: the usual reasons work gets stuck, so blocked spells and
 * impediments can be grouped and the biggest cause found. Each cluster sits
 * inside the team (it can fix it itself) or outside it (it needs someone
 * else). Pure, so the Impediments page, the Kanban board and their agent
 * actions share one list. The default list only; the keyword rules that
 * suggest a cluster from a blocker's words come with Flow Insights.
 */

import type { BlockSide } from "@/lib/stores/workspace-types";

/** A cluster's name (our words) and whether it sits inside the team or outside it. */
export interface BlockerCluster {
  label: string;
  side: BlockSide;
}

/** The clusters offered before a team names its own: inside the team first, then outside it. */
export const DEFAULT_BLOCKER_CLUSTERS: readonly BlockerCluster[] = [
  { label: "Waiting for a review", side: "internal" },
  { label: "Unclear or changing requirement", side: "internal" },
  { label: "Test or build environment", side: "internal" },
  { label: "Bug found on the way", side: "internal" },
  { label: "Only one person knows how", side: "internal" },
  { label: "Pulled onto other work", side: "internal" },
  { label: "Another team", side: "external" },
  { label: "A decision or approval", side: "external" },
  { label: "An answer from a customer or stakeholder", side: "external" },
  { label: "A vendor or outside service", side: "external" },
  { label: "Access or permissions", side: "external" },
  { label: "Infrastructure or operations", side: "external" },
];

/** A label compared without case or extra spaces. */
function labelKey(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

const SIDE_BY_LABEL: ReadonlyMap<string, BlockSide> = new Map(
  DEFAULT_BLOCKER_CLUSTERS.map((c) => [labelKey(c.label), c.side])
);

/**
 * The side of a default cluster, by its label (case and extra spaces
 * ignored), or null for a label that isn't one of them, such as a cluster
 * the team named itself.
 */
export function defaultClusterSide(label: string | null | undefined): BlockSide | null {
  if (typeof label !== "string") return null;
  return SIDE_BY_LABEL.get(labelKey(label)) ?? null;
}
