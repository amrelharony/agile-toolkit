/**
 * Impediments' AI task, the def: group blockers (impediments and the causes
 * of blocked stories and cards) into a few clusters, each inside the team or
 * outside it, so the Impediments page can show where the blocked time goes.
 * The person accepts a cluster at a time, and each accept writes the
 * cluster on its members with Undo; nothing is written by the answer itself.
 *
 * The page sends short ids ("b1" … "b150") and maps them back, so row ids
 * never leave the browser, and the clusters the team already uses
 * (`known`), so the answer reuses them. Without AI it clusters by the
 * keyword rules, then shared words (`clusterBlockersFallback` in
 * `impediments.lite.ts`, which pages import, with the caps and
 * `fitClusterInput`). The prompt lives in `impediments.server.ts`.
 */

import { z } from "zod";
import { defineAiTask } from "../define-task";
import { BLOCK_SIDES } from "@/lib/stores/workspace-types";
import {
  CLUSTER_BLOCKERS_MAX,
  CLUSTER_ID_MAX,
  CLUSTER_KNOWN_MAX,
  CLUSTER_NAME_MAX,
  CLUSTER_OUT_MAX,
  CLUSTER_TEXT_MAX,
  clusterBlockersFallback,
} from "./impediments.lite";

export {
  CLUSTER_BLOCKERS_MAX,
  CLUSTER_ID_MAX,
  CLUSTER_KNOWN_MAX,
  CLUSTER_NAME_MAX,
  CLUSTER_OUT_MAX,
  CLUSTER_TEXT_MAX,
  OTHER_CLUSTER,
  cleanClusters,
  clusterBlockersFallback,
  fitClusterInput,
} from "./impediments.lite";

const id = z.string().trim().min(1).max(CLUSTER_ID_MAX);
const name = z.string().trim().min(1).max(CLUSTER_NAME_MAX);

const input = z.object({
  blockers: z
    .array(
      z.object({
        id,
        text: z.string().trim().min(1).max(CLUSTER_TEXT_MAX),
        side: z.enum(BLOCK_SIDES).optional(),
      })
    )
    .min(1)
    .max(CLUSTER_BLOCKERS_MAX),
  /** The clusters the team already uses, to reuse. */
  known: z.array(name).max(CLUSTER_KNOWN_MAX),
});

const output = z.object({
  clusters: z
    .array(
      z.object({
        name,
        side: z.enum(BLOCK_SIDES),
        ids: z.array(id).max(CLUSTER_BLOCKERS_MAX),
      })
    )
    .max(CLUSTER_OUT_MAX),
});

export type ClusterBlockersInput = z.infer<typeof input>;
export type ClusterBlockersOutput = z.infer<typeof output>;
export type BlockerCluster = ClusterBlockersOutput["clusters"][number];

export const impedimentsClusterTask = defineAiTask({
  id: "impediments.cluster",
  toolId: "impediments",
  tier: "flash",
  effort: "low",
  maxTokens: 4096,
  input,
  output,
  fallback: clusterBlockersFallback,
  sample: {
    blockers: [
      { id: "b1", text: "Waiting on the security review for the payments API", side: "external" },
      { id: "b2", text: "Blocked: Pay with a saved card. Waiting for the platform team" },
      { id: "b3", text: "Staging environment down after the runner upgrade" },
      { id: "b4", text: "CI red since Tuesday; nothing can merge" },
      { id: "b5", text: "Acceptance criteria unclear on the refunds story" },
    ],
    known: ["Another team", "Test or build environment"],
  },
});
