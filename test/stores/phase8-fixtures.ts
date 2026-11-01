/**
 * Full Phase 8 (Outcomes, quality & library) records: every new field
 * filled in, so a test can tell when a store path or a CRUD schema drops
 * one. The LEGACY_* records are the shapes stored before Phase 8 (no new
 * field), which must keep parsing and loading as they did.
 */

import {
  KR_CHECK_IN_CAP,
  OPPORTUNITY_TREE_ID,
  type CodeReviewLog,
  type FlakyTestBoard,
  type HypothesisTracker,
  type KeyResultCheckIn,
  type NpsResponse,
  type Okr,
  type OpportunityTree,
  type Risk,
  type RiskiestAssumption,
  type TechDebtItem,
  type TestPyramid,
  type UserInterviewLog,
} from "@/lib/stores/workspace-types";

export const RISK: Risk = {
  id: "risk_abc12345",
  title: "The payment provider changes its API mid-sprint",
  probability: 3,
  impact: 5,
  mitigation: "Pin the SDK version; subscribe to the change log",
  mitigationDueAt: "2026-11-06",
  status: "mitigating",
  raisedAt: "2026-10-12",
  sourceRef: { tool: "premortem", id: "cause-3", doc: "premortem:current" },
  owner: "Priya",
  description: "Their v3 deprecates the token endpoint we call.",
  residualProbability: 2,
  residualImpact: 3,
  sentTo: [{ route: "impediment", targetId: "imp_9", at: "2026-10-20T09:00:00.000Z" }],
  updatedAt: "2026-10-20T09:00:00.000Z",
};

/** A risk as the register stored it before Phase 8. */
export const LEGACY_RISK: Risk = {
  id: "risk_legacy01",
  title: "Key reviewer away for two weeks",
  probability: 4,
  impact: 2,
  status: "open",
  raisedAt: "2026-09-01",
};

const checkIn = (n: number): KeyResultCheckIn => ({
  id: `ci_${n}`,
  date: `2026-10-${String(n).padStart(2, "0")}`,
  value: 20 - n,
  ...(n % 2 === 0 ? { confidence: 6 } : {}),
  ...(n === 1 ? { note: "Baseline week" } : {}),
});

export const OKR: Okr = {
  id: "okr_abc12345",
  objective: "Customers stay with us",
  description: "Churn has crept up since the price change.",
  quarter: "2026 Q4",
  owner: "Sam",
  keyResults: [
    {
      id: "kr_churn",
      title: "Monthly churn",
      description: "Logo churn, all plans",
      target: 15,
      current: 18,
      unit: "%",
      confidence: 6,
      baseline: 22,
      direction: "decrease",
      checkIns: [checkIn(1), checkIn(2), checkIn(3)],
    },
    {
      id: "kr_nps",
      title: "Onboarding NPS",
      target: 40,
      current: 31,
      baseline: 20,
      direction: "increase",
      checkIns: [],
    },
  ],
};

/** An OKR as stored before Phase 8: no baseline, direction or check-ins. */
export const LEGACY_OKR: Okr = {
  id: "okr_legacy01",
  objective: "Ship the mobile app",
  quarter: "Q4 2026",
  keyResults: [{ id: "kr_a", title: "Beta testers", target: 100, current: 40, confidence: 5 }],
};

/** KR_CHECK_IN_CAP check-ins, the most a key result keeps. */
export const FULL_CHECK_INS: KeyResultCheckIn[] = Array.from(
  { length: KR_CHECK_IN_CAP },
  (_, i) => ({
    id: `ci_full_${i}`,
    date: "2026-10-01",
    value: i,
  })
);

export const TECH_DEBT: TechDebtItem = {
  id: "td_abc12345",
  title: "Hand-rolled date maths in billing",
  description: "Three copies of the month-end rule.",
  area: "billing",
  impact: 4,
  effort: 2,
  interestRate: 1.5,
  raisedAt: "2026-08-03",
  tags: ["dates", "billing"],
  sentTo: [{ route: "backlog-story", targetId: "story_77", at: "2026-10-21T10:00:00.000Z" }],
  updatedAt: "2026-10-21T10:00:00.000Z",
};

export const LEGACY_TECH_DEBT: TechDebtItem = {
  id: "td_legacy01",
  title: "Old logging library",
  impact: 2,
  effort: 3,
  raisedAt: "2026-05-01",
  resolvedAt: "2026-09-30",
};

export const TEST_PYRAMID: TestPyramid = {
  id: "testPyramid:current",
  unit: 820,
  integration: 140,
  e2e: 35,
  description: "Monorepo, main branch",
  runtime: { unit: 4, integration: 11, e2e: 26.5 },
  weighting: "runtime",
  snapshots: [
    {
      id: "tps_aaaa1111",
      takenOn: "2026-07-01",
      unit: 300,
      integration: 90,
      e2e: 120,
      note: "Before the cleanup",
    },
    {
      id: "tps_bbbb2222",
      takenOn: "2026-10-01",
      unit: 820,
      integration: 140,
      e2e: 35,
      runtime: { unit: 4, integration: 11, e2e: 26.5 },
    },
  ],
  updatedOn: "2026-10-26",
};

export const LEGACY_TEST_PYRAMID: TestPyramid = {
  id: "testPyramid:current",
  unit: 120,
  integration: 40,
  e2e: 60,
};

export const FLAKY_BOARD: FlakyTestBoard = {
  id: "flakyTestBoard:current",
  tests: [
    {
      id: "ft_1",
      name: "checkout › VAT rounding",
      suite: "e2e",
      owner: "Lee",
      failureRate: 0.15,
      status: "quarantined",
      firstSeenAt: "2026-09-14",
      description: "Fails when the clock crosses midnight UTC.",
      failures: 30,
      runs: 200,
      quarantinedAt: "2026-10-05",
      sentTo: [{ route: "backlog-story", targetId: "story_12", at: "2026-10-06T08:00:00.000Z" }],
    },
    {
      id: "ft_2",
      name: "search › debounce",
      failureRate: 0.05,
      status: "fixed",
      firstSeenAt: "2026-08-01",
      fixedAt: "2026-10-10",
      failures: 1,
      runs: 20,
    },
    // A rate-only row from before Phase 8.
    {
      id: "ft_legacy",
      name: "login › SSO",
      failureRate: 0.3,
      status: "active",
      firstSeenAt: "2026-06-01",
    },
  ],
};

export const CODE_REVIEW_LOG: CodeReviewLog = {
  id: "codeReviewLog:current",
  samples: [
    {
      id: "pr_1",
      prNumber: "412",
      author: "Alice",
      openedAt: "2026-10-16T16:30",
      firstReviewAt: "2026-10-19T09:15",
      mergedAt: "2026-10-19T14:00",
      reviewerCount: 2,
      commentCount: 5,
      linesChanged: 180,
      description: "Billing: month-end rule in one place",
    },
    // From before Phase 8: no first review, merged before it was opened
    // (the page flags it; the schema leaves it alone).
    {
      id: "pr_legacy",
      author: "Bob",
      openedAt: "2026-09-02T10:00",
      mergedAt: "2026-09-01T10:00",
      reviewerCount: 1,
      commentCount: 0,
      linesChanged: 20,
    },
  ],
  workingWindow: { start: "09:00", end: "17:30" },
};

export const RISKIEST: RiskiestAssumption = {
  id: "riskiestAssumption:current",
  assumptions: [
    {
      id: "as_1",
      statement: "Teams will pay for a second seat",
      riskLevel: 5,
      evidenceLevel: 1,
      testIdea: "Fake-door upgrade button",
      status: "testing",
      description: "Pricing page interviews were split.",
      sentTo: [{ route: "hypothesis", targetId: "hyp_7", at: "2026-10-22T09:00:00.000Z" }],
    },
    // Not rated yet: no ratings at all.
    { id: "as_2", statement: "Admins want SSO on day one", status: "untested" },
  ],
};

export const LEGACY_RISKIEST: RiskiestAssumption = {
  id: "riskiestAssumption:current",
  assumptions: [
    {
      id: "as_old",
      statement: "Users read the changelog",
      riskLevel: 3,
      evidenceLevel: 3,
      status: "untested",
    },
  ],
};

export const HYPOTHESES: HypothesisTracker = {
  id: "hypothesisTracker:current",
  hypotheses: [
    {
      id: "hyp_7",
      believe: "Teams will pay for a second seat",
      willDo: "Show an upgrade button on the team page",
      toLearn: "Whether admins click it",
      successMetric: "Upgrade clicks per active team",
      experiment: "Fake-door for two weeks",
      status: "running",
      raisedAt: "2026-10-22",
      sourceRef: { tool: "riskiest-assumption", id: "as_1", doc: "riskiestAssumption:current" },
      target: { direction: "increase", value: 8, unit: "%", baseline: 2 },
      actual: 5.5,
    },
    {
      id: "hyp_old",
      believe: "Dark mode cuts churn",
      willDo: "Ship it",
      toLearn: "Churn",
      successMetric: "Churn down",
      status: "inconclusive",
      raisedAt: "2026-06-01",
      resolvedAt: "2026-07-01",
    },
  ],
};

export const INTERVIEWS: UserInterviewLog = {
  id: "userInterviewLog:current",
  interviews: [
    {
      id: "int_1",
      date: "2026-10-14",
      participant: "Dana (ops lead)",
      context: "Mid-size customer, on the Team plan",
      quotes: [
        {
          id: "q_1",
          text: "I export to a spreadsheet every Friday just to see who's blocked.",
          tags: ["reporting"],
          sentTo: [{ route: "opportunity", targetId: "node_9", at: "2026-10-15T09:00:00.000Z" }],
        },
        { id: "q_2", text: "Pricing is fine.", tags: ["pricing"] },
      ],
    },
  ],
};

export const OPPORTUNITIES: OpportunityTree = {
  id: OPPORTUNITY_TREE_ID,
  nodes: [
    { id: "node_1", kind: "outcome", text: "Teams see blockers sooner", parentId: null },
    {
      id: "node_9",
      kind: "opportunity",
      text: "I export to a spreadsheet every Friday just to see who's blocked.",
      parentId: "node_1",
      evidence: "From an interview on 2026-10-14",
      target: true,
      sourceRef: { tool: "user-interviews", id: "q_1", doc: "int_1" },
    },
    { id: "node_10", kind: "solution", text: "A blocked-work digest", parentId: "node_9" },
    {
      id: "node_11",
      kind: "experiment",
      text: "Email the digest to five teams",
      parentId: "node_10",
      description: "Two weeks, then ask",
      sentTo: [{ route: "hypothesis", targetId: "hyp_8", at: "2026-10-23T09:00:00.000Z" }],
    },
  ],
};

export const NPS: NpsResponse = {
  id: "nps_abc12345",
  kind: "nps",
  date: "2026-10-20",
  score: 9,
  respondent: "acme-admin",
  verbatim: "Love the board, pricing is steep",
  tags: ["pricing", "board"],
};

export const LEGACY_CSAT: NpsResponse = {
  id: "nps_legacy01",
  kind: "csat",
  date: "2026-08-02",
  score: 4,
};
