/**
 * One full record of each Phase 43 workspace collection (the tools plan's
 * phase 2), every optional field set, for the store and CRUD tests. Chains
 * import them read-only; extra cases go in their own phase43-<chain> files.
 */
import type {
  AbTest,
  BugReport,
  EbmBoard,
  EpicRoadmap,
  ExampleMap,
  HillChart,
  HypothesisTracker,
  Impediment,
  Improvement,
  InterruptItem,
  Kickoff,
  MeetingNote,
  Persona,
  PokerAsyncRound,
  ProductCanvas,
  ProductMetric,
  ReleaseReadiness,
  RetroBoard,
  RootCauseAnalysis,
  StandupEntry,
  Story,
  StrategyMap,
  TeamTimePerson,
  TeamTimePoll,
  TeamTimeRotation,
  TestSession,
  WorkflowDefinition,
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

/* P2.5 */

export const PRODUCT_METRIC: ProductMetric = {
  id: "metric_1",
  name: "Weekly active shops",
  definition: "Shops that took at least one payment in the week.",
  unit: "shops",
  direction: "increase",
  baseline: 800,
  target: 1200,
  owner: "Ana",
  role: "north-star",
  heart: {
    category: "engagement",
    feature: "Refunds",
    goal: "Shops refund without calling",
    signal: "Refunds a week",
  },
  aarrr: "retention",
  kva: "current-value",
  source: "nps-90d",
  readings: [
    { id: "rd1", date: "2026-11-02", value: 810 },
    { id: "rd2", date: "2026-11-09", value: 845, note: "Refunds shipped." },
  ],
  createdAt: AT,
  updatedAt: LATER,
};

export const AB_TEST: AbTest = {
  id: "abtest_1",
  name: "Refund button colour",
  question: "Does a green refund button get more refunds done?",
  metricName: "Refunds completed",
  metricId: "metric_1",
  hypothesisId: "hyp_1",
  plan: {
    baseline: 0.12,
    mde: 0.1,
    mdeMode: "relative",
    confidence: 0.95,
    power: 0.8,
    sided: "two",
    dailyTraffic: 400,
  },
  variants: [
    { id: "a", name: "Grey", visitors: 4000, conversions: 480 },
    { id: "b", name: "Green", visitors: 4000, conversions: 540 },
  ],
  guardrails: [{ name: "Support calls", why: "A refund done wrong costs a call." }],
  status: "done",
  startedOn: "2026-10-01",
  endedOn: "2026-10-21",
  decision: "ship",
  note: "Green wins.",
  createdAt: AT,
  updatedAt: LATER,
};

export const EBM_BOARD: EbmBoard = {
  id: "ebmBoard:current",
  strategicGoal: "Every small shop takes cards",
  strategicWhy: "Cash-only shops lose sales.",
  reviews: [
    {
      id: "rev1",
      date: "2026-10-01",
      focus: "time-to-market",
      note: "Releases are slow.",
      areas: { "current-value": 0.6, "time-to-market": 0.3, "ability-to-innovate": 0.5 },
    },
  ],
  createdAt: AT,
  updatedAt: LATER,
};

/** The Hypothesis Tracker with a value check (P2.5's fields). */
export const TRACKER_WITH_VALUE_CHECK: HypothesisTracker = {
  id: "hypothesisTracker:current",
  hypotheses: [
    {
      id: "hyp_9",
      believe: "Refunds in the app",
      willDo: "cut refund calls",
      toLearn: "whether shops use it",
      successMetric: "Refund calls a week",
      status: "running",
      raisedAt: AT,
      measuredBy: { kind: "metric", metricId: "metric_1", note: "Read on Mondays." },
      shipped: { kind: "story", id: "story_7", title: "Refund a card payment", doneAt: LATER },
      checkOn: "2026-12-01",
    },
  ],
};

/* P2.6 */

export const WORKFLOW_DEFINITION: WorkflowDefinition = {
  id: "workflow-definition:current",
  board: "flow",
  workItem: "A story or a bug",
  startPoint: "Ready",
  finishPoint: "Done",
  workTypes: [
    { type: "feature", meaning: "New value for shops", targetPct: 60 },
    { type: "defect", targetPct: 20 },
    { type: "debt", targetPct: 15 },
    { type: "risk", targetPct: 5 },
  ],
  policies: [{ stage: "Review", enter: "Tests pass", exit: "Two approvals" }],
  classPolicies: [{ class: "expedite", policy: "One at a time, swarm on it" }],
  wipPolicy: "Finish before you start",
  pullPolicy: "Oldest first",
  blockerPolicy: "Raise at the next standup",
  sle: { days: 10, pct: 85 },
  statik: {
    inside: "Late reviews",
    outside: "Shops wait for fixes",
    demand: "Features and bugs",
    capability: "Ten items a week",
    workflow: "Ready, doing, review, done",
    classes: "Standard and expedite",
    design: "A flow board",
    rollout: "Start next sprint",
  },
  cadences: [
    {
      id: "cad1",
      name: "Replenishment",
      cadence: "weekly",
      minutes: 30,
      purpose: "Pick next work",
    },
  ],
  versions: [
    {
      version: 1,
      savedAt: AT,
      note: "First version",
      expect: "Fewer late reviews",
      snapshot: {
        board: "flow",
        workItem: "A story",
        sle: { days: 12, pct: 85 },
        wipLimits: { backlog: 0, ready: 5, in_progress: 3, review: 2, done: 0 },
      },
    },
  ],
  createdAt: AT,
  updatedAt: LATER,
};

/** A story with Flow Insights' fields (P2.6). */
export const STORY_WITH_FLOW: Story = {
  id: "story_flow",
  title: "Fix the refund button",
  status: "in_progress",
  blocked: false,
  workType: "defect",
  demand: "failure",
  blockLog: [
    {
      from: AT,
      to: LATER,
      cause: "Waiting for the bank's sandbox",
      cluster: "A vendor or outside service",
      side: "external",
      sentTo: [{ route: "impediment", targetId: "imp_4", at: LATER }],
    },
    { from: "2026-11-01T09:00:00.000Z", to: "2026-11-01T12:00:00.000Z", earlier: true },
  ],
};

/** An impediment in a blocker cluster (P2.6). */
export const IMPEDIMENT_IN_CLUSTER: Impediment = {
  id: "imp_4",
  title: "Bank sandbox is down",
  severity: "high",
  raisedAt: AT,
  cluster: "A vendor or outside service",
  blockSide: "external",
};

/* P2.7 */

export const IMPROVEMENT: Improvement = {
  id: "improve_1",
  title: "Shorter review wait",
  method: "kata",
  status: "closed",
  owner: "Ana",
  coach: "Bo",
  background: "Stories wait two days for a review.",
  current: { text: "Two days", metric: "Review wait", value: 2, unit: "days", date: "2026-11-01" },
  target: {
    text: "Half a day",
    metric: "Review wait",
    value: 0.5,
    unit: "days",
    date: "2026-12-01",
  },
  pastTargets: [
    {
      text: "One day",
      metric: "Review wait",
      value: 1,
      unit: "days",
      date: "2026-11-15",
      reachedAt: AT,
    },
  ],
  analysis: "Reviews wait for the one senior developer.",
  rootCauseId: "rca_1",
  obstacles: [
    {
      id: "o1",
      text: "Only one person reviews",
      status: "working",
      sentTo: [{ route: "impediment", targetId: "imp_5", at: LATER }],
    },
    { id: "o2", text: "Big pull requests", status: "cleared" },
  ],
  steps: [
    {
      id: "s1",
      text: "Pair reviews on Tuesdays",
      expect: "Wait drops to a day",
      result: "It dropped to a day and a half",
      learned: "Pairing helps; size matters more",
      obstacleId: "o1",
      owner: "Ana",
      due: "2026-11-10",
      status: "done",
      doneAt: LATER,
      sentTo: [{ route: "retro-action", targetId: "action_3", at: LATER }],
    },
    { id: "s2", text: "Cap pull requests at 300 lines", status: "planned" },
  ],
  readings: [
    { id: "rd1", date: "2026-11-01", value: 2 },
    { id: "rd2", date: "2026-11-08", value: 1.5, note: "After pairing" },
  ],
  check: "The wait halved.",
  followUp: "Keep pairing.",
  nextCoachingAt: "2026-11-20",
  closedAt: LATER,
  sentTo: [{ route: "root-cause", targetId: "rca_2", at: LATER }],
  createdAt: AT,
  updatedAt: LATER,
};

/** A causal loop on a Root Cause analysis (P2.7's field). */
export const ANALYSIS_WITH_LOOP: RootCauseAnalysis = {
  id: "rca_loop",
  title: "Releases keep slipping",
  problem: "Each release is later than the one before.",
  method: "causal-loop",
  whys: [],
  causes: [],
  loop: {
    nodes: [
      { id: "n1", text: "Late releases" },
      { id: "n2", text: "Overtime" },
      { id: "n3", text: "Bugs" },
    ],
    links: [
      { id: "l1", from: "n1", to: "n2", polarity: "same" },
      { id: "l2", from: "n2", to: "n3", polarity: "same", delay: true },
      { id: "l3", from: "n3", to: "n1", polarity: "same" },
    ],
    names: [{ key: "n1>n2>n3", name: "The overtime spiral" }],
  },
  createdAt: AT,
  updatedAt: LATER,
};

/** A retro board whose card carries its sprint day (P2.7's Emotional Seismograph field). */
export const RETRO_WITH_DAYS: RetroBoard = {
  id: "retro:current",
  format: { id: "seismograph", name: "Emotional Seismograph", columns: [] } as never,
  phase: "write",
  cards: [
    {
      id: "c1",
      columnKey: "highs",
      text: "Demo went well",
      votes: 0,
      groupedWith: null,
      isActionItem: false,
      assignee: "",
      discussing: false,
      day: 4,
    },
  ],
  userVotes: 0,
  timerSeconds: 0,
  timerRunning: false,
  discussingIndex: 0,
};

/* P2.8 */

export const KICKOFF: Kickoff = {
  id: "kickoff_1",
  title: "Payments team liftoff",
  format: "team-canvas",
  brief: "A new team for card payments.",
  date: "2026-11-16",
  participants: ["Ana", "Bo"],
  sections: {
    people: [
      { id: "p1", text: "", owner: "Ana" },
      { id: "p2", text: "Product Owner", owner: "Bo" },
    ],
    worries: [
      {
        id: "w1",
        text: "The bank's sandbox is slow",
        likelihood: 4,
        impact: 3,
        sentTo: [{ route: "risk", targetId: "risk_1", at: LATER }],
      },
    ],
    rules: [{ id: "r1", text: "Pair on anything risky", covers: "w1" }],
  },
  sliders: [
    { id: "sl1", label: "Quality", position: 1, note: "Payments can't break" },
    { id: "sl2", label: "Scope", position: 2 },
  ],
  slidersSetAt: AT,
  status: "agreed",
  agreedAt: LATER,
  sentTo: [{ route: "decision", targetId: "dec_2", at: LATER }],
  createdAt: AT,
  updatedAt: LATER,
};

/* P2.9 */

export const TEAM_TIME_PERSON: TeamTimePerson = {
  id: "ttp_1",
  teamMemberId: "member_ana",
  name: "Ana",
  timeZone: "Europe/London",
  start: "09:00",
  end: "17:30",
  workingDays: [1, 2, 3, 4, 5],
  officeDays: [2, 4],
  site: "London",
  note: "Picks up her son at four on Fridays.",
  createdAt: AT,
  updatedAt: LATER,
};

export const TEAM_TIME_POLL: TeamTimePoll = {
  id: "ttpoll_1",
  title: "Quarterly planning",
  minutes: 90,
  slots: [
    { id: "s1", start: "2026-11-24T14:00:00.000Z" },
    { id: "s2", start: "2026-11-25T08:00:00.000Z" },
  ],
  answers: [
    { name: "Ana", picks: { s1: "yes", s2: "maybe" } },
    { name: "Kenji", picks: { s1: "no", s2: "yes" } },
  ],
  status: "closed",
  chosenSlotId: "s2",
  note: "Kenji can't do evenings.",
  createdAt: AT,
  updatedAt: LATER,
};

export const TEAM_TIME_ROTATION: TeamTimeRotation = {
  id: "ttrot_1",
  meeting: "Sprint Review",
  minutes: 60,
  everyWeeks: 2,
  startDate: "2026-11-05",
  mode: "fairest",
  options: [
    { id: "o1", label: "London afternoon", weekday: 4, time: "15:00", timeZone: "Europe/London" },
    { id: "o2", weekday: 5, time: "09:00", timeZone: "Asia/Tokyo" },
  ],
  attendees: ["ttp_1", "ttp_2"],
  held: [
    { date: "2026-11-05", optionId: "o1" },
    { date: "2026-11-20", optionId: "o2", skipped: true },
  ],
  meetingAuditId: "meeting_1",
  createdAt: AT,
  updatedAt: LATER,
};

/** A standup entry in Progress/Plans/Problems, with a DRI and a hand-over (P2.9's fields). */
export const STANDUP_PPP: StandupEntry = {
  id: "standup_ppp",
  member: "Ana",
  date: "2026-11-12",
  yesterday: "Refund screen done",
  today: "Refund tests",
  blockers: "Bank sandbox down",
  timestamp: 1731398400000,
  mode: "async",
  format: "ppp",
  blockerDri: "Bo",
  handoff: "Kenji: the sandbox may be back by your morning.",
};
