/**
 * Impediments' AI task, the lite half pages import (no zod; the def, with
 * its schemas, is `impediments.ts` and loads on first AI use): the caps,
 * the clustering without AI, `fitClusterInput`, reading an answer against
 * the blockers sent, and the ref.
 */

import { lazyAiTask } from "../task-ref";
import { TOOL_AI_BODY_BUDGET } from "../contract";
import { cleanThemes } from "./audience-wall.lite";
import { cutText } from "@/lib/utils/cut-text";
import { jsonBytes } from "@/lib/utils/json-bytes";
import { keywordGroups } from "@/lib/audience-wall/words";
import { clusterFor, clusterKey, defaultClusterSide } from "@/lib/impediments/clusters";
import { BLOCKER_CLUSTER_MAX, type BlockSide } from "@/lib/stores/workspace-types";
import type { ClusterBlockersInput, ClusterBlockersOutput, BlockerCluster } from "./impediments";
export type { ClusterBlockersInput, ClusterBlockersOutput, BlockerCluster } from "./impediments";

export const CLUSTER_BLOCKERS_MAX = 150;
/** Short ids ("b1" … "b150"): row ids never leave the browser. */
export const CLUSTER_ID_MAX = 8;
export const CLUSTER_TEXT_MAX = 200;
export const CLUSTER_KNOWN_MAX = 30;
export const CLUSTER_OUT_MAX = 10;
export const CLUSTER_NAME_MAX = BLOCKER_CLUSTER_MAX;

/** Where the blockers no rule or shared word could place go. */
export const OTHER_CLUSTER = "Other";

// Never half an emoji: a lone surrogate is refused by jsonb once a cluster is stored.
const cut = (s: string, max: number) => (s.length > max ? cutText(s, max).trimEnd() : s);

/**
 * Clusters without AI: the keyword rules first (`clusterFor`, a default
 * cluster each), then the rest grouped by a word they share (the Audience
 * Wall's `keywordGroups`), up to CLUSTER_OUT_MAX clusters in all; whatever
 * is left goes in "Other", inside the team. A blocker's own side wins, then
 * the default cluster's. With no blockers it throws (the schema refuses that
 * input).
 */
export function clusterBlockersFallback({ blockers }: ClusterBlockersInput): ClusterBlockersOutput {
  if (blockers.length === 0) throw new Error("There are no blockers to cluster.");
  const sideOf = new Map(blockers.map((b) => [b.id, b.side]));
  const byRule = new Map<string, string[]>();
  const rest: { id: string; text: string }[] = [];
  for (const b of blockers) {
    const label = clusterFor(b.text);
    if (label) byRule.set(label, [...(byRule.get(label) ?? []), b.id]);
    else rest.push({ id: b.id, text: b.text });
  }
  const candidates: { name: string; ids: string[]; side: BlockSide }[] = Array.from(
    byRule,
    ([name, ids]) => ({ name, ids, side: defaultClusterSide(name) ?? "internal" })
  ).sort((a, b) => b.ids.length - a.ids.length);
  const words = keywordGroups(rest, { maxGroups: CLUSTER_OUT_MAX });
  for (const g of words) {
    const outside = g.postIds.filter((id) => sideOf.get(id) === "external").length;
    candidates.push({
      name: cut(g.name, CLUSTER_NAME_MAX),
      ids: g.postIds,
      side: outside > g.postIds.length - outside ? "external" : "internal",
    });
  }
  const placed = new Set(candidates.flatMap((c) => c.ids));
  const left = blockers.filter((b) => !placed.has(b.id)).map((b) => b.id);
  // Room for "Other" when anything is left over, or when the candidates overflow.
  const overflow = candidates.length > CLUSTER_OUT_MAX;
  const keep = left.length > 0 || overflow ? CLUSTER_OUT_MAX - 1 : CLUSTER_OUT_MAX;
  const kept = candidates.slice(0, keep);
  const other = [...candidates.slice(keep).flatMap((c) => c.ids), ...left];
  const clusters: BlockerCluster[] = kept.map((c) => ({ name: c.name, side: c.side, ids: c.ids }));
  if (other.length > 0) clusters.push({ name: OTHER_CLUSTER, side: "internal", ids: other });
  return { clusters: cleanClusters(clusters, new Set(blockers.map((b) => b.id))) };
}

export const impedimentsClusterTask = lazyAiTask<ClusterBlockersInput, ClusterBlockersOutput>(
  { id: "impediments.cluster", toolId: "impediments", fallback: clusterBlockersFallback },
  () => import("./impediments").then((m) => m.impedimentsClusterTask)
);

/**
 * An answer's clusters against the blockers sent (the Audience Wall's
 * `cleanThemes`, with `ids` for its `postIds`): unknown ids dropped, each id
 * once, in its first cluster only, empty clusters gone. Two clusters with
 * one name (case and spacing aside) are one: the later one's ids join the
 * first, which keeps its name and side.
 */
export function cleanClusters(
  clusters: readonly BlockerCluster[],
  sent: ReadonlySet<string>
): BlockerCluster[] {
  const taken = new Set<string>();
  const out: BlockerCluster[] = [];
  const byKey = new Map<string, BlockerCluster>();
  for (const c of clusters) {
    // One cluster at a time, against the ids no earlier cluster took, so each keeps its side.
    const open = new Set(Array.from(sent).filter((id) => !taken.has(id)));
    const [theme] = cleanThemes([{ name: c.name, postIds: Array.from(new Set(c.ids)) }], open);
    if (!theme) continue;
    theme.postIds.forEach((id) => taken.add(id));
    const key = clusterKey(c.name);
    const same = key ? byKey.get(key) : undefined;
    if (same) {
      same.ids.push(...theme.postIds);
      continue;
    }
    const kept: BlockerCluster = { name: c.name, side: c.side, ids: theme.postIds };
    if (key) byKey.set(key, kept);
    out.push(kept);
  }
  return out;
}

/**
 * The input trimmed until its request (`{task, input}`) fits `budget`
 * bytes: blockers from the end (the page sends the newest first), keeping
 * at least one. The input as it is when it already fits. The page says how
 * many didn't fit.
 */
export function fitClusterInput(
  input: ClusterBlockersInput,
  budget: number = TOOL_AI_BODY_BUDGET
): ClusterBlockersInput {
  const size = (blockers: ClusterBlockersInput["blockers"]) =>
    jsonBytes({ task: "impediments.cluster", input: { ...input, blockers } });
  if (size(input.blockers) <= budget) return input;
  let lo = 1;
  let hi = input.blockers.length;
  // The longest prefix that fits, by halving (150 blockers at most).
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (size(input.blockers.slice(0, mid)) <= budget) lo = mid;
    else hi = mid - 1;
  }
  return { ...input, blockers: input.blockers.slice(0, lo) };
}
