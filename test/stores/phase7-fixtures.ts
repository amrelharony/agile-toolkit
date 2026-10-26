/**
 * Full Phase 7 (Prioritize & decide) records: every new field filled in, so a
 * test can tell when a store path or a CRUD schema drops one.
 */

import {
  BUY_A_FEATURE_ID,
  DEFAULT_WEIGHTED_MATRIX_ID,
  type AllocationRound,
  type BacklogItem,
  type BuyAFeatureGame,
  type CynefinItem,
  type Decision,
  type PrioritizationItem,
  type Story,
  type WeightedCriterion,
  type WeightedMatrix,
  type WeightedOption,
} from "@/lib/stores/workspace-types";

export const ALLOCATION_ROUND: AllocationRound = {
  id: "allocationRound_abc12345",
  tool: "hundred-dollar-test",
  roundId: "round-7",
  title: "Q4 themes",
  budget: 100,
  unit: "$",
  spendAll: true,
  date: "2026-10-20",
  closedAt: "2026-10-20T10:15:00.000Z",
  minN: 3,
  ballots: 6,
  source: "room",
  bandEdges: [0, 1, 11, 26, 51],
  items: [
    {
      itemId: "prio_search",
      text: "Search",
      cap: 60,
      total: 340,
      backers: 6,
      bands: [0, 0, 1, 2, 3],
    },
    { itemId: "prio_exports", text: "Exports", total: 260, backers: null, bands: null },
  ],
};

export const BUY_A_FEATURE_GAME: BuyAFeatureGame = {
  id: BUY_A_FEATURE_ID,
  budgetPerPlayer: 120,
  players: 5,
  unit: "€",
  updatedAt: "2026-10-20T09:00:00.000Z",
};

export const MATRIX: WeightedMatrix = {
  id: "weightedMatrix_abc12345",
  name: "Hosting",
  question: "Where do we host the new service?",
  createdAt: "2026-10-18T09:00:00.000Z",
  updatedAt: "2026-10-19T09:00:00.000Z",
  sentTo: [{ route: "decision", targetId: "dec_1", at: "2026-10-19T09:30:00.000Z" }],
};

export const OPTION: WeightedOption = {
  id: "weightedOpt_abc12345",
  name: "Managed cloud",
  scores: { weightedCrit_cost: 6, weightedCrit_speed: 9 },
  matrixId: MATRIX.id,
  note: "Fastest to start",
};

export const CRITERION: WeightedCriterion = {
  id: "weightedCrit_cost",
  name: "Cost",
  weight: 3,
  matrixId: MATRIX.id,
  low: "Over budget",
  high: "Well under budget",
};

/** A legacy row: no matrixId, so it is in the default matrix. */
export const LEGACY_OPTION: WeightedOption = {
  id: "opt-legacy",
  name: "On-prem",
  scores: { "crit-legacy": 4, weightedCrit_cost: 2 },
};

export const LEGACY_CRITERION: WeightedCriterion = { id: "crit-legacy", name: "Risk", weight: 2 };

export const DEFAULT_OPTION: WeightedOption = {
  id: "opt-default",
  name: "Hybrid",
  scores: {},
  matrixId: DEFAULT_WEIGHTED_MATRIX_ID,
};

export const DECISION: Decision = {
  id: "dec_full",
  title: "Pick a feature-flag service",
  context: "We toggle by hand today",
  decision: "We will use the managed service",
  consequences: "A monthly bill",
  alternatives: ["Build our own"],
  status: "accepted",
  date: "2026-10-10",
  sourceRef: {
    tool: "weighted-decision",
    id: "weightedMatrix_abc12345",
    doc: "weightedMatrix_abc12345",
  },
  template: "daci",
  number: 4,
  options: [
    { id: "o1", text: "Managed service", note: "Costs money" },
    { id: "o2", text: "Build our own" },
  ],
  chosenOptionId: "o1",
  recommendation: "Go managed",
  decider: "Ana",
  roles: { driver: ["Bo"], contributor: ["Cy", "Di"], informed: ["Team"] },
  decidedAt: "2026-10-12",
  implementedAt: "2026-10-20",
  reopenedAt: "2026-10-11",
  supersededBy: "dec_next",
};

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

export const STORY_RANKED: Story = {
  id: "story_ranked",
  title: "Search",
  status: "backlog",
  priorityScore: 4.8,
  backlogRank: 2,
  sourceRef: { tool: "prioritizer", id: "backlog_full" },
};

export const FUNDED_FEATURE: PrioritizationItem = {
  id: "prio_funded",
  framework: "buy-feature",
  title: "Dark mode",
  score: 300,
  fields: { price: 300, raised: 300 },
  status: "decided",
  updatedAt: "2026-10-20T09:00:00.000Z",
  backlogItemId: "backlog_full",
  sentTo: [{ route: "backlog-story", targetId: "story_ranked", at: "2026-10-20T10:00:00.000Z" }],
};

export const CYNEFIN: CynefinItem = {
  id: "cynefin_full",
  title: "New pricing",
  domain: "complex",
  rationale: "Nobody knows how customers react",
  recommendedAction: "Probe, sense, respond",
  loggedAt: "2026-10-20T09:00:00.000Z",
  answers: { crisis: "no", known: "no", analysable: "no", emergent: "yes", disagree: "unsure" },
  sentTo: [{ route: "hypothesis", targetId: "hyp_1", at: "2026-10-20T09:05:00.000Z" }],
};
