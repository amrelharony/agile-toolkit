/**
 * One full record of each Phase 43 workspace collection (the tools plan's
 * phase 2), every optional field set, for the store and CRUD tests. Chains
 * import them read-only; extra cases go in their own phase43-<chain> files.
 */
import type {
  BugReport,
  EpicRoadmap,
  ExampleMap,
  HillChart,
  InterruptItem,
  MeetingNote,
  Persona,
  PokerAsyncRound,
  ProductCanvas,
  ReleaseReadiness,
  StrategyMap,
  TestSession,
} from "@/lib/stores/workspace-types";

export const AT = "2026-11-12T09:00:00.000Z";
export const LATER = "2026-11-12T10:30:00.000Z";

/* P2.1 */

export const EXAMPLE_MAP: ExampleMap = {
  id: "exmap_1",
  title: "Refund a card payment",
  storyId: "story_7",
  rules: [
    { id: "r1", text: "Only the shop owner can refund" },
    {
      id: "r2",
      text: "A refund can't be more than the payment",
      sentTo: [{ route: "backlog-story", targetId: "story_8", at: LATER }],
    },
  ],
  examples: [
    { id: "e1", ruleId: "r1", text: "A cashier taps Refund and is told to ask the owner" },
    {
      id: "e2",
      ruleId: "r2",
      text: "Refund 12 of a 10 payment",
      given: "a payment of 10",
      when: "the owner refunds 12",
      then: "the refund is refused",
    },
  ],
  questions: [
    { id: "q1", text: "Can a refund be split?", ruleId: "r2", owner: "Ana", status: "open" },
    { id: "q2", text: "Do refunds need a reason?", status: "answered", answer: "No." },
  ],
  verdict: "split",
  timeboxMinutes: 25,
  sentAt: LATER,
  sentTo: [{ route: "backlog-story", targetId: "story_7", at: LATER }],
  createdAt: AT,
  updatedAt: LATER,
};

export const POKER_ASYNC_ROUND: PokerAsyncRound = {
  id: "async_1",
  title: "Checkout stories",
  scaleType: "fibonacci",
  deck: ["1", "2", "3", "5", "8", "13", "?"],
  stories: [
    { id: "s1", title: "Pay by phone", finalEstimate: "5" },
    { id: "s2", title: "Refund a payment", discuss: true },
  ],
  expected: ["Ana", "Bo"],
  dueDate: "2026-11-14",
  withMeanings: true,
  replies: [
    {
      id: "rep1",
      name: "Ana",
      votes: [
        { storyId: "s1", card: "5" },
        { storyId: "s2", card: "8" },
      ],
      notes: [{ storyId: "s2", text: "Needs the bank's API" }],
      at: AT,
    },
  ],
  status: "revealed",
  revealedAt: LATER,
  closedAt: LATER,
  createdAt: AT,
  updatedAt: LATER,
};

/* P2.2 */

export const BUG_REPORT: BugReport = {
  id: "bug_1",
  title: "Refund button does nothing on Android",
  steps: "Open a payment, tap Refund.",
  expected: "The refund screen opens.",
  actual: "Nothing happens.",
  environment: "Android 15, app 4.2",
  area: "Payments",
  reportedBy: "Bo",
  severity: "major",
  priority: "next",
  checks: {
    dataLoss: false,
    security: false,
    workaround: true,
    blocksRelease: false,
    reach: "some",
  },
  status: "closed",
  closeReason: "duplicate",
  duplicateOf: "bug_0",
  triagedAt: AT,
  closedAt: LATER,
  sourceRef: { tool: "test-sessions", id: "n1", doc: "tsess_1" },
  sentTo: [{ route: "backlog-story", targetId: "story_9", at: LATER }],
  createdAt: AT,
  updatedAt: LATER,
};

export const HILL_CHART: HillChart = {
  id: "hill_1",
  title: "Checkout epic",
  about: "The parts of the new checkout.",
  sprintId: "sprint_12",
  epicId: "epic_3",
  scopes: [
    {
      id: "sc1",
      title: "Card form",
      position: 72,
      storyId: "story_1",
      note: "Validation is clear now.",
      movedAt: LATER,
      sentTo: [{ route: "impediment", targetId: "imp_1", at: LATER }],
    },
    { id: "sc2", title: "Receipts", position: 100, epicId: "epic_3", movedAt: AT, doneAt: LATER },
  ],
  checkIns: [
    {
      id: "ci1",
      at: AT,
      positions: [
        { scopeId: "sc1", position: 40 },
        { scopeId: "sc2", position: 90 },
      ],
      note: "Receipts nearly there.",
    },
  ],
  archived: false,
  createdAt: AT,
  updatedAt: LATER,
};

export const TEST_SESSION: TestSession = {
  id: "tsess_1",
  charter: {
    target: "Refunds",
    using: "a slow network",
    toLearn: "Whether refunds survive a dropped connection.",
  },
  tester: "Ana",
  storyId: "story_7",
  area: "Payments",
  minutes: 60,
  status: "done",
  startedAt: AT,
  endedAt: LATER,
  coverage: "most",
  split: { testing: 60, bugs: 30, setup: 10 },
  notes: [
    {
      id: "n1",
      at: AT,
      kind: "bug",
      text: "Refund button does nothing on Android",
      sentTo: [{ route: "backlog-story", targetId: "story_9", at: LATER }],
    },
    { id: "n2", at: LATER, kind: "idea", text: "Try a refund while offline" },
  ],
  debrief: "Covered most of it; one bug.",
  createdAt: AT,
  updatedAt: LATER,
};

export const MEETING_NOTE: MeetingNote = {
  id: "mnote_1",
  meeting: "Sprint Review",
  date: "2026-11-12",
  text: "Ana will fix the refund bug by Friday.\nWe decided to drop the old checkout.",
  forgottenAt: LATER,
  items: [
    {
      id: "i1",
      kind: "action",
      text: "Fix the refund bug",
      detail: "Android only.",
      owner: "Ana",
      due: "2026-11-14",
      quote: "Ana will fix the refund bug by Friday.",
      status: "sent",
      keptAt: AT,
      sentTo: [{ route: "retro-action", targetId: "action_1", at: LATER }],
    },
    { id: "i2", kind: "decision", text: "Drop the old checkout", status: "open", keptAt: AT },
  ],
  createdAt: AT,
  updatedAt: LATER,
};

/** Release Readiness with a release that carries its notes (P2.2's field). */
export const RELEASES_WITH_NOTES: ReleaseReadiness = {
  id: "releaseReadiness:current",
  releases: [
    {
      id: "rel_1",
      name: "4.2",
      plannedDate: "2026-11-20",
      status: "planning",
      gates: {},
      storyIds: ["story_7"],
      releaseNotes: { audience: "customers", text: "Refunds work on Android.", updatedAt: LATER },
    },
  ],
};

/** An interrupt sent from Bug Triage (P2.2's sourceRef). */
export const INTERRUPT_FROM_BUG: InterruptItem = {
  id: "interrupt_9",
  sprintId: "sprint_12",
  title: "Refund button does nothing on Android",
  kind: "bug",
  emergency: false,
  loggedAt: AT,
  sourceRef: { tool: "bug-triage", id: "bug_1" },
};

/* P2.3 */

export const PRODUCT_CANVAS: ProductCanvas = {
  id: "pcanvas_1",
  format: "shape-up",
  title: "Refunds without a call",
  sections: {
    problem: [
      {
        id: "p1",
        text: "Shop owners phone us to refund a payment.",
        detail: "About 40 calls a week.",
        evidence: "fact",
        links: ["story_7"],
        owner: "Ana",
      },
    ],
    "no-gos": [
      {
        id: "n1",
        text: "No partial refunds this cycle",
        evidence: "assumption",
        promptId: "rabbit-holes",
        niceToHave: true,
        sentTo: [{ route: "decision", targetId: "dec_1", at: LATER }],
      },
    ],
  },
  appetiteWeeks: 6,
  intake: {
    requesters: ["Shop owners", "Support"],
    source: "customer",
    demand: 40,
    status: "merged",
    mergedInto: "pcanvas_0",
    note: "Asked for since spring.",
  },
  decision: { verdict: "go", note: "Worth six weeks.", decidedAt: LATER },
  bet: { status: "bet", cycle: 4, start: "2026-12-01", weeks: 6, decidedAt: LATER },
  productGoalId: "goal_1",
  sentTo: [{ route: "hypothesis", targetId: "hyp_1", at: LATER }],
  createdAt: AT,
  updatedAt: LATER,
};

/* P2.4 */

/** An impact map: goal, actors (one a persona), impacts (one the focus) and a deliverable. */
export const IMPACT_MAP: StrategyMap = {
  id: "strategyMap_1",
  format: "impact-map",
  title: "More shops take refunds themselves",
  nodes: [
    {
      id: "g",
      parentId: null,
      level: 0,
      text: "Halve refund calls by March",
      measure: "Refund calls a week",
      detail: "From 40 to 20.",
    },
    { id: "a1", parentId: "g", level: 1, text: "Shop owners", personaId: "persona_1" },
    { id: "i1", parentId: "a1", level: 2, text: "Refund from the app", focus: true },
    {
      id: "d1",
      parentId: "i1",
      level: 3,
      text: "Refund button on a payment",
      owner: "Ana",
      sentTo: [{ route: "backlog-story", targetId: "story_7", at: LATER }],
    },
  ],
  productGoalId: "goal_1",
  targetDate: "2027-03-31",
  createdAt: AT,
  updatedAt: LATER,
};

/** A Lean Value Tree, with the statuses and notes an impact map doesn't take. */
export const STRATEGY_TREE: StrategyMap = {
  id: "strategyMap_2",
  format: "lean-value-tree",
  title: "Payments for small shops",
  nodes: [
    { id: "v", parentId: null, level: 0, text: "Every shop takes cards", status: "agreed" },
    {
      id: "goal",
      parentId: "v",
      level: 1,
      text: "Setup in a minute",
      measure: "Median setup time",
      owner: "Bo",
      status: "agreed",
    },
    {
      id: "bet",
      parentId: "goal",
      level: 2,
      text: "A guided setup",
      status: "questioned",
      note: "Needs a test first.",
      sentTo: [{ route: "hypothesis", targetId: "hyp_2", at: LATER }],
    },
    { id: "init", parentId: "bet", level: 3, text: "Setup checklist", status: "proposed" },
  ],
  createdAt: AT,
  updatedAt: LATER,
};

export const PERSONA: Persona = {
  id: "persona_1",
  name: "Mina, the corner shop owner",
  role: "Runs a small shop alone",
  summary: "Takes cash and cards; does the books on Sunday.",
  tier: "primary",
  evidence: "some",
  goals: ["Get paid fast", "Spend less on fees"],
  pains: ["Phoning support to refund"],
  behaviours: ["Uses her phone for everything"],
  quote: "I don't have time to call anyone.",
  context: "Busy mornings, quiet afternoons.",
  tags: ["retail", "solo"],
  interviewIds: ["int_1", "int_2"],
  createdAt: AT,
  updatedAt: LATER,
};

/** The Epic Roadmap with an epic on the Now column, sent from an impact map (P2.4's fields). */
export const ROADMAP_WITH_HORIZON: EpicRoadmap = {
  id: "epicRoadmap:current",
  epics: [
    {
      id: "epic_1",
      title: "Refunds in the app",
      startQuarter: "2027-Q1",
      endQuarter: "2027-Q1",
      progress: 0,
      horizon: "now",
      sourceRef: { tool: "impact-map", id: "d1", doc: "strategyMap_1" },
    },
  ],
};
