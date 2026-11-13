import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getNextStepRule, loadAllNextStepRules } from "@/lib/tools/next-steps";
import type {
  RetroBoard,
  RetroCard,
  Risk,
  RootCauseAnalysis,
  Sprint,
  Story,
  Workspace,
} from "@/lib/stores/workspace-types";
import { blankRetroBoard } from "@/lib/retro/board";
import { retroFormats } from "@/lib/constants/retro-formats";
import { LS_CATALOG } from "@/lib/liberating-structures/catalog";

/**
 * Next steps for the Retrospect & improve tools (Phase 4): each reads the
 * workspace and points somewhere real, ignores example rows, and stays
 * quiet when nothing applies.
 */

// The tools plan's phase 1 rules load their models on demand (lazyRule).
beforeAll(loadAllNextStepRules);

const steps = (toolId: string, ws: Partial<Workspace>) => {
  const rule = getNextStepRule(toolId);
  if (!rule) throw new Error(`no rule for ${toolId}`);
  return rule.steps(rule.select(ws as Workspace));
};
const ids = (toolId: string, ws: Partial<Workspace>) => steps(toolId, ws).map((s) => s.id);

const sprint = (over: Partial<Sprint> = {}): Sprint => ({
  id: "s2",
  name: "Sprint 2",
  startDate: "2026-10-19",
  endDate: "2026-10-30",
  pointsPlanned: 20,
  status: "active",
  ...over,
});
const action = (id: string, over: Partial<RetroCard> = {}): RetroCard => ({
  id,
  columnKey: "start",
  text: `Action ${id}`,
  votes: 0,
  groupedWith: null,
  isActionItem: true,
  assignee: "",
  discussing: false,
  ...over,
});
const board = (id: string, cards: RetroCard[], over: Partial<RetroBoard> = {}): RetroBoard => ({
  ...blankRetroBoard(retroFormats[0]),
  id,
  cards,
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-24T09:00:00"));
});
afterEach(() => vi.useRealTimers());

describe("retro", () => {
  it("follows up the board's actions, saying how many lack an owner", () => {
    const out = steps("retro", {
      retroBoards: [board("retro:current", [action("a", { assignee: "Sam" }), action("b")])],
      sprints: [],
    });
    expect(out.map((s) => s.id)).toEqual(["retro-follow-up"]);
    expect(out[0].label).toBe("Follow up the 2 actions in Retro Actions");
    expect(out[0].detail).toBe(
      "1 action has no owner yet. An action without one rarely gets done."
    );
  });

  it("offers to plan the next sprint once the retro reaches its actions", () => {
    const out = steps("retro", {
      retroBoards: [
        board("retro:current", [action("a", { assignee: "Sam" })], { phase: "actions" }),
      ],
      sprints: [
        sprint({ status: "completed" }),
        sprint({ id: "s3", name: "Sprint 3", status: "planned" }),
      ],
    });
    expect(out.map((s) => [s.id, s.href])).toEqual([
      ["retro-follow-up", "/retro-actions"],
      ["retro-plan-next", "/sprint-planning?sprint=s3"],
    ]);
  });

  it("ignores example cards and stays quiet without a board", () => {
    expect(
      ids("retro", { retroBoards: [board("retro:current", [action("example-a")])], sprints: [] })
    ).toEqual([]);
    expect(ids("retro", { retroBoards: [], sprints: [] })).toEqual([]);
  });
});

describe("retro-actions", () => {
  it("raises overdue actions and a low follow-through", () => {
    const archived = (n: number, cards: RetroCard[]) =>
      board(`retro:2026-0${n}-01`, cards, { archivedAt: `2026-0${n}-01T10:00:00Z` });
    const out = steps("retro-actions", {
      retroBoards: [
        archived(7, [action("a1"), action("a2", { done: true })]),
        archived(8, [action("b1"), action("b2")]),
        archived(9, [action("c1", { dueDate: "2026-10-01" }), action("c2")]),
      ],
    });
    expect(out.map((s) => s.id)).toEqual([
      "retro-actions-overdue",
      "retro-actions-low-follow-through",
    ]);
    expect(out[1].detail).toBe("The last 3 retros got 1 of 6 actions done.");
    expect(ids("retro-actions", { retroBoards: [] })).toEqual([]);
  });

  it("sends a theme that came back after its action was done to Root Cause", () => {
    const past = (day: string, cards: RetroCard[]) =>
      board(`retro:${day}`, cards, { archivedAt: `${day}T10:00:00Z` });
    const boards = [
      past("2026-09-01", [
        action("a1", { text: "Fix staging data", done: true, doneAt: "2026-09-10T09:00:00Z" }),
        action("a2", { text: "Staging was down", isActionItem: false }),
      ]),
      past("2026-09-15", [action("b1", { text: "Staging data stale", isActionItem: false })]),
      past("2026-09-29", [action("c1", { text: "Waited for staging", isActionItem: false })]),
    ];
    expect(steps("retro-actions", { retroBoards: boards })).toContainEqual({
      id: "retro-actions-came-back",
      label: "Find the root cause of “staging”",
      detail: "It came up again after “Fix staging data” was marked done.",
      href: "/root-cause",
    });
  });
});

describe("premortem", () => {
  const risk = (id: string, over: Partial<Risk> = {}): Risk => ({
    id,
    title: id,
    probability: 3,
    impact: 3,
    raisedAt: "2026-10-20",
    status: "open",
    sourceRef: { tool: "premortem", id: `c-${id}` },
    ...over,
  });
  const planned = (id: string, over: Partial<Risk> = {}) =>
    risk(id, { mitigation: "Pair on it", ...over });

  it("asks for mitigations first", () => {
    expect(steps("premortem", { risks: [risk("r0")] })[0]).toMatchObject({
      id: "premortem-mitigations",
      detail: "1 risk from the premortem has no mitigation yet.",
    });
  });

  it("then asks for mitigation dates on the open ones", () => {
    expect(
      steps("premortem", {
        risks: [
          planned("r1"),
          planned("r2", { mitigationDueAt: "2026-11-01" }),
          planned("r3", { status: "closed" }),
        ],
      })[0].detail
    ).toBe("1 risk from the premortem is open with no due date.");
    expect(ids("premortem", { risks: [planned("r2", { mitigationDueAt: "2026-11-01" })] })).toEqual(
      []
    );
  });
});

describe("liberating-structures", () => {
  const favourites = (ids: string[]) => [
    {
      id: "liberatingStructures:current",
      favorites: ids.map((structureId, i) => ({ id: `f${i}`, structureId, ts: "2026-10-01" })),
    },
  ];
  // The sprint's last day at 14:30: review is done, the retro is at 15:30.
  const lastDay = sprint({ startDate: "2026-10-13", endDate: "2026-10-26" });
  const at = () => vi.setSystemTime(new Date("2026-10-26T14:30:00"));

  it("suggests a saved structure that suits the next ceremony", () => {
    at();
    const forRetro = LS_CATALOG.find((x) => x.ceremonies.includes("retro"));
    expect(forRetro).toBeDefined();
    const [step] = steps("liberating-structures", {
      liberatingStructures: favourites([forRetro!.id]),
      sprints: [lastDay],
      ceremonyCadences: [],
    });
    expect(step).toMatchObject({
      id: "ls-use-in-ceremony",
      label: `Use ${forRetro!.name} in the Sprint Retrospective`,
    });
    expect(step.href).toBe(
      forRetro!.ceremonyTimerAgenda
        ? `/ceremony-timer?agenda=${forRetro!.ceremonyTimerAgenda}`
        : "/retro?sprint=s2"
    );
  });

  it("stays quiet with no fitting favourite, or none at all", () => {
    at();
    const notForRetro = LS_CATALOG.find((x) => !x.ceremonies.includes("retro"));
    expect(
      ids("liberating-structures", {
        liberatingStructures: favourites([notForRetro!.id, "not-a-structure"]),
        sprints: [lastDay],
        ceremonyCadences: [],
      })
    ).toEqual([]);
    expect(
      ids("liberating-structures", {
        liberatingStructures: [],
        sprints: [lastDay],
        ceremonyCadences: [],
      })
    ).toEqual([]);
  });
});

describe("six-hats", () => {
  it("leads a proposed decision to the Decision Log and a risky session to a premortem", () => {
    const out = steps("six-hats", {
      decisions: [
        {
          id: "d1",
          title: "Monorepo",
          decision: "Move",
          status: "proposed",
          sourceRef: { tool: "six-hats", id: "sh1" },
        } as never,
      ],
      sixHatsSessions: [
        {
          id: "sh1",
          topic: "Monorepo",
          order: ["black"],
          roundMinutes: 5,
          startedAt: "2026-10-24T08:00:00Z",
        },
      ],
      sixHatsThoughts: ["1", "2", "3"].map((n) => ({
        id: `t${n}`,
        hat: "black" as const,
        text: `Risk ${n}`,
        loggedAt: "2026-10-24T08:10:00Z",
        sessionId: "sh1",
      })),
    });
    expect(out.map((s) => [s.id, s.href])).toEqual([
      ["six-hats-decide", "/decision-log?id=d1"],
      ["six-hats-premortem", "/premortem"],
    ]);
    expect(out[0].label).toBe("Record the decision on “Monorepo”");
  });
});

describe("design-sprint", () => {
  it("points drafted hypotheses and unrefined stories onward", () => {
    const out = steps("design-sprint", {
      hypothesisTrackers: [
        {
          id: "hypothesisTracker:current",
          hypotheses: [
            {
              id: "h1",
              status: "drafted",
              sourceRef: { tool: "design-sprint", id: "o1" },
            } as never,
          ],
        },
      ],
      stories: [
        { id: "st", title: "S", status: "backlog", sourceRef: { tool: "design-sprint", id: "o2" } },
      ],
    });
    expect(out.map((s) => s.id)).toEqual(["design-sprint-hypotheses", "design-sprint-refine"]);
  });
});

describe("root-cause", () => {
  const analysis = (id: string, over: Partial<RootCauseAnalysis> = {}): RootCauseAnalysis => ({
    id,
    title: `Problem ${id}`,
    problem: "",
    method: "five-whys",
    whys: [],
    causes: [],
    createdAt: "2026-10-20T09:00:00.000Z",
    updatedAt: "2026-10-20T09:00:00.000Z",
    ...over,
  });

  it("asks for a countermeasure once a root cause is named, newest first", () => {
    expect(
      steps("root-cause", {
        rootCauseAnalyses: [
          analysis("rca_old", { rootCause: "A", updatedAt: "2026-10-01T09:00:00.000Z" }),
          analysis("rca_new", { rootCause: "B", updatedAt: "2026-10-22T09:00:00.000Z" }),
        ],
      })
    ).toEqual([
      {
        id: "root-cause-countermeasure",
        label: "Agree a countermeasure for “Problem rca_new”",
        detail: "2 analyses have a root cause and nothing agreed yet to change it.",
        href: "/root-cause?analysis=rca_new",
      },
    ]);
  });

  it("sends an agreed countermeasure to Retro Actions, and stops once it's there", () => {
    const agreed = analysis("rca_1", { rootCause: "A", countermeasure: "Do B" });
    expect(steps("root-cause", { rootCauseAnalyses: [agreed] })).toEqual([
      expect.objectContaining({ id: "root-cause-send", href: "/root-cause?analysis=rca_1" }),
    ]);
    const sent = {
      ...agreed,
      sentTo: [{ route: "retro-action" as const, targetId: "c1", at: "2026-10-23T09:00:00Z" }],
    };
    const retroBoards = [board("retro:current", [action("c1", { text: "Do B" })])];
    expect(ids("root-cause", { rootCauseAnalyses: [sent], retroBoards })).toEqual([]);
    // The action was deleted in Retro Actions: the countermeasure is to send again.
    expect(ids("root-cause", { rootCauseAnalyses: [sent], retroBoards: [] })).toEqual([
      "root-cause-send",
    ]);
  });

  it("ignores example analyses and stays quiet with nothing to do", () => {
    expect(
      ids("root-cause", { rootCauseAnalyses: [analysis("example-rca", { rootCause: "A" })] })
    ).toEqual([]);
    expect(ids("root-cause", { rootCauseAnalyses: [analysis("rca_2")] })).toEqual([]);
    expect(ids("root-cause", {})).toEqual([]);
  });

  it("reads malformed synced rows as the page does instead of throwing", () => {
    // A synced row can hold anything: an object for sentTo, a number for the
    // root cause or the date, and rows that aren't analyses at all.
    const odd = [
      {
        ...analysis("rca_obj"),
        countermeasure: "Do B",
        sentTo: { route: "retro-action", targetId: "c1" },
      },
      { ...analysis("rca_num"), rootCause: 42, updatedAt: 7 },
      { ...analysis("rca_named"), rootCause: "A" },
      null,
      "rca_text",
      { title: "no id" },
    ] as unknown as RootCauseAnalysis[];
    expect(() => steps("root-cause", { rootCauseAnalyses: odd })).not.toThrow();
    expect(ids("root-cause", { rootCauseAnalyses: odd })).toEqual([
      "root-cause-countermeasure",
      "root-cause-send",
    ]);
    expect(steps("root-cause", { rootCauseAnalyses: odd })[1].href).toBe(
      "/root-cause?analysis=rca_obj"
    );
  });
});

describe("icebreaker", () => {
  it("leads on to a ceremony starting within the hour", () => {
    // Monday 26 Oct at 09:00; the default Daily Scrum is at 09:30.
    vi.setSystemTime(new Date("2026-10-26T09:00:00"));
    expect(steps("icebreaker", { sprints: [sprint()], ceremonyCadences: [] })[0]).toMatchObject({
      id: "icebreaker-ceremony",
      label: "Go on to the Daily Scrum",
      href: "/standup?sprint=s2",
    });
    vi.setSystemTime(new Date("2026-10-24T09:00:00"));
    expect(ids("icebreaker", { sprints: [sprint()], ceremonyCadences: [] })).toEqual([]);
  });
});

describe("card-decks", () => {
  const story = (id: string, over: Partial<Story> = {}): Story => ({
    id,
    title: `Story ${id}`,
    status: "backlog",
    points: 3,
    ...over,
  });

  it("leads on to a ceremony starting within the hour", () => {
    // Monday 26 Oct at 09:00; the default Daily Scrum is at 09:30.
    vi.setSystemTime(new Date("2026-10-26T09:00:00"));
    expect(
      steps("card-decks", { sprints: [sprint()], ceremonyCadences: [], stories: [] })[0]
    ).toMatchObject({
      id: "card-decks-ceremony",
      label: "Go on to the Daily Scrum",
      href: "/standup?sprint=s2",
    });
    vi.setSystemTime(new Date("2026-10-24T09:00:00"));
    expect(ids("card-decks", { sprints: [sprint()], ceremonyCadences: [], stories: [] })).toEqual(
      []
    );
  });

  it("takes the story-splitting cards to the big backlog stories, examples, done and planned ones left out", () => {
    const out = steps("card-decks", {
      sprints: [],
      ceremonyCadences: [],
      stories: [
        story("a", { points: 13 }),
        story("b", { points: 20 }),
        story("c", { points: 5 }),
        story("d", { points: 21, status: "done" }),
        story("e", { points: 13, sprintId: "s2" }),
        story("example-f", { points: 40 }),
      ],
    });
    expect(out).toEqual([
      {
        id: "card-decks-split",
        label: "Split the big stories in Refinement",
        detail:
          "2 stories on the backlog are 13 points or more. Take the story-splitting cards along.",
        href: "/refinement",
      },
    ]);
  });
});
