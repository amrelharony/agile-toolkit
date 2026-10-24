import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getNextStepRule } from "@/lib/tools/next-steps";
import type { RetroBoard, RetroCard, Sprint, Workspace } from "@/lib/stores/workspace-types";
import { blankRetroBoard } from "@/lib/retro/board";
import { retroFormats } from "@/lib/constants/retro-formats";

/**
 * Next steps for the Retrospect & improve tools (Phase 4): each reads the
 * workspace and points somewhere real, ignores example rows, and stays
 * quiet when nothing applies.
 */

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
});

describe("premortem", () => {
  it("asks for mitigation dates on the premortem's open risks", () => {
    const risk = (id: string, over: Record<string, unknown> = {}) => ({
      id,
      title: id,
      probability: 3,
      impact: 3,
      status: "open" as const,
      sourceRef: { tool: "premortem", id: `c-${id}` },
      ...over,
    });
    expect(
      steps("premortem", {
        risks: [
          risk("r1"),
          risk("r2", { mitigationDueAt: "2026-11-01" }),
          risk("r3", { status: "closed" }),
        ],
      })[0].detail
    ).toBe("1 risk from the premortem is open with no due date.");
    expect(ids("premortem", { risks: [risk("r2", { mitigationDueAt: "2026-11-01" })] })).toEqual(
      []
    );
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
      ["six-hats-decide", "/decision-log"],
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
