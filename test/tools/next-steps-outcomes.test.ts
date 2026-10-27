import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { getNextStepRule, type NextStep } from "@/lib/tools/next-steps";
import type {
  Assumption,
  CeremonyCadenceDoc,
  FlakyTest,
  HandoffLink,
  Hypothesis,
  Impediment,
  Interview,
  KeyResult,
  NpsResponse,
  Okr,
  PrSample,
  Risk,
  Sprint,
  SprintGoal,
  Story,
  TechDebtItem,
  TestPyramid,
  TreeNode,
  Workspace,
} from "@/lib/stores/workspace-types";
import { CEREMONY_CADENCE_ID } from "@/lib/stores/workspace-types";
import { DEFAULT_CADENCE } from "@/lib/sprints/cadence";

/**
 * Next steps for the Outcomes, quality & library tools (Phase 8): each
 * reads the workspace through the tool's own lib (lib/okrs, lib/nps,
 * lib/hypotheses, lib/assumptions, lib/opportunity-tree, lib/interviews,
 * lib/risks, lib/tech-debt, lib/quality), points somewhere real, ignores
 * example rows, and stays quiet when nothing applies. Risk Register and
 * Tech Debt read workspace.risks and workspace.techDebt; Quality Cost,
 * whose own figures sit in a blob, reads the other quality tools.
 */

/** Every href a step gave in this file: the last test checks each one opens a page. */
const seen = new Set<string>();

const steps = (toolId: string, ws: Partial<Workspace>): NextStep[] => {
  const rule = getNextStepRule(toolId);
  if (!rule) throw new Error(`no rule for ${toolId}`);
  const out = rule.steps(rule.select(ws as Workspace));
  for (const s of out) seen.add(s.href);
  return out;
};
const ids = (toolId: string, ws: Partial<Workspace>) => steps(toolId, ws).map((s) => s.id);
const step = (toolId: string, ws: Partial<Workspace>, id: string) =>
  steps(toolId, ws).find((s) => s.id === id);

// Monday 26 Oct 2026: 26 days into 2026 Q4.
const TODAY = "2026-10-26";
const STAMP = "2026-10-20T09:00:00.000Z";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${TODAY}T09:00:00`));
});
afterEach(() => vi.useRealTimers());

const sprint = (over: Partial<Sprint> = {}): Sprint => ({
  id: "s2",
  name: "Sprint 2",
  startDate: "2026-10-19",
  endDate: "2026-10-30",
  pointsPlanned: 20,
  status: "active",
  ...over,
});
const PLANNED = sprint({
  id: "s3",
  name: "Sprint 3",
  startDate: "2026-11-02",
  endDate: "2026-11-13",
  status: "planned",
});
const story = (id: string, over: Partial<Story> = {}): Story => ({
  id,
  title: id,
  status: "backlog",
  ...over,
});
const link = (route: HandoffLink["route"], targetId: string): HandoffLink => ({
  route,
  targetId,
  at: STAMP,
});

describe("okrs", () => {
  const checkIn = (date: string, value = 20) => ({ id: `c-${date}`, date, value });
  const kr = (id: string, over: Partial<KeyResult> = {}): KeyResult => ({
    id,
    title: id,
    target: 100,
    current: 20,
    baseline: 0,
    ...over,
  });
  // Checked in six days ago: not due another.
  const okr = (id: string, over: Partial<Okr> = {}): Okr => ({
    id,
    objective: id,
    quarter: "2026 Q4",
    keyResults: [kr(`${id}-kr`, { checkIns: [checkIn("2026-10-20")] })],
    ...over,
  });
  const goal = (sprintId: string, okrIds: string[]): SprintGoal => ({
    id: `sprint-goal:sprint:${sprintId}`,
    businessObjective: "",
    goal: "",
    criteria: [],
    keyResults: [],
    sprintId,
    okrIds,
  });

  it("links the focus sprint's goal to an objective for its quarter, on Sprint Goal", () => {
    expect(steps("okrs", { okrs: [okr("o1")], sprints: [sprint()], sprintGoals: [] })).toEqual([
      {
        id: "okrs-link-goal",
        label: "Link Sprint 2's goal to an OKR",
        detail:
          "1 objective is set for 2026 Q4, and Sprint 2's goal doesn't link it. Linking one shows which objective the sprint moves.",
        href: "/sprint-goal?sprint=s2",
      },
    ]);
  });

  it("stays quiet once the goal links one, or with no objective for the sprint's quarter", () => {
    expect(
      ids("okrs", {
        okrs: [okr("o1"), okr("o2")],
        sprints: [sprint()],
        sprintGoals: [goal("s2", ["o2"])],
      })
    ).toEqual([]);
    expect(ids("okrs", { okrs: [okr("o1", { quarter: "2027 Q1" })], sprints: [sprint()] })).toEqual(
      []
    );
    // No open sprint: nothing to link.
    expect(ids("okrs", { okrs: [okr("o1")], sprints: [sprint({ status: "completed" })] })).toEqual(
      []
    );
  });

  it("reads the sprint's quarter from its first day, whatever form the quarter was typed in", () => {
    const next = sprint({
      id: "s9",
      name: "Sprint 9",
      startDate: "2027-01-04",
      endDate: "2027-01-15",
      status: "planned",
    });
    expect(
      step("okrs", { okrs: [okr("o1", { quarter: "Q1 2027" })], sprints: [next] }, "okrs-link-goal")
    ).toMatchObject({
      detail: expect.stringContaining("for 2027 Q1"),
      href: "/sprint-goal?sprint=s9",
    });
  });

  it("asks for check-ins on this quarter's key results gone quiet or never checked in", () => {
    const okrs = [
      okr("o1", {
        keyResults: [
          kr("k1", { checkIns: [checkIn("2026-10-05")] }),
          kr("k2"),
          kr("k3", { checkIns: [checkIn("2026-10-20")] }),
        ],
      }),
      // Last quarter's objectives aren't checked in on any more.
      okr("old", {
        quarter: "2026 Q3",
        keyResults: [kr("k4", { checkIns: [checkIn("2026-08-01")] })],
      }),
    ];
    expect(steps("okrs", { okrs })).toEqual([
      {
        id: "okrs-check-in",
        label: "Check in on 2 key results",
        detail:
          "1 key result last checked in 14 or more days ago and 1 key result with no check-in 26 days into 2026 Q4. A dated check-in with a confidence score keeps the trend going.",
        href: "/okrs",
      },
    ]);
  });

  it("doesn't flag a key result with no check-in in the quarter's first two weeks", () => {
    vi.setSystemTime(new Date("2026-10-05T09:00:00"));
    expect(ids("okrs", { okrs: [okr("o1", { keyResults: [kr("k1")] })] })).toEqual([]);
  });

  it("ignores example objectives", () => {
    const okrs = [okr("example-o1", { keyResults: [kr("example-k1")] })];
    expect(steps("okrs", { okrs, sprints: [sprint()] })).toEqual([]);
  });
});

describe("nps-csat", () => {
  const answer = (id: string, over: Partial<NpsResponse> = {}): NpsResponse => ({
    id,
    kind: "nps",
    date: "2026-10-20",
    score: 9,
    ...over,
  });
  const unhappy = (id: string, tag: string, date = "2026-10-20") =>
    answer(id, { score: 3, tags: [tag], date });

  it("suggests testing a fix for the theme with three unhappy answers in 90 days", () => {
    const npsResponses = [
      unhappy("r1", "pricing"),
      unhappy("r2", "pricing", "2026-09-01"),
      answer("r3", { kind: "csat", score: 1, tags: ["pricing"] }),
      unhappy("r4", "onboarding"),
    ];
    expect(steps("nps-csat", { npsResponses })).toEqual([
      {
        id: "nps-csat-test-fix",
        label: "Test a fix for “pricing”",
        detail:
          "3 unhappy answers in the last 90 days mention it. Write the change as a hypothesis, with the score you expect it to move.",
        href: "/hypothesis-tracker",
      },
    ]);
  });

  it("needs three unhappy answers inside the window", () => {
    const npsResponses = [
      unhappy("r1", "pricing"),
      unhappy("r2", "pricing"),
      // Older than 90 days: not counted.
      unhappy("r3", "pricing", "2026-07-01"),
    ];
    expect(ids("nps-csat", { npsResponses })).toEqual([]);
  });

  it("asks for new answers after a month without one", () => {
    const npsResponses = [
      answer("r1", { date: "2026-07-01" }),
      answer("r2", { date: "2026-09-10" }),
      // An undated answer from before Phase 8 says nothing about when.
      answer("r3", { date: "" }),
    ];
    expect(step("nps-csat", { npsResponses }, "nps-csat-add-answers")).toEqual({
      id: "nps-csat-add-answers",
      label: "Add the latest survey answers",
      detail: expect.stringMatching(
        /^The newest answer is from 10 Sept? 2026\. Import the survey export, or add the answers, to keep the trend going\.$/
      ),
      href: "/nps-csat",
    });
    expect(ids("nps-csat", { npsResponses: [answer("r1", { date: "2026-10-01" })] })).toEqual([]);
  });

  it("ignores example answers", () => {
    const npsResponses = [
      unhappy("example-r1", "pricing", "2026-07-01"),
      unhappy("example-r2", "pricing", "2026-07-01"),
      unhappy("example-r3", "pricing", "2026-07-01"),
    ];
    expect(steps("nps-csat", { npsResponses })).toEqual([]);
  });
});

const hypothesis = (id: string, over: Partial<Hypothesis> = {}): Hypothesis => ({
  id,
  believe: `Belief ${id}`,
  willDo: "Run it",
  toLearn: "Whether it works",
  successMetric: "Sign-ups",
  status: "running",
  raisedAt: "2026-10-01",
  ...over,
});
const trackers = (hypotheses: Hypothesis[]) => [{ id: "hypothesisTracker:current", hypotheses }];
const assumption = (id: string, over: Partial<Assumption> = {}): Assumption => ({
  id,
  statement: `Statement ${id}`,
  riskLevel: 3,
  evidenceLevel: 3,
  status: "untested",
  ...over,
});
const canvases = (assumptions: Assumption[]) => [{ id: "riskiestAssumption:current", assumptions }];

describe("hypothesis-tracker", () => {
  it("marks the assumption a test settled, on the canvas", () => {
    const ws = {
      hypothesisTrackers: trackers([
        hypothesis("h1", { status: "validated", resolvedAt: "2026-10-20" }),
      ]),
      riskiestAssumptions: canvases([
        assumption("a1", { status: "testing", sentTo: [link("hypothesis", "h1")] }),
      ]),
    };
    expect(steps("hypothesis-tracker", ws)).toEqual([
      {
        id: "hypothesis-tracker-assumption",
        label: "Mark the assumption your test settled",
        detail:
          "“Belief h1” was validated: mark “Statement a1” validated on the Riskiest Assumption canvas too.",
        href: "/riskiest-assumption",
      },
    ]);
  });

  it("leaves an assumption already marked, or tested inconclusively", () => {
    const ws = (status: Hypothesis["status"], marked: Assumption["status"]) => ({
      hypothesisTrackers: trackers([hypothesis("h1", { status, resolvedAt: "2026-10-20" })]),
      riskiestAssumptions: canvases([
        assumption("a1", { status: marked, sentTo: [link("hypothesis", "h1")] }),
      ]),
    });
    expect(ids("hypothesis-tracker", ws("validated", "validated"))).toEqual([]);
    expect(ids("hypothesis-tracker", ws("inconclusive", "testing"))).toEqual([]);
  });

  it("asks to finish drafts that arrived without the detail a test needs", () => {
    const hypothesisTrackers = trackers([
      hypothesis("h1", { status: "drafted", willDo: "", successMetric: " " }),
      hypothesis("h2", { status: "drafted", successMetric: "" }),
      // A finished test with an old blank line isn't a draft to finish.
      hypothesis("h3", { status: "validated", willDo: "", resolvedAt: "2026-10-01" }),
    ]);
    expect(steps("hypothesis-tracker", { hypothesisTrackers })).toEqual([
      {
        id: "hypothesis-tracker-needs-detail",
        label: "Finish the 2 drafted hypotheses",
        detail:
          "“Belief h1” still needs what we'll do and the success metric before it can run, and 1 other draft needs detail too. The “Needs detail” filter lists them all.",
        href: "/hypothesis-tracker",
      },
    ]);
  });

  it("asks for the result of the longest-running test with a target", () => {
    const target = { direction: "increase" as const, value: 12, unit: "%" };
    const hypothesisTrackers = trackers([
      hypothesis("h1", { target, raisedAt: "2026-10-10" }),
      hypothesis("h2", { target: { direction: "decrease", value: 3 }, raisedAt: "2026-09-01" }),
      // Measured, or with no number to hit: nothing to ask.
      hypothesis("h3", { target, actual: 14 }),
      hypothesis("h4"),
    ]);
    expect(steps("hypothesis-tracker", { hypothesisTrackers })).toEqual([
      {
        id: "hypothesis-tracker-result",
        label: "Record the result of “Belief h2”",
        detail:
          "Its target is at most 3, and 1 other running test is waiting too. Enter the measured number to get a suggested verdict.",
        href: "/hypothesis-tracker",
      },
    ]);
  });

  it("cuts a long statement in a label at a word", () => {
    const believe = "We believe ".concat("that a much simpler onboarding flow ".repeat(5));
    const [s] = steps("hypothesis-tracker", {
      hypothesisTrackers: trackers([
        hypothesis("h1", { believe, target: { direction: "increase", value: 5 } }),
      ]),
    });
    expect(s.label.length).toBeLessThan(100);
    expect(s.label).toMatch(/…”$/);
  });

  it("ignores example rows", () => {
    const ws = {
      hypothesisTrackers: trackers([
        hypothesis("example-h1", { status: "validated" }),
        hypothesis("example-h2", { status: "drafted", willDo: "" }),
        hypothesis("example-h3", { target: { direction: "increase", value: 5 } }),
      ]),
      riskiestAssumptions: canvases([
        assumption("example-a1", { sentTo: [link("hypothesis", "example-h1")] }),
      ]),
    };
    expect(steps("hypothesis-tracker", ws)).toEqual([]);
  });
});

describe("riskiest-assumption", () => {
  it("tests the riskiest assumption first", () => {
    const riskiestAssumptions = canvases([
      assumption("a1", { riskLevel: 3, evidenceLevel: 3 }),
      assumption("a2", { riskLevel: 5, evidenceLevel: 1 }),
    ]);
    expect(steps("riskiest-assumption", { riskiestAssumptions })).toEqual([
      {
        id: "riskiest-assumption-test",
        label: "Test “Statement a2” first",
        detail:
          "It scores 25 (risk 5, evidence 1), the riskiest on the canvas. “Test” on its card makes one in the Hypothesis Tracker.",
        href: "/riskiest-assumption",
      },
    ]);
  });

  it("moves on to the next one while the riskiest is under test", () => {
    const ws = {
      riskiestAssumptions: canvases([
        assumption("a1", { riskLevel: 3, evidenceLevel: 3 }),
        assumption("a2", { riskLevel: 5, evidenceLevel: 1, sentTo: [link("hypothesis", "h1")] }),
      ]),
      hypothesisTrackers: trackers([hypothesis("h1", { status: "drafted" })]),
    };
    expect(step("riskiest-assumption", ws, "riskiest-assumption-test")).toMatchObject({
      label: "Test “Statement a1” next",
      detail: expect.stringContaining("the riskiest with no hypothesis on it yet"),
    });
  });

  it("offers to mark one its hypothesis settled, and to rate the unrated", () => {
    const ws = {
      riskiestAssumptions: canvases([
        assumption("a1", { sentTo: [link("hypothesis", "h1")] }),
        assumption("a2", { riskLevel: undefined, evidenceLevel: undefined }),
        assumption("a3", { evidenceLevel: undefined }),
      ]),
      hypothesisTrackers: trackers([
        hypothesis("h1", { status: "invalidated", resolvedAt: "2026-10-20" }),
      ]),
    };
    expect(steps("riskiest-assumption", ws)).toEqual([
      {
        id: "riskiest-assumption-mark",
        label: "Mark “Statement a1” invalidated",
        detail:
          "Its hypothesis came back invalidated. The canvas waits for you to confirm: “Mark invalidated” on its card.",
        href: "/riskiest-assumption",
      },
      {
        id: "riskiest-assumption-rate",
        label: "Rate 2 assumptions to rank them",
        detail:
          "“Statement a2”, and 1 other need a risk and an evidence rating before they are ranked or placed on the matrix.",
        href: "/riskiest-assumption",
      },
    ]);
  });

  it("ignores example assumptions", () => {
    const riskiestAssumptions = canvases([
      assumption("example-a1", { riskLevel: 5, evidenceLevel: 1 }),
      assumption("example-a2", { riskLevel: undefined }),
    ]);
    expect(steps("riskiest-assumption", { riskiestAssumptions })).toEqual([]);
  });
});

describe("opportunity-tree", () => {
  const node = (
    id: string,
    kind: TreeNode["kind"],
    parentId: string | null,
    over: Partial<TreeNode> = {}
  ): TreeNode => ({ id, kind, text: `Node ${id}`, parentId, ...over });
  const trees = (nodes: TreeNode[]) => [{ id: "opportunityTree:current", nodes }];
  const TREE = [
    node("o1", "outcome", null),
    node("p1", "opportunity", "o1", { target: true }),
    node("p2", "opportunity", "o1"),
    node("s1", "solution", "p1"),
    node("e1", "experiment", "s1"),
    node("s2", "solution", "p2"),
    // Not under the target: not the next one to test.
    node("e2", "experiment", "s2"),
  ];

  it("tests an experiment under the target opportunity", () => {
    expect(steps("opportunity-tree", { opportunityTrees: trees(TREE) })).toEqual([
      {
        id: "opportunity-tree-test",
        label: "Test “Node e1” as a hypothesis",
        detail:
          "It sits under your target opportunity “Node p1” and hasn't been tested yet. “Test as a hypothesis” on it sends it to the Hypothesis Tracker.",
        href: "/opportunity-tree",
      },
    ]);
  });

  it("skips an experiment the card can't test until it is named", () => {
    // No text, under a solution with no text: "Test as a hypothesis" is disabled.
    const blank = [
      ...TREE.filter((n) => n.id !== "s1" && n.id !== "e1"),
      node("s1", "solution", "p1", { text: " " }),
      node("e1", "experiment", "s1", { text: "" }),
      node("e3", "experiment", "s1", { text: "Fake-door test" }),
    ];
    expect(
      step("opportunity-tree", { opportunityTrees: trees(blank) }, "opportunity-tree-test")
    ).toEqual({
      id: "opportunity-tree-test",
      label: "Test “Fake-door test” as a hypothesis",
      detail:
        "It sits under your target opportunity “Node p1” and hasn't been tested yet. “Test as a hypothesis” on it sends it to the Hypothesis Tracker.",
      href: "/opportunity-tree",
    });
    expect(
      ids("opportunity-tree", { opportunityTrees: trees(blank.filter((n) => n.id !== "e3")) })
    ).toEqual([]);
    // A blank experiment under a named solution believes the solution: testable.
    const underNamed = TREE.map((n) => (n.id === "e1" ? { ...n, text: "" } : n));
    expect(
      step("opportunity-tree", { opportunityTrees: trees(underNamed) }, "opportunity-tree-test")
        ?.label
    ).toBe("Test “Untitled experiment” as a hypothesis");
  });

  it("reads a result from the last month, not an older one", () => {
    const tested = TREE.map((n) =>
      n.id === "e1" ? { ...n, sentTo: [link("hypothesis", "h1")] } : n
    );
    const ws = (resolvedAt: string) => ({
      opportunityTrees: trees(tested),
      hypothesisTrackers: trackers([hypothesis("h1", { status: "invalidated", resolvedAt })]),
    });
    expect(steps("opportunity-tree", ws("2026-10-20"))).toEqual([
      {
        id: "opportunity-tree-result",
        label: "See what the test of “Node e1” found",
        detail:
          "Its hypothesis came back invalidated: prune the solution it tested, or try another for the same opportunity.",
        href: "/hypothesis-tracker",
      },
    ]);
    expect(ids("opportunity-tree", ws("2026-08-01"))).toEqual([]);
  });

  it("asks to pick a target where an outcome has a choice of opportunities", () => {
    const nodes = [
      ...TREE,
      node("o2", "outcome", null),
      node("p3", "opportunity", "o2"),
      node("p4", "opportunity", "p3"),
    ];
    expect(
      step("opportunity-tree", { opportunityTrees: trees(nodes) }, "opportunity-tree-target")
    ).toEqual({
      id: "opportunity-tree-target",
      label: "Pick the opportunity to pursue for “Node o2”",
      detail:
        "2 opportunities sit under it and none is the target yet. Mark the one to work on as the target: its solutions and experiments come next.",
      href: "/opportunity-tree",
    });
    // One opportunity is no choice to make.
    expect(
      ids("opportunity-tree", {
        opportunityTrees: trees([node("o2", "outcome", null), node("p3", "opportunity", "o2")]),
      })
    ).toEqual([]);
  });

  it("ignores example nodes", () => {
    const nodes = TREE.map((n) => ({
      ...n,
      id: `example-${n.id}`,
      parentId: n.parentId && `example-${n.parentId}`,
    }));
    expect(steps("opportunity-tree", { opportunityTrees: trees(nodes) })).toEqual([]);
  });
});

describe("user-interviews", () => {
  const interview = (id: string, participant: string, tags: string[][]): Interview => ({
    id,
    date: "2026-10-10",
    participant,
    quotes: tags.map((t, k) => ({ id: `${id}-q${k}`, text: `Quote ${k}`, tags: t })),
  });
  const logs = (interviews: Interview[]) => [{ id: "userInterviewLog:current", interviews }];
  const LOG = [
    interview("i1", "Ana", [["Onboarding"], ["pricing"]]),
    interview("i2", "Bo", [["onboarding "]]),
    interview("i3", "Cy", [["onboarding", "pricing"]]),
  ];

  it("turns a theme three participants raised into an opportunity", () => {
    expect(steps("user-interviews", { userInterviewLogs: logs(LOG) })).toEqual([
      {
        id: "user-interviews-opportunity",
        label: "Turn the “onboarding” theme into an opportunity",
        detail:
          "3 of 3 participants raised it. “Raise as an opportunity” on one of its quotes puts it on the Opportunity Tree.",
        href: "/user-interviews",
      },
    ]);
  });

  it("counts participants, not quotes, and skips a theme already on the tree", () => {
    // One person saying it three times is one voice.
    const one = [interview("i1", "Ana", [["pricing"], ["pricing"], ["pricing"]])];
    expect(ids("user-interviews", { userInterviewLogs: logs(one) })).toEqual([]);
    const sent = LOG.map((i) =>
      i.id === "i2"
        ? { ...i, quotes: i.quotes.map((q) => ({ ...q, sentTo: [link("opportunity", "p1")] })) }
        : i
    );
    const tree = [
      {
        id: "opportunityTree:current",
        nodes: [{ id: "p1", kind: "opportunity" as const, text: "", parentId: null }],
      },
    ];
    expect(
      ids("user-interviews", { userInterviewLogs: logs(sent), opportunityTrees: tree })
    ).toEqual([]);
    // Its opportunity was deleted from the tree: the theme can go again.
    expect(ids("user-interviews", { userInterviewLogs: logs(sent), opportunityTrees: [] })).toEqual(
      ["user-interviews-opportunity"]
    );
  });

  it("ignores example interviews", () => {
    const examples = LOG.map((i) => ({ ...i, id: `example-${i.id}` }));
    expect(steps("user-interviews", { userInterviewLogs: logs(examples) })).toEqual([]);
  });
});

describe("risk-register", () => {
  const risk = (id: string, over: Partial<Risk> = {}): Risk => ({
    id,
    title: `Risk ${id}`,
    probability: 3,
    impact: 3,
    status: "open",
    raisedAt: "2026-10-01",
    owner: "Ana",
    ...over,
  });
  const impediment = (id: string, over: Partial<Impediment> = {}): Impediment => ({
    id,
    title: id,
    severity: "medium",
    raisedAt: "2026-10-10",
    ...over,
  });

  it("closes a risk whose impediment is resolved", () => {
    const risks = [risk("r1", { sentTo: [link("impediment", "i1")] })];
    expect(
      steps("risk-register", {
        risks,
        impediments: [impediment("i1", { resolvedAt: "2026-10-22" })],
      })
    ).toEqual([
      {
        id: "risk-register-close",
        label: "Close the risk whose impediment is resolved",
        detail:
          "“Risk r1” was raised as an impediment that is resolved now, but the register still lists it as active. “Close the risk” on its row closes it here too.",
        href: "/risk-register",
      },
    ]);
    // Still open there, or the risk is closed already.
    expect(ids("risk-register", { risks, impediments: [impediment("i1")] })).toEqual([]);
    expect(
      ids("risk-register", {
        risks: [risk("r1", { status: "closed", sentTo: [link("impediment", "i1")] })],
        impediments: [impediment("i1", { resolvedAt: "2026-10-22" })],
      })
    ).toEqual([]);
  });

  it("takes overdue mitigations to the retro, most overdue first", () => {
    const risks = [
      risk("r1", { mitigationDueAt: "2026-10-24" }),
      risk("r2", { mitigationDueAt: "2026-10-17" }),
      // Due today isn't overdue; an accepted risk has nothing to mitigate.
      risk("r3", { mitigationDueAt: TODAY }),
      risk("r4", { mitigationDueAt: "2026-10-01", status: "accepted" }),
    ];
    expect(steps("risk-register", { risks })).toEqual([
      {
        id: "risk-register-overdue",
        label: "Raise the 2 overdue mitigations at the retro",
        detail:
          "The mitigation for “Risk r2” is 9 days past due, and 1 other is overdue too. Ask what got in the way, then re-plan it or give it a new date.",
        href: "/retro",
      },
    ]);
  });

  it("gives the high and critical risks an owner", () => {
    const risks = [
      risk("r1", { probability: 4, impact: 3, owner: undefined }),
      risk("r2", { probability: 4, impact: 4, owner: " " }),
      // Medium (3 × 3): not high.
      risk("r3", { owner: undefined }),
    ];
    expect(steps("risk-register", { risks })).toEqual([
      {
        id: "risk-register-owner",
        label: "Give the 2 high risks an owner",
        detail:
          "2 high or critical risks have no owner, starting with “Risk r2” at 16 (critical). Name who watches each one and acts on its plan.",
        href: "/risk-register",
      },
    ]);
  });

  it("ignores example risks", () => {
    const risks = [
      risk("example-r1", {
        mitigationDueAt: "2026-10-01",
        probability: 5,
        impact: 5,
        owner: undefined,
      }),
    ];
    expect(steps("risk-register", { risks, impediments: [] })).toEqual([]);
  });
});

describe("tech-debt", () => {
  const debt = (id: string, over: Partial<TechDebtItem> = {}): TechDebtItem => ({
    id,
    title: `Debt ${id}`,
    impact: 3,
    effort: 2,
    raisedAt: "2026-09-01",
    ...over,
  });
  const cadence = (sprintLengthDays: number): CeremonyCadenceDoc[] => [
    { id: CEREMONY_CADENCE_ID, ...DEFAULT_CADENCE, sprintLengthDays },
  ];

  it("marks debt resolved once its backlog story is done", () => {
    const techDebt = [debt("d1", { sentTo: [link("backlog-story", "st1")] })];
    expect(steps("tech-debt", { techDebt, stories: [story("st1", { status: "done" })] })).toEqual([
      {
        id: "tech-debt-resolve",
        label: "Mark the paid-down debt resolved",
        detail:
          "“Debt d1” has a done backlog story but is still open here. “Mark resolved” on its row records the day it was paid down.",
        href: "/tech-debt",
      },
    ]);
  });

  it("plans the debt stories waiting on the backlog into the next sprint", () => {
    const techDebt = [debt("d1", { impact: 5, sentTo: [link("backlog-story", "st1")] })];
    const stories = [
      story("st1", { title: "Pay down d1", sourceRef: { tool: "tech-debt", id: "d1" } }),
      // Planned already, or for an item paid down since.
      story("st2", { sourceRef: { tool: "tech-debt", id: "d1" }, sprintId: "s3", status: "todo" }),
      story("st3", { sourceRef: { tool: "tech-debt", id: "gone" } }),
    ];
    expect(steps("tech-debt", { techDebt, stories, sprints: [sprint(), PLANNED] })).toEqual([
      {
        id: "tech-debt-plan",
        label: "Plan the debt story into a sprint",
        detail:
          "“Pay down d1” waits on the backlog with no sprint. Debt gets paid down once it has a slot in a sprint, like any other work.",
        href: "/sprint-planning?sprint=s3",
      },
    ]);
  });

  it("puts the top item on the backlog, aged in the team's sprints", () => {
    const techDebt = [debt("d1"), debt("d2", { impact: 5, effort: 1 })];
    expect(steps("tech-debt", { techDebt })).toEqual([
      {
        id: "tech-debt-backlog",
        label: "Put the top debt item on the backlog",
        detail:
          "“Debt d2” scores 19 and is ≈ 3 sprints old (14-day sprints): the highest of the open items. “Add to backlog” on its row makes a story to pay it down.",
        href: "/tech-debt",
      },
    ]);
    // A week-long sprint ages it faster, and the interest is capped.
    const fast = [debt("d2", { impact: 5, effort: 1, interestRate: 2 })];
    expect(
      step("tech-debt", { techDebt: fast, ceremonyCadences: cadence(7) }, "tech-debt-backlog")
        ?.detail
    ).toContain("scores 29 (interest capped) and is ≈ 7 sprints old (7-day sprints)");
  });

  it("asks to name an untitled top item before it goes on the backlog", () => {
    // Its row disables "Add to backlog" while the title is blank.
    const techDebt = [debt("d1"), debt("d2", { title: "  ", impact: 5, effort: 1 })];
    expect(step("tech-debt", { techDebt }, "tech-debt-backlog")?.detail).toBe(
      "The untitled item scores 19 and is ≈ 3 sprints old (14-day sprints): the highest of the open items. Give it a title on its row, then “Add to backlog” makes a story to pay it down."
    );
  });

  it("ignores example items and resolved ones", () => {
    const techDebt = [debt("example-d1", { impact: 5 }), debt("d2", { resolvedAt: "2026-10-01" })];
    expect(steps("tech-debt", { techDebt })).toEqual([]);
  });
});

const flaky = (id: string, over: Partial<FlakyTest> = {}): FlakyTest => ({
  id,
  name: `test ${id}`,
  failureRate: 0.1,
  failures: 2,
  runs: 20,
  status: "active",
  firstSeenAt: "2026-09-01",
  ...over,
});
const boards = (tests: FlakyTest[]) => [{ id: "flakyTestBoard:current", tests }];
const pyramid = (
  unit: number,
  integration: number,
  e2e: number,
  over: Partial<TestPyramid> = {}
) => [{ id: "testPyramid:current", unit, integration, e2e, ...over }];

describe("quality-cost", () => {
  it("reads the flaky tests and the test pyramid, its own figures being a blob", () => {
    expect(
      steps("quality-cost", {
        flakyTestBoards: boards([flaky("f1"), flaky("f2", { status: "fixed" })]),
        testPyramids: pyramid(10, 20, 70),
      })
    ).toEqual([
      {
        id: "quality-cost-flaky",
        label: "See what the flaky tests cost",
        detail:
          "1 flaky test is open, failing 10% of its runs. Its reruns and triage time are internal failure cost: count the hours × rate in this quarter's figures.",
        href: "/flaky-tests",
      },
      {
        id: "quality-cost-pyramid",
        label: "Check the test pyramid's shape",
        detail:
          "The suite is an ice-cream cone: slow end-to-end checks are detection cost that unit tests cover for less.",
        href: "/test-pyramid",
      },
    ]);
  });

  it("stays quiet with no open flaky test and a pyramid-shaped suite", () => {
    expect(
      ids("quality-cost", {
        flakyTestBoards: boards([flaky("f1", { status: "fixed" }), flaky("example-f2")]),
        testPyramids: pyramid(70, 20, 10),
      })
    ).toEqual([]);
    expect(ids("quality-cost", {})).toEqual([]);
  });
});

describe("test-pyramid", () => {
  it("sends a top-heavy suite with open flaky tests to triage them", () => {
    expect(
      steps("test-pyramid", {
        testPyramids: pyramid(10, 20, 70),
        flakyTestBoards: boards([flaky("f1")]),
      })
    ).toEqual([
      {
        id: "test-pyramid-flaky",
        label: "Triage the flaky tests in a top-heavy suite",
        detail:
          "The suite is an ice-cream cone and 1 flaky test is open. End-to-end tests are the slowest and flakiest layer: look there first.",
        href: "/flaky-tests",
      },
    ]);
  });

  it("raises an hourglass at the retro when nothing is flaky", () => {
    expect(
      steps("test-pyramid", {
        testPyramids: pyramid(45, 10, 45),
        flakyTestBoards: boards([flaky("example-f1")]),
      })
    ).toEqual([
      {
        id: "test-pyramid-retro",
        label: "Raise the suite's shape at the retro",
        detail:
          "Hourglass: 45% unit, 10% integration, 45% e2e. The middle layer is thin. Agree which end-to-end checks could move down to unit or integration tests.",
        href: "/retro",
      },
    ]);
  });

  it("reads the shape the way the page weighs it", () => {
    expect(ids("test-pyramid", { testPyramids: pyramid(70, 20, 10) })).toEqual([]);
    // By run time, a count-shaped pyramid can be a cone.
    const timed = pyramid(70, 20, 10, {
      weighting: "runtime",
      runtime: { unit: 2, integration: 3, e2e: 30 },
    });
    expect(ids("test-pyramid", { testPyramids: timed })).toEqual(["test-pyramid-retro"]);
    expect(ids("test-pyramid", {})).toEqual([]);
  });
});

describe("flaky-tests", () => {
  it("plans fixes for tests quarantined two weeks or more into the next sprint", () => {
    const flakyTestBoards = boards([
      flaky("f1", { status: "quarantined", quarantinedAt: "2026-10-01" }),
      flaky("f2", { status: "quarantined", quarantinedAt: "2026-10-12" }),
      // In quarantine six days, or fixed: not yet, and not any more.
      flaky("f3", { status: "quarantined", quarantinedAt: "2026-10-20" }),
    ]);
    expect(
      steps("flaky-tests", {
        flakyTestBoards,
        testPyramids: pyramid(70, 20, 10),
        sprints: [sprint(), PLANNED],
      })
    ).toEqual([
      {
        id: "flaky-tests-quarantine",
        label: "Plan fixes for the 2 tests quarantined 14+ days",
        detail:
          "“test f1” has been in quarantine 25 days, the longest of the 2. A quarantined test still hides a bug: give its fix a slot in the next sprint.",
        href: "/sprint-planning?sprint=s3",
      },
    ]);
  });

  it("checks the suite's shape behind three or more open flaky tests", () => {
    const three = boards([flaky("f1"), flaky("f2"), flaky("f3", { status: "quarantined" })]);
    expect(steps("flaky-tests", { flakyTestBoards: three })).toEqual([
      {
        id: "flaky-tests-pyramid",
        label: "Check the test pyramid behind the flaky tests",
        detail:
          "3 flaky tests are open. A suite heavy on end-to-end tests flakes more: count each layer's tests to see its shape.",
        href: "/test-pyramid",
      },
    ]);
    // Counted already, or too few to point at the suite.
    expect(
      ids("flaky-tests", { flakyTestBoards: three, testPyramids: pyramid(70, 20, 10) })
    ).toEqual([]);
    expect(ids("flaky-tests", { flakyTestBoards: boards([flaky("f1"), flaky("f2")]) })).toEqual([]);
  });

  it("ignores example tests", () => {
    const flakyTestBoards = boards([
      flaky("example-f1", { status: "quarantined", quarantinedAt: "2026-09-01" }),
      flaky("example-f2"),
      flaky("example-f3"),
    ]);
    expect(steps("flaky-tests", { flakyTestBoards })).toEqual([]);
  });
});

describe("code-review-metrics", () => {
  const pr = (id: string, over: Partial<PrSample> = {}): PrSample => ({
    id,
    author: "Ana",
    openedAt: "2026-10-05T10:00",
    firstReviewAt: "2026-10-05T12:00",
    mergedAt: "2026-10-07T10:00",
    reviewerCount: 1,
    commentCount: 2,
    linesChanged: 80,
    ...over,
  });
  const logs = (
    samples: PrSample[],
    over: Partial<{ workingWindow: { start: string; end: string } }> = {}
  ) => [{ id: "codeReviewLog:current", samples, ...over }];
  // Opened Monday 10:00, first review Tuesday 12:00: 26 working hours of whole days.
  const slow = (id: string) => pr(id, { firstReviewAt: "2026-10-06T12:00" });

  it("agrees a review turnaround when half the PRs wait over a working day", () => {
    expect(
      steps("code-review-metrics", { codeReviewLogs: logs([slow("p1"), slow("p2"), slow("p3")]) })
    ).toEqual([
      {
        id: "code-review-turnaround",
        label: "Agree a review turnaround",
        detail:
          "Half of pull requests wait 26 working hours or more for a first review (Mon–Fri, whole days), over a working day. Agree in the working agreement how soon a review starts.",
        href: "/working-agreement",
      },
    ]);
    // Reviewed the same day, or too few PRs for a median.
    expect(
      ids("code-review-metrics", { codeReviewLogs: logs([pr("p1"), pr("p2"), pr("p3")]) })
    ).toEqual([]);
    expect(ids("code-review-metrics", { codeReviewLogs: logs([slow("p1"), slow("p2")]) })).toEqual(
      []
    );
  });

  it("counts a working day as the team's working window when it has one", () => {
    const window = { workingWindow: { start: "09:00", end: "17:00" } };
    // 10:00–17:00 Monday and 09:00–12:00 Tuesday: 10 hours, over the window's 8.
    expect(
      step(
        "code-review-metrics",
        { codeReviewLogs: logs([slow("p1"), slow("p2"), slow("p3")], window) },
        "code-review-turnaround"
      )?.detail
    ).toContain("wait 10 working hours or more for a first review (Mon–Fri, 09:00–17:00)");
    // 7 of the window's 8 hours: within a working day.
    const sameDay = (id: string) =>
      pr(id, { openedAt: "2026-10-05T09:00", firstReviewAt: "2026-10-05T16:00" });
    expect(
      ids("code-review-metrics", {
        codeReviewLogs: logs([sameDay("p1"), sameDay("p2"), sameDay("p3")], window),
      })
    ).toEqual([]);
  });

  it("talks about PR size when a large PR merged without a comment", () => {
    const samples = [pr("p1", { linesChanged: 520, commentCount: 0 }), pr("p2")];
    expect(steps("code-review-metrics", { codeReviewLogs: logs(samples) })).toEqual([
      {
        id: "code-review-pr-size",
        label: "Talk about PR size at the retro",
        detail:
          "1 large pull request (over 400 lines) merged with no review comment. Agree how to keep changes small enough to review well.",
        href: "/retro",
      },
    ]);
  });

  it("talks about PR size once a quarter of five or more PRs are large", () => {
    const samples = [
      pr("p1", { linesChanged: 600 }),
      pr("p2", { linesChanged: 450 }),
      pr("p3"),
      pr("p4"),
      pr("p5"),
    ];
    expect(
      step("code-review-metrics", { codeReviewLogs: logs(samples) }, "code-review-pr-size")?.detail
    ).toMatch(/^40% of pull requests are over 400 lines\./);
    expect(ids("code-review-metrics", { codeReviewLogs: logs(samples.slice(0, 4)) })).toEqual([]);
  });

  it("ignores example PRs", () => {
    const samples = [
      pr("example-p1", { linesChanged: 900, commentCount: 0 }),
      slow("example-p2"),
      slow("example-p3"),
      slow("example-p4"),
    ];
    expect(steps("code-review-metrics", { codeReviewLogs: logs(samples) })).toEqual([]);
  });
});

describe("every Outcomes, quality & library step", () => {
  // Runs last: `seen` holds every href the tests above produced.
  it("links to a page that exists", () => {
    expect(seen.size).toBeGreaterThan(10);
    const app = path.resolve(__dirname, "../../src/app");
    // A route lives at app/<segment> or inside a route group, app/(group)/<segment>.
    const roots = [
      app,
      ...readdirSync(app)
        .filter((d) => /^\(.+\)$/.test(d))
        .map((d) => path.join(app, d)),
    ];
    for (const href of Array.from(seen)) {
      const segment = href.split(/[?#]/)[0].replace(/^\//, "");
      const page = roots.some((root) => existsSync(path.join(root, segment, "page.tsx")));
      expect(page, href).toBe(true);
    }
  });
});
