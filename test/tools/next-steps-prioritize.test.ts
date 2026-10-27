import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { getNextStepRule, type NextStep } from "@/lib/tools/next-steps";
import type {
  AllocationRound,
  BacklogItem,
  BuyAFeatureGame,
  CynefinItem,
  DACIDecision,
  Decision,
  HandoffLink,
  Hypothesis,
  PrioritizationItem,
  Sprint,
  Story,
  WeightedCriterion,
  WeightedMatrix,
  WeightedOption,
  Workspace,
} from "@/lib/stores/workspace-types";
import { BUY_A_FEATURE_ID, DEFAULT_WEIGHTED_MATRIX_ID } from "@/lib/stores/workspace-types";

/**
 * Next steps for the Prioritize & decide tools (Phase 7): each reads the
 * workspace through the method registry and the tools' own models (rows
 * read through to their backlog items, as the tools show them), points
 * somewhere real, ignores example rows, and stays quiet when nothing
 * applies.
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

// Monday 26 Oct 2026.
const TODAY = "2026-10-26";
const STAMP = "2026-10-20T09:00:00.000Z";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${TODAY}T09:00:00`));
});
afterEach(() => vi.useRealTimers());

/** A backlog item saved by the new code (so no value reads as an old default). */
const item = (id: string, over: Partial<BacklogItem> = {}): BacklogItem => ({
  id,
  name: id,
  updatedAt: STAMP,
  ...over,
});
const WSJF_PARTS = { businessValue: 8, timeCriticality: 5, riskReduction: 3, jobSize: 2 };
const row = (
  id: string,
  framework: PrioritizationItem["framework"],
  fields: PrioritizationItem["fields"] = {},
  over: Partial<PrioritizationItem> = {}
): PrioritizationItem => ({ id, framework, title: id, fields, updatedAt: STAMP, ...over });
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
const sprint = (id: string, status: Sprint["status"], startDate: string): Sprint => ({
  id,
  name: `Sprint ${id.slice(1)}`,
  startDate,
  endDate: startDate,
  pointsPlanned: 0,
  status,
});
// Sprint 7 is running; 8 is the next to plan, 9 the one after.
const SPRINTS = [
  sprint("s7", "active", "2026-10-19"),
  sprint("s9", "planned", "2026-11-16"),
  sprint("s8", "planned", "2026-11-02"),
];
/** The backlog seed older builds wrote to every new backlog: the hub clears it as example. */
const SEED = ["auth", "search", "export", "billing", "onboarding"].map((key) =>
  item(`default:item-${key}`, {
    ...WSJF_PARTS,
    reach: 500,
    reachPeriod: "quarter",
    impact: 2,
    confidence: 50,
    effort: 2,
    moscow: "must",
    matrixEffort: 2,
  })
);

describe("prioritizer", () => {
  it("scores the items with no WSJF or RICE score first, opening WSJF on the first", () => {
    const out = steps("prioritizer", {
      backlogItems: [item("a"), item("b", WSJF_PARTS)],
      prioritizations: [],
      stories: [],
    });
    expect(out[0]).toMatchObject({
      id: "prioritizer-score",
      label: "Score 1 item with WSJF",
      href: "/wsjf?backlogItem=a",
    });
  });

  it("reads old default values as not scored", () => {
    // Every WSJF part still at the pre-Phase 7 default, never saved since.
    const legacy: BacklogItem = {
      id: "old",
      name: "Old",
      ...{ businessValue: 5, timeCriticality: 5, riskReduction: 5, jobSize: 5 },
    };
    expect(ids("prioritizer", { backlogItems: [legacy] })).toEqual(["prioritizer-score"]);
  });

  it("asks to decide the order for scored items without a rank", () => {
    const ws = {
      backlogItems: [item("a", WSJF_PARTS), item("b", { ...WSJF_PARTS, jobSize: 5 })],
      stories: [],
    };
    expect(steps("prioritizer", ws)).toEqual([
      expect.objectContaining({
        id: "prioritizer-decide-order",
        detail: expect.stringContaining("2 scored items aren't in the backlog order yet"),
        href: "/prioritizer?open=decide-order",
      }),
    ]);
    // A method ranks nothing below 2 scored items.
    expect(
      ids("prioritizer", { backlogItems: [item("a", WSJF_PARTS), item("b", { moscow: "must" })] })
    ).not.toContain("prioritizer-decide-order");
  });

  it("imports ranked items no story was pulled from or named after", () => {
    const backlogItems = [
      item("a", { ...WSJF_PARTS, rank: 1 }),
      item("Search", { ...WSJF_PARTS, rank: 2 }),
      item("c", { ...WSJF_PARTS, rank: 3 }),
    ];
    const pulled = story("s1", { title: "A story", sourceRef: { tool: "prioritizer", id: "a" } });
    const named = story("s2", { title: "search " });
    expect(
      steps("prioritizer", { backlogItems, stories: [pulled, named] }).map((s) => [
        s.id,
        s.label,
        s.href,
      ])
    ).toEqual([
      ["prioritizer-import", "Import 1 ordered item into Sprint Planning", "/sprint-planning"],
    ]);
    const all = [pulled, named, story("s3", { sourceRef: { tool: "prioritizer", id: "c" } })];
    expect(steps("prioritizer", { backlogItems, stories: all })).toEqual([]);
  });

  it("ignores example items, and the old seed the hub clears as example", () => {
    expect(steps("prioritizer", { backlogItems: [item("example-a")], stories: [] })).toEqual([]);
    // Scored in WSJF, RICE and MoSCoW and not ordered: no Decide order step.
    expect(steps("prioritizer", { backlogItems: SEED, stories: [] })).toEqual([]);
    // Ordered: nothing to import either.
    const ranked = SEED.map((b, i) => ({ ...b, rank: i + 1 }));
    expect(steps("prioritizer", { backlogItems: ranked, stories: [] })).toEqual([]);
    // Next to the team's own items, the seed isn't counted.
    expect(steps("prioritizer", { backlogItems: [...SEED, item("Mine")], stories: [] })).toEqual([
      expect.objectContaining({ id: "prioritizer-score", label: "Score 1 item with WSJF" }),
    ]);
  });
});

describe("rice-scoring", () => {
  const rice = (id: string, confidence: number, over: Partial<PrioritizationItem> = {}) =>
    row(
      id,
      "rice",
      { reach: 1000, reachPeriod: "quarter", impact: 2, confidence, effort: 1 },
      over
    );

  it("tests a front-runner with low confidence before building", () => {
    const out = steps("rice-scoring", {
      prioritizations: [
        rice("Guess", 50),
        row("Sure", "rice", { reach: 100, impact: 1, confidence: 100, effort: 1 }),
      ],
    });
    expect(out).toEqual([
      {
        id: "rice-test-front-runner",
        label: "Test the front-runner before building",
        detail:
          "“Guess” leads on RICE at only 50% confidence. Write it up as a hypothesis and test it first.",
        href: "/hypothesis-tracker",
      },
    ]);
    expect(steps("rice-scoring", { prioritizations: [rice("Sure", 80)] })).toEqual([]);
  });

  it("checks every row tied for the lead, as the page's verdict does", () => {
    // Both score 1,600 a quarter; the second one in the list is the guess.
    const sure = rice("Sure", 80);
    const guess = row("Guess", "rice", {
      reach: 1600,
      reachPeriod: "quarter",
      impact: 2,
      confidence: 50,
      effort: 1,
    });
    expect(steps("rice-scoring", { prioritizations: [sure, guess] })).toEqual([
      expect.objectContaining({
        id: "rice-test-front-runner",
        detail:
          "“Guess” ties for the lead on RICE at only 50% confidence. Write it up as a hypothesis and test it first.",
      }),
    ]);
    // The least sure of two shaky leaders.
    const guesses = [
      rice("Hunch", 50),
      row("Wild", "rice", {
        reach: 2000,
        reachPeriod: "quarter",
        impact: 2,
        confidence: 25,
        effort: 1,
      }),
    ];
    expect(
      step("rice-scoring", { prioritizations: guesses }, "rice-test-front-runner")?.detail
    ).toMatch(/^“Wild” ties for the lead on RICE at only 25% confidence/);
  });

  it("compares across methods once a row is on the backlog, read through to its item", () => {
    const linked = rice("Linked", 100, { backlogItemId: "i1" });
    const i1 = item("i1", {
      reach: 10,
      reachPeriod: "quarter",
      impact: 1,
      confidence: 100,
      effort: 1,
    });
    expect(ids("rice-scoring", { prioritizations: [linked], backlogItems: [i1] })).toEqual([
      "rice-compare",
    ]);
    // The item's 50% confidence is what the row shows.
    const unsure = { ...i1, confidence: 50 };
    expect(ids("rice-scoring", { prioritizations: [linked], backlogItems: [unsure] })).toEqual([
      "rice-test-front-runner",
      "rice-compare",
    ]);
    // A link to a deleted item isn't on the backlog.
    expect(ids("rice-scoring", { prioritizations: [linked], backlogItems: [] })).toEqual([]);
  });

  it("ignores example rows", () => {
    expect(steps("rice-scoring", { prioritizations: [rice("example-r1", 50)] })).toEqual([]);
  });
});

describe("wsjf", () => {
  const wsjf = (id: string, over: Partial<PrioritizationItem> = {}) =>
    row(id, "wsjf", { businessValue: 8, timeCriticality: 5, rrOe: 3, jobSize: 2 }, over);

  it("decides the order once two scored items on the backlog have no rank", () => {
    const backlogItems = [item("a", WSJF_PARTS), item("b", { ...WSJF_PARTS, rank: 1 })];
    const prioritizations = [wsjf("A", { backlogItemId: "a" }), wsjf("B", { backlogItemId: "b" })];
    expect(steps("wsjf", { prioritizations, backlogItems })).toEqual([
      expect.objectContaining({
        id: "wsjf-decide-order",
        detail: expect.stringContaining("1 scored feature has no place in the backlog order yet"),
        href: "/prioritizer?open=decide-order",
      }),
    ]);
    const ranked = [item("a", { ...WSJF_PARTS, rank: 2 }), backlogItems[1]];
    expect(steps("wsjf", { prioritizations, backlogItems: ranked })).toEqual([]);
    expect(steps("wsjf", { prioritizations: [prioritizations[0]], backlogItems })).toEqual([]);
  });

  it("puts the top features on the backlog when none is there", () => {
    const prioritizations = [wsjf("A"), wsjf("B"), wsjf("C"), row("Untitled", "wsjf")];
    expect(steps("wsjf", { prioritizations, backlogItems: [] })).toEqual([
      expect.objectContaining({
        id: "wsjf-backlog",
        detail: expect.stringContaining("3 features are scored and none is on the backlog"),
        href: "/wsjf",
      }),
    ]);
    expect(steps("wsjf", { prioritizations: prioritizations.slice(1) })).toEqual([]);
  });

  it("ignores example rows", () => {
    const rows = ["example-1", "example-2", "example-3"].map((id) => wsjf(id));
    expect(steps("wsjf", { prioritizations: rows })).toEqual([]);
  });
});

describe("moscow", () => {
  const moscow = (
    id: string,
    bucket: string,
    effort?: number,
    over: Partial<PrioritizationItem> = {}
  ) => row(id, "moscow", effort === undefined ? { bucket } : { bucket, effort }, over);

  it("orders the Musts with WSJF when they take over 60% of the planned effort", () => {
    const prioritizations = [
      moscow("A", "must", 8),
      moscow("B", "must", 5),
      moscow("C", "should", 2),
      moscow("D", "could", 1),
      moscow("E", "wont", 20),
    ];
    expect(steps("moscow", { prioritizations, backlogItems: [] })).toEqual([
      expect.objectContaining({
        id: "moscow-over-budget",
        detail: expect.stringContaining("Musts take 81% of the planned effort"),
        href: "/wsjf",
      }),
    ]);
    const within = [moscow("A", "must", 2), moscow("C", "should", 5), moscow("D", "could", 5)];
    expect(steps("moscow", { prioritizations: within })).toEqual([]);
    // Too few sized items to say.
    expect(steps("moscow", { prioritizations: prioritizations.slice(0, 2) })).toEqual([]);
  });

  it("sizes the planned backlog items that have no job size", () => {
    const prioritizations = [
      moscow("Linked", "should", undefined, { backlogItemId: "i1" }),
      moscow("Own", "must"),
      moscow("Dropped", "wont", undefined, { backlogItemId: "i2" }),
    ];
    // The linked row reads its bucket from the item: a Must with no job size.
    const backlogItems = [item("i1", { moscow: "must" }), item("i2", { moscow: "wont" })];
    expect(steps("moscow", { prioritizations, backlogItems })).toEqual([
      expect.objectContaining({
        id: "moscow-size",
        detail: expect.stringContaining("1 planned backlog item has no job size"),
        href: "/prioritizer",
      }),
    ]);
    const sized = [item("i1", { moscow: "must", jobSize: 3 }), backlogItems[1]];
    expect(steps("moscow", { prioritizations, backlogItems: sized })).toEqual([]);
  });

  it("ignores example rows", () => {
    const rows = ["example-a", "example-b", "example-c"].map((id) => moscow(id, "must", 5));
    expect(steps("moscow", { prioritizations: rows })).toEqual([]);
  });
});

describe("cost-of-delay", () => {
  const cod = (id: string, fields: PrioritizationItem["fields"]) =>
    row(id, "cost-of-delay", fields);
  const fixed = (id: string, fixedDate: string) =>
    cod(id, { perWeekUsd: 1000, durationWeeks: 2, urgency: "fixed_date", fixedDate });

  it("plans fixed-date work whose latest start is within two weeks", () => {
    expect(
      step("cost-of-delay", { prioritizations: [fixed("Audit", "2026-11-20")] }, "cod-fixed-date")
    ).toEqual({
      id: "cod-fixed-date",
      label: "Plan the fixed-date work now",
      detail: "“Audit” must start by 6 Nov to land by 20 Nov. Pull it into the next sprint.",
      href: "/sprint-planning",
    });
    expect(
      step("cost-of-delay", { prioritizations: [fixed("Late", "2026-11-01")] }, "cod-fixed-date")
        ?.detail
    ).toBe(
      "“Late” should have started by 18 Oct to land by 1 Nov: it's already late. Pull it into the next sprint, or agree a new date."
    );
    expect(ids("cost-of-delay", { prioritizations: [fixed("Later", "2027-01-30")] })).toEqual([]);
  });

  it("links to the next sprint to plan, by name", () => {
    expect(
      step(
        "cost-of-delay",
        { prioritizations: [fixed("Audit", "2026-11-20")], sprints: SPRINTS },
        "cod-fixed-date"
      )
    ).toMatchObject({
      detail: "“Audit” must start by 6 Nov to land by 20 Nov. Pull it into Sprint 8.",
      href: "/sprint-planning?sprint=s8",
    });
  });

  it("stops once a story for the work is planned into a sprint or done", () => {
    const audit = fixed("Audit", "2026-11-20");
    const linked = { ...audit, title: "Q4 audit", backlogItemId: "i1" };
    const backlogItems = [item("i1", { name: "Compliance audit" })];
    const sprints = [...SPRINTS, sprint("s6", "completed", "2026-10-05")];
    const fires = (prioritizations: PrioritizationItem[], stories: Story[]) =>
      ids("cost-of-delay", { prioritizations, backlogItems, stories, sprints }).includes(
        "cod-fixed-date"
      );
    // Named like the row, in the next sprint or the running one, or done.
    expect(fires([audit], [story("s1", { title: " audit", sprintId: "s8" })])).toBe(false);
    expect(fires([audit], [story("s1", { title: "Audit", sprintId: "s7" })])).toBe(false);
    expect(fires([audit], [story("s1", { title: "Audit", status: "done" })])).toBe(false);
    // Pulled from the row's backlog item, or named like the item.
    const pulled = story("s1", { sprintId: "s8", sourceRef: { tool: "prioritizer", id: "i1" } });
    expect(fires([linked], [pulled])).toBe(false);
    expect(fires([linked], [story("s1", { title: "Compliance audit", sprintId: "s8" })])).toBe(
      false
    );
    // Still waiting: on the backlog, left in a closed sprint, or an example story.
    expect(fires([audit], [story("s1", { title: "Audit" })])).toBe(true);
    expect(fires([audit], [story("s1", { title: "Audit", sprintId: "s6" })])).toBe(true);
    expect(fires([audit], [story("example-s1", { title: "Audit", sprintId: "s8" })])).toBe(true);
    expect(fires([linked], [story("s1", { title: "Audit", sprintId: "s8" })])).toBe(true);
  });

  it("cross-checks two scored items with WSJF, leaving legacy rows out", () => {
    const standard = cod("Std", { perWeekUsd: 500, durationWeeks: 1, urgency: "standard" });
    const legacy = cod("Old", { perWeekUsd: 500, weeksDelayed: 4 });
    expect(ids("cost-of-delay", { prioritizations: [standard, legacy] })).toEqual([]);
    expect(
      steps("cost-of-delay", { prioritizations: [standard, fixed("Later", "2027-01-30")] })
    ).toEqual([expect.objectContaining({ id: "cod-wsjf", href: "/wsjf" })]);
  });

  it("ignores example rows", () => {
    expect(
      steps("cost-of-delay", {
        prioritizations: [fixed("example-a", "2026-11-01"), fixed("example-b", "2026-11-02")],
      })
    ).toEqual([]);
  });
});

describe("value-effort-matrix", () => {
  const ve = (id: string, value: number, effort: number, over: Partial<PrioritizationItem> = {}) =>
    row(id, "value-effort", { businessValue: value, effort }, over);

  it("plans the quick wins on the backlog that Sprint Planning hasn't pulled", () => {
    const prioritizations = [ve("Win", 1, 9, { backlogItemId: "i1" })];
    // Read through: the item holds a quick win's value and effort.
    const backlogItems = [item("i1", { businessValue: 8, matrixEffort: 2 })];
    expect(steps("value-effort-matrix", { prioritizations, backlogItems, stories: [] })).toEqual([
      expect.objectContaining({
        id: "value-effort-plan",
        detail: expect.stringContaining(
          "1 Quick Win is on the backlog and not in Sprint Planning yet"
        ),
        href: "/sprint-planning",
      }),
    ]);
    const pulled = story("s1", { sourceRef: { tool: "prioritizer", id: "i1" } });
    expect(
      steps("value-effort-matrix", { prioritizations, backlogItems, stories: [pulled] })
    ).toEqual([]);
    // With a sprint planned, the link opens the next one.
    expect(
      step(
        "value-effort-matrix",
        { prioritizations, backlogItems, stories: [], sprints: SPRINTS },
        "value-effort-plan"
      )
    ).toMatchObject({
      detail:
        "1 Quick Win is on the backlog and not in Sprint Planning yet. Pull it into Sprint 8.",
      href: "/sprint-planning?sprint=s8",
    });
  });

  it("puts quick wins on the backlog from their rows, and skips the rest", () => {
    const prioritizations = [
      ve("Win", 13, 3),
      ve("Gone", 8, 1, { backlogItemId: "deleted" }),
      ve("Big bet", 13, 8),
      ve("Fill-in", 3, 2),
    ];
    expect(steps("value-effort-matrix", { prioritizations, backlogItems: [] })).toEqual([
      expect.objectContaining({
        id: "value-effort-backlog",
        detail: expect.stringContaining("2 Quick Wins aren't on the backlog yet"),
        href: "/value-effort-matrix",
      }),
    ]);
  });

  it("ignores example rows", () => {
    expect(steps("value-effort-matrix", { prioritizations: [ve("example-a", 13, 1)] })).toEqual([]);
  });
});

describe("method rows linked to the old backlog seed", () => {
  // A row imported from a seed item reads the example's values, and its
  // tool shows it as on the backlog: like the seed, it's example data.
  const on = (key: string) => ({ backlogItemId: `default:item-${key}` });

  it("trigger no step", () => {
    const backlogItems = SEED;
    const wsjf = ["auth", "search", "export"].map((k) => row(k, "wsjf", {}, on(k)));
    expect(steps("wsjf", { prioritizations: wsjf, backlogItems })).toEqual([]);
    const rice = row("Auth", "rice", {}, on("auth"));
    expect(steps("rice-scoring", { prioritizations: [rice], backlogItems })).toEqual([]);
    const ve = row("Auth", "value-effort", {}, on("auth"));
    expect(
      steps("value-effort-matrix", { prioritizations: [ve], backlogItems, stories: [] })
    ).toEqual([]);
    const moscow = ["auth", "search", "export"].map((k) => row(k, "moscow", {}, on(k)));
    expect(steps("moscow", { prioritizations: moscow, backlogItems })).toEqual([]);
    const kano = row(
      "Auth",
      "kano",
      { functional: "neutral", dysfunctional: "dislike" },
      on("auth")
    );
    expect(steps("kano-model", { prioritizations: [kano], backlogItems })).toEqual([]);
  });

  it("count as the team's own once the seed is cleared", () => {
    // The link dangles: an ordinary row, scored from its own values.
    const kano = row(
      "Auth",
      "kano",
      { functional: "neutral", dysfunctional: "dislike" },
      on("auth")
    );
    expect(ids("kano-model", { prioritizations: [kano], backlogItems: [] })).toEqual([
      "kano-must-be",
    ]);
  });
});

describe("eisenhower", () => {
  const task = (id: string, fields: PrioritizationItem["fields"]) => row(id, "eisenhower", fields);

  it("raises the Do tasks due now at the standup, most overdue first", () => {
    const prioritizations = [
      task("Today", { urgent: "false", important: "true", dueAt: TODAY }),
      task("Invoices", { urgent: "true", important: "true", dueAt: "2026-10-24" }),
      task("Later", { urgent: "false", important: "true", dueAt: "2026-11-20" }),
    ];
    expect(steps("eisenhower", { prioritizations, teamMembers: [] })).toEqual([
      {
        id: "eisenhower-due",
        label: "Raise the 2 Do tasks due now at the standup",
        detail:
          "“Invoices” is 2 days overdue, and 1 other Do task is due or past due. Say at the Daily Scrum what they need to get done.",
        href: "/standup",
      },
    ]);
    expect(steps("eisenhower", { prioritizations: [prioritizations[0]] })[0]).toMatchObject({
      label: "Raise the Do task due now at the standup",
      detail: "“Today” is due today. Say at the Daily Scrum what it needs to get done.",
    });
  });

  it("asks who takes a Delegate task: the team first, then a name", () => {
    const prioritizations = [task("Expenses", { urgent: "true", important: "false" })];
    expect(steps("eisenhower", { prioritizations, teamMembers: [] })).toEqual([
      expect.objectContaining({ id: "eisenhower-team", href: "/team" }),
    ]);
    expect(
      steps("eisenhower", { prioritizations, teamMembers: [{ id: "m1", name: "Ana" }] })
    ).toEqual([
      expect.objectContaining({
        id: "eisenhower-delegate",
        label: "Name who takes the Delegate task",
        href: "/eisenhower",
      }),
    ]);
    const named = [task("Expenses", { urgent: "true", important: "false", delegateTo: "Ana" })];
    expect(steps("eisenhower", { prioritizations: named, teamMembers: [] })).toEqual([]);
  });

  it("reads a legacy quadrant first, as the page does", () => {
    // The old pane was Delegate, whatever the answers stored beside it say.
    const legacy = task("Old", {
      quadrant: "delegate",
      urgent: "true",
      important: "true",
      dueAt: "2026-10-25",
    });
    expect(ids("eisenhower", { prioritizations: [legacy], teamMembers: [] })).toEqual([
      "eisenhower-team",
    ]);
  });

  it("ignores example rows", () => {
    const rows = [task("example-a", { urgent: "true", important: "true", dueAt: "2026-10-01" })];
    expect(steps("eisenhower", { prioritizations: rows, teamMembers: [] })).toEqual([]);
  });
});

describe("kano-model", () => {
  // One person's answers: neutral if it's there, dislike if it isn't → Must-be.
  const mustBe = (id: string, over: Partial<PrioritizationItem> = {}) =>
    row(id, "kano", { functional: "neutral", dysfunctional: "dislike" }, over);

  it("puts the Must-be features on the backlog from their rows", () => {
    expect(steps("kano-model", { prioritizations: [mustBe("Login")], backlogItems: [] })).toEqual([
      {
        id: "kano-must-be",
        label: "Put the must-haves on the backlog",
        detail:
          "“Login” came out Must-be: customers expect it, and it isn't on the backlog yet. Add it from its row.",
        href: "/kano-model",
      },
    ]);
    // A category picked by hand, or too few counted answers, says nothing yet.
    const picked = row("Picked", "kano", { category: "must-be" });
    const few = row("Few", "kano", { kanoM: 2 });
    expect(steps("kano-model", { prioritizations: [picked, few], backlogItems: [] })).toEqual([]);
  });

  it("follows up contradictory answers, then compares linked features across methods", () => {
    const prioritizations = [
      row("Dark mode", "kano", { functional: "like", dysfunctional: "like" }),
      mustBe("Login", { backlogItemId: "i1" }),
    ];
    const out = steps("kano-model", { prioritizations, backlogItems: [item("i1")] });
    expect(out.map((s) => [s.id, s.href])).toEqual([
      ["kano-questionable", "/user-interviews"],
      ["kano-compare", "/prioritizer"],
    ]);
    expect(out[0].label).toBe("Find out why the answers on “Dark mode” contradict");
  });

  it("ignores example rows", () => {
    expect(
      steps("kano-model", { prioritizations: [mustBe("example-a")], backlogItems: [] })
    ).toEqual([]);
  });
});

describe("buy-a-feature", () => {
  const feature = (id: string, price: number, raised = 0, over: Partial<PrioritizationItem> = {}) =>
    row(id, "buy-feature", { price, raised }, over);
  const game = (budgetPerPlayer: number, players: number): BuyAFeatureGame => ({
    id: BUY_A_FEATURE_ID,
    budgetPerPlayer,
    players,
    updatedAt: STAMP,
  });

  it("pushes funded features with no live story to the backlog", () => {
    const ws = {
      prioritizations: [feature("Search", 100, 100), feature("Export", 200, 50)],
      buyAFeatureGames: [game(50, 4)],
      stories: [],
    };
    expect(steps("buy-a-feature", ws)).toEqual([
      expect.objectContaining({
        id: "buy-a-feature-push",
        detail: expect.stringContaining("“Add 1 funded feature to the backlog” under Funded"),
        href: "/buy-a-feature",
      }),
    ]);
    const sent = feature("Search", 100, 100, { sentTo: [link("backlog-story", "st1")] });
    expect(ids("buy-a-feature", { ...ws, prioritizations: [sent, ws.prioritizations[1]] })).toEqual(
      ["buy-a-feature-push"]
    );
    const live = {
      ...ws,
      prioritizations: [sent, ws.prioritizations[1]],
      stories: [story("st1", { points: 3 })],
    };
    expect(steps("buy-a-feature", live)).toEqual([]);
  });

  it("sizes the funded stories still in the backlog", () => {
    const stories = [
      story("st1", { sourceRef: { tool: "buy-a-feature", id: "Search" } }),
      story("st2", { sourceRef: { tool: "buy-a-feature", id: "Export" }, points: 5 }),
    ];
    expect(steps("buy-a-feature", { prioritizations: [], stories })).toEqual([
      expect.objectContaining({ id: "buy-a-feature-size", href: "/planning-poker" }),
    ]);
  });

  it("sets the game up: prices first, then a pool that can't buy everything", () => {
    const priced = [feature("A", 100), feature("B", 200)];
    expect(ids("buy-a-feature", { prioritizations: [...priced, feature("Legacy", 0)] })).toEqual([
      "buy-a-feature-price",
    ]);
    expect(steps("buy-a-feature", { prioritizations: priced })).toEqual([
      expect.objectContaining({
        id: "buy-a-feature-pool",
        detail: expect.stringContaining("The pool is the players times each one's budget"),
      }),
    ]);
    const tooRich = step(
      "buy-a-feature",
      { prioritizations: priced, buyAFeatureGames: [game(100, 4)] },
      "buy-a-feature-pool"
    );
    expect(tooRich?.detail).toMatch(/^The players could buy everything/);
    expect(
      steps("buy-a-feature", { prioritizations: priced, buyAFeatureGames: [game(50, 3)] })
    ).toEqual([]);
  });

  it("ignores example rows", () => {
    expect(
      steps("buy-a-feature", {
        prioritizations: [feature("example-a", 10, 10), feature("example-b", 0)],
      })
    ).toEqual([]);
  });
});

describe("hundred-dollar-test", () => {
  const split = (id: string, allocation?: number) =>
    row(id, "hundred-dollar", allocation === undefined ? {} : { allocation });
  const round = (id: string, totals: Record<string, number>, ballots: number): AllocationRound => ({
    id,
    tool: "hundred-dollar-test",
    roundId: "r1",
    title: "$100 Test",
    budget: 100,
    unit: "$",
    spendAll: true,
    date: "2026-10-20",
    closedAt: "2026-10-20T10:00:00.000Z",
    minN: 3,
    ballots,
    source: "facilitator",
    bandEdges: [],
    items: Object.entries(totals).map(([itemId, total]) => ({
      itemId,
      text: itemId,
      total,
      backers: null,
      bands: null,
    })),
  });

  it("runs a team round, and asks for the money left over", () => {
    const prioritizations = [split("Search", 60), split("Export", 30)];
    expect(
      steps("hundred-dollar-test", { prioritizations, allocationRounds: [] }).map((s) => [
        s.id,
        s.label,
        s.href,
      ])
    ).toEqual([
      ["hundred-dollar-round", "Run a team round", "/hundred-dollar-test"],
      ["hundred-dollar-split", "Give out the last $10", "/hundred-dollar-test"],
    ]);
    const full = [split("Search", 70), split("Export", 30)];
    expect(ids("hundred-dollar-test", { prioritizations: full, allocationRounds: [] })).toEqual([
      "hundred-dollar-round",
    ]);
  });

  it("takes the round's front-runners to the Backlog Prioritizer", () => {
    const rounds = [round("allocationRound_1", { Search: 200, Export: 120, Docs: 80 }, 4)];
    expect(
      steps("hundred-dollar-test", {
        prioritizations: [split("Search"), split("Export")],
        allocationRounds: rounds,
      })
    ).toEqual([
      {
        id: "hundred-dollar-score",
        label: "Score the front-runners in the Backlog Prioritizer",
        detail:
          "“Search” and “Export” got 80% of the team's money in the round of 20 Oct. Put them on the backlog and score them, so the decided order reflects it.",
        href: "/prioritizer",
      },
    ]);
  });

  it("ignores example rows and rounds", () => {
    const examples = [split("example-a", 50), split("example-b", 20)];
    const exampleRound = round("example-round", { a: 300, b: 100 }, 4);
    expect(
      steps("hundred-dollar-test", { prioritizations: examples, allocationRounds: [exampleRound] })
    ).toEqual([]);
    expect(
      ids("hundred-dollar-test", {
        prioritizations: [split("A"), split("B")],
        allocationRounds: [exampleRound],
      })
    ).toEqual(["hundred-dollar-round"]);
  });
});

describe("decision-log, daci and rapid-decision", () => {
  const record = (id: string, over: Partial<Decision> = {}): Decision => ({
    id,
    title: id,
    decision: "",
    status: "proposed",
    date: TODAY,
    ...over,
  });

  it("share one rule", () => {
    expect(getNextStepRule("daci")).toBe(getNextStepRule("decision-log"));
    expect(getNextStepRule("rapid-decision")).toBe(getNextStepRule("decision-log"));
  });

  it("decide the proposal waiting longest, opening the record", () => {
    const decisions = [
      record("Monorepo", { date: "2026-10-01" }),
      record("Vendor", { date: "2026-10-08" }),
      record("Fresh", { date: "2026-10-20" }),
    ];
    expect(steps("decision-log", { decisions })).toEqual([
      {
        id: "decision-stale",
        label: "Decide on “Monorepo”: proposed 25 days ago",
        detail:
          "1 other proposal is waiting over two weeks too. An open proposal holds up the work that waits on it: accept it, or record why not.",
        href: "/decision-log?id=Monorepo",
      },
    ]);
    // Reopened records wait from the day they were reopened.
    const reopened = record("Monorepo", { date: "2026-09-01", reopenedAt: "2026-10-20" });
    expect(steps("daci", { decisions: [reopened] })).toEqual([]);
  });

  it("asks for the outcome of an accepted record, and the decider of a DACI or RAPID one", () => {
    const decisions = [
      record("Accepted", { status: "accepted", decidedAt: "2026-10-21" }),
      record("Pick a vendor", { template: "rapid" }),
    ];
    expect(steps("rapid-decision", { decisions }).map((s) => [s.id, s.label, s.href])).toEqual([
      [
        "decision-outcome",
        "Write down what was decided on “Accepted”",
        "/decision-log?id=Accepted",
      ],
      [
        "decision-decider",
        "Name the Decide (D) for “Pick a vendor”",
        "/decision-log?id=Pick%20a%20vendor",
      ],
    ]);
  });

  it("read old DACI rows through", () => {
    const daciDecisions: DACIDecision[] = [
      { id: "daci1", title: "Hosting", status: "open", date: "2026-09-30T10:00:00.000Z" },
    ];
    expect(ids("daci", { decisions: [], daciDecisions })).toEqual([
      "decision-stale",
      "decision-decider",
    ]);
    expect(step("daci", { decisions: [], daciDecisions }, "decision-decider")?.label).toBe(
      "Name the Approver for “Hosting”"
    );
  });

  it("ignore example records", () => {
    const decisions = [record("example-d1", { date: "2026-09-01", template: "daci" })];
    expect(steps("decision-log", { decisions })).toEqual([]);
  });
});

describe("six-hats", () => {
  it("opens the proposed record itself", () => {
    const decisions = [
      {
        id: "d 1",
        title: "Monorepo",
        decision: "",
        status: "proposed",
        date: TODAY,
        sourceRef: { tool: "six-hats", id: "sh1" },
      } as Decision,
    ];
    expect(step("six-hats", { decisions }, "six-hats-decide")?.href).toBe("/decision-log?id=d%201");
  });
});

describe("weighted-decision", () => {
  const matrix = (id: string, over: Partial<WeightedMatrix> = {}): WeightedMatrix => ({
    id,
    name: id,
    createdAt: STAMP,
    ...over,
  });
  const criteria = (matrixId?: string): WeightedCriterion[] => [
    { id: "c1", name: "Cost", weight: 2, ...(matrixId ? { matrixId } : {}) },
    { id: "c2", name: "Speed", weight: 1, ...(matrixId ? { matrixId } : {}) },
  ];
  const option = (
    id: string,
    scores: Record<string, number>,
    matrixId?: string
  ): WeightedOption => ({
    id,
    name: id,
    scores,
    ...(matrixId ? { matrixId } : {}),
  });

  it("records a clear result, unless it already went to a record", () => {
    const ws = {
      weightedMatrices: [matrix("m1", { question: "Which vendor?" })],
      weightedCriteria: criteria("m1"),
      weightedOptions: [
        option("Alpha", { c1: 9, c2: 8 }, "m1"),
        option("Bravo", { c1: 4, c2: 5 }, "m1"),
      ],
      decisions: [],
    };
    expect(steps("weighted-decision", ws)).toEqual([
      expect.objectContaining({
        id: "weighted-record",
        label: "Record the decision on “Which vendor?”",
        detail: expect.stringMatching(/^Alpha leads with/),
        href: "/weighted-decision?matrix=m1",
      }),
    ]);
    const sent = { ...ws, weightedMatrices: [matrix("m1", { sentTo: [link("decision", "d1")] })] };
    expect(
      steps("weighted-decision", {
        ...sent,
        decisions: [{ id: "d1", title: "x", decision: "", status: "proposed", date: TODAY }],
      })
    ).toEqual([]);
    // A record deleted since: the result can go again.
    expect(ids("weighted-decision", sent)).toEqual(["weighted-record"]);
  });

  it("calls a tie, and asks for the empty cells", () => {
    const ws = {
      weightedMatrices: [matrix("m1")],
      weightedCriteria: criteria("m1"),
      weightedOptions: [
        option("Alpha", { c1: 8, c2: 8 }, "m1"),
        option("Bravo", { c1: 8, c2: 7 }, "m1"),
        option("Charlie", { c1: 3 }, "m1"),
      ],
    };
    expect(steps("weighted-decision", ws).map((s) => [s.id, s.label])).toEqual([
      ["weighted-tie", "“m1” is too close to call: talk it through before deciding"],
      ["weighted-empty-cells", "Score the 1 empty cell in “m1”"],
    ]);
  });

  it("reads the unnamed default matrix", () => {
    const ws = { weightedCriteria: criteria(), weightedOptions: [option("Alpha", { c1: 9 })] };
    expect(steps("weighted-decision", ws)).toEqual([
      expect.objectContaining({
        id: "weighted-empty-cells",
        href: `/weighted-decision?matrix=${encodeURIComponent(DEFAULT_WEIGHTED_MATRIX_ID)}`,
      }),
    ]);
  });

  it("ignores example matrices", () => {
    const ws = {
      weightedMatrices: [matrix("example-m")],
      weightedCriteria: criteria("example-m"),
      weightedOptions: [
        option("example-a", { c1: 9, c2: 8 }, "example-m"),
        option("example-b", { c1: 2 }, "example-m"),
      ],
    };
    expect(steps("weighted-decision", ws)).toEqual([]);
  });
});

describe("cynefin", () => {
  const cynefin = (
    id: string,
    domain: CynefinItem["domain"],
    over: Partial<CynefinItem> = {}
  ): CynefinItem => ({
    id,
    title: id,
    domain,
    loggedAt: STAMP,
    ...over,
  });
  const hypothesis = (id: string, status: Hypothesis["status"]): Hypothesis => ({
    id,
    believe: "b",
    willDo: "w",
    toLearn: "l",
    successMetric: "m",
    status,
    raisedAt: STAMP,
  });
  const trackers = (hypotheses: Hypothesis[]) => [{ id: "hypothesisTracker:current", hypotheses }];

  it("stabilises chaotic items first, then tests the complex ones", () => {
    const cynefinItems = [
      cynefin("Outage", "chaotic"),
      cynefin("Pricing", "complex"),
      cynefin("Billing", "complex", { sentTo: [link("hypothesis", "h1")] }),
      cynefin("Setup", "clear"),
    ];
    expect(
      steps("cynefin", {
        cynefinItems,
        hypothesisTrackers: trackers([hypothesis("h1", "running")]),
      }).map((s) => [s.id, s.label, s.href])
    ).toEqual([
      ["cynefin-chaotic", "Stabilise the chaotic item first", "/cynefin"],
      ["cynefin-hypotheses", "Turn the complex item into a hypothesis to test", "/cynefin"],
    ]);
  });

  it("reads a tested hypothesis's result, and retests one whose hypothesis is gone", () => {
    const cynefinItems = [cynefin("Billing", "complex", { sentTo: [link("hypothesis", "h1")] })];
    expect(
      steps("cynefin", {
        cynefinItems,
        hypothesisTrackers: trackers([hypothesis("h1", "validated")]),
      })
    ).toEqual([
      expect.objectContaining({
        id: "cynefin-results",
        label: "See what the test of “Billing” found",
        href: "/hypothesis-tracker",
      }),
    ]);
    expect(ids("cynefin", { cynefinItems, hypothesisTrackers: trackers([]) })).toEqual([
      "cynefin-hypotheses",
    ]);
  });

  it("ignores example items", () => {
    const cynefinItems = [cynefin("example-a", "chaotic"), cynefin("example-b", "complex")];
    expect(steps("cynefin", { cynefinItems })).toEqual([]);
  });
});

describe("every Prioritize & decide step", () => {
  // Runs last: `seen` holds every href the tests above produced.
  it("links to a page that exists", () => {
    expect(seen.size).toBeGreaterThan(15);
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
