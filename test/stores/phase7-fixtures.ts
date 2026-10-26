/**
 * Full Phase 7 (Prioritize & decide) records: every new field filled in, so a
 * test can tell when a store path or a CRUD schema drops one.
 */

import { type BacklogItem } from "@/lib/stores/workspace-types";

/** Every BacklogItem field, the Phase 7 ones included. */
export const BACKLOG_FULL: BacklogItem = {
  id: "backlog_full",
  name: "Search",
  description: "Find anything",
  moscow: "must",
  businessValue: 13,
  timeCriticality: 8,
  riskReduction: 3,
  jobSize: 5,
  reach: 400,
  reachPeriod: "month",
  impact: 1.5,
  confidence: 80,
  effort: 0.5,
  value: 7,
  matrixEffort: 4,
  rank: 2,
  updatedAt: "2026-10-21T09:00:00.000Z",
};

/** An item with every method input missing (an agent's bare create, say). */
export const BACKLOG_BARE: BacklogItem = { id: "backlog_bare", name: "Bare" };
