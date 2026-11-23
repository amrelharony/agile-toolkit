/**
 * Blocker clusters: the usual reasons work gets stuck, so blocked spells and
 * impediments can be grouped and the biggest cause found. Each cluster sits
 * inside the team (it can fix it itself) or outside it (it needs someone
 * else). Pure, so the Impediments page, the Kanban board and their agent
 * actions share one list, and the keyword rules (`clusterFor`) that suggest
 * a cluster from a blocker's words.
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

/* ── Keyword rules (Flow Insights and Impediments, tools plan phase 2) ── */

/**
 * The words that suggest each default cluster, tried in this order (the
 * more particular first: "the security team signs off" is an approval
 * before it is another team). Our own words; a suggestion only, never a
 * write: the person picks the cluster.
 */
export const CLUSTER_RULES: readonly { label: string; words: RegExp }[] = [
  {
    label: "Access or permissions",
    words:
      /\b(access|permissions?|credentials?|log ?ins?|accounts?|vpn|passwords?|licen[cs]es?)\b/i,
  },
  {
    label: "A vendor or outside service",
    words: /\b(vendors?|suppliers?|third[- ]party|provider|saas|external (api|service))\b/i,
  },
  {
    label: "An answer from a customer or stakeholder",
    words: /\b(customers?|clients?|stakeholders?)\b/i,
  },
  {
    label: "A decision or approval",
    words: /\b(decisions?|decide|approv\w*|sign[- ]?offs?|signs off|signed off|go[- ]ahead)\b/i,
  },
  {
    label: "Another team",
    words:
      /\b(another team|other teams?|(platform|security|design|data|ops|qa|legal|infra) team|dependency on|hand-?off from)\b/i,
  },
  {
    label: "Waiting for a review",
    words: /\b(reviews?|reviewers?|pull requests?|merge requests?|prs?)\b/i,
  },
  {
    label: "Test or build environment",
    words: /\b(environments?|staging|ci|pipelines?|builds?|test (server|data|env)|flaky)\b/i,
  },
  {
    label: "Infrastructure or operations",
    words:
      /\b(infrastructure|infra|servers?|database|outages?|network|deploy\w*|production|hosting)\b/i,
  },
  {
    label: "Unclear or changing requirement",
    words:
      /\b(unclear|requirements?|acceptance criteria|scope|specs?|clarif\w*|changed (our|the|their) mind)\b/i,
  },
  {
    label: "Only one person knows how",
    words: /\b(only one|knowledge|bus factor|expert|on leave|off sick|on holiday|out of office)\b/i,
  },
  {
    label: "Pulled onto other work",
    words:
      /\b(pulled|interrupt\w*|firefight\w*|support (tickets?|calls?)|other (work|project)|urgent request)\b/i,
  },
  {
    label: "Bug found on the way",
    words: /\b(bugs?|defects?|broken|regressions?|crash\w*)\b/i,
  },
];

/**
 * The default cluster a blocker's words suggest (its title, description or
 * cause), by `CLUSTER_RULES` in order, or null when none fits.
 */
export function clusterFor(text: string | null | undefined): string | null {
  if (typeof text !== "string" || !text.trim()) return null;
  return CLUSTER_RULES.find((r) => r.words.test(text))?.label ?? null;
}
