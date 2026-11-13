import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getNextStepRule } from "@/lib/tools/next-steps";
import type {
  Impediment,
  KanbanCard,
  Sprint,
  SprintReview,
  Story,
  Workspace,
} from "@/lib/stores/workspace-types";
import { blankReview } from "@/lib/sprints/review-doc";

/**
 * Next steps for the Run-the-sprint tools (Phase 3): each reads the
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
const story = (over: Partial<Story> = {}): Story => ({
  id: "st",
  title: "Story",
  status: "todo",
  points: 3,
  sprintId: "s2",
  ...over,
});
const imp = (over: Partial<Impediment> = {}): Impediment => ({
  id: "i",
  title: "Build server down",
  severity: "high",
  raisedAt: "2026-10-20",
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-24T09:00:00"));
});
afterEach(() => vi.useRealTimers());

describe("kanban", () => {
  it("asks for stories when the active sprint's board is empty", () => {
    expect(ids("kanban", { sprints: [sprint()], stories: [] })).toEqual(["kanban-plan"]);
  });

  it("points blocked stories at the Daily Scrum and a finished board at the review", () => {
    // The team has a Definition of Done, so done stories don't ask for one.
    const definitionsOfDone = [
      {
        id: "definitionOfDone:current",
        items: [{ id: "d1", label: "Tests pass", category: "testing" as const, required: true }],
        history: [],
      },
    ];
    expect(
      ids("kanban", {
        sprints: [sprint()],
        stories: [story({ id: "a", blocked: true }), story({ id: "b", status: "done" })],
        definitionsOfDone,
      })
    ).toEqual(["kanban-blocked"]);
    const done = steps("kanban", {
      sprints: [sprint()],
      stories: [story({ id: "a", status: "done" }), story({ id: "b", status: "done" })],
      definitionsOfDone,
    });
    expect(done.map((s) => [s.id, s.href])).toEqual([
      ["kanban-review", "/sprint-review?sprint=s2"],
    ]);
  });

  it("stays quiet without an active sprint or Flow board cards", () => {
    expect(ids("kanban", { sprints: [sprint({ status: "planned" })], stories: [] })).toEqual([]);
  });

  it("without a sprint, reads the Flow board: blocked cards, then cycle time", () => {
    const card = (id: string, over: Partial<KanbanCard> = {}): KanbanCard => ({
      id,
      title: id,
      column: "done",
      class: "standard",
      createdAt: "2026-10-01",
      startedAt: "2026-10-01",
      completedAt: "2026-10-04",
      ...over,
    });
    const board = (cards: KanbanCard[]) => ({
      sprints: [],
      stories: [],
      kanbanBoards: [
        {
          id: "kanban:current",
          cards,
          wipLimits: { backlog: 0, ready: 5, in_progress: 3, review: 2, done: 0 },
        },
      ],
    });
    const done = ["a", "b", "c", "d", "e"].map((id) => card(id));
    expect(
      ids("kanban", board([...done, card("x", { column: "in_progress", blocked: true })]))
    ).toEqual(["kanban-flow-blocked", "kanban-cycle-time"]);
    expect(ids("kanban", board(done.slice(0, 4)))).toEqual([]);
  });
});

describe("sprint (cockpit)", () => {
  it("chases overdue impediments of the sprint window, not older ones", () => {
    const out = steps("sprint", {
      sprints: [sprint()],
      impediments: [
        imp({ id: "a", dueDate: "2026-10-22" }),
        imp({ id: "b", raisedAt: "2026-09-01", resolvedAt: "2026-09-10", dueDate: "2026-09-05" }),
        imp({ id: "example-c", dueDate: "2026-10-22" }),
      ],
      sprintReviews: [],
    });
    expect(out.map((s) => s.id)).toEqual(["cockpit-impediments"]);
    expect(out[0].detail).toBe("1 impediment in Sprint 2's way is past due.");
  });

  it("points blocked stories at the board", () => {
    expect(
      ids("sprint", {
        sprints: [sprint()],
        stories: [story({ blocked: true })],
        impediments: [],
        sprintReviews: [],
      })
    ).toEqual(["cockpit-blocked"]);
  });

  it("offers the timer's agenda when a ceremony starts within the hour", () => {
    // Monday 26 Oct at 09:00; the default Daily Scrum is at 09:30.
    vi.setSystemTime(new Date("2026-10-26T09:00:00"));
    const [step] = steps("sprint", {
      sprints: [sprint()],
      stories: [],
      impediments: [],
      sprintReviews: [],
      ceremonyCadences: [],
    });
    expect(step).toMatchObject({
      id: "cockpit-timer",
      label: "Time the Daily Scrum with its agenda",
      href: "/ceremony-timer?agenda=daily",
    });
  });

  it("asks for the review once the sprint has ended and its review is empty", () => {
    const ended = sprint({ endDate: "2026-10-23" });
    expect(ids("sprint", { sprints: [ended], impediments: [], sprintReviews: [] })).toEqual([
      "cockpit-review",
    ]);
    const review: SprintReview = {
      ...blankReview(ended),
      feedbackItems: [{ id: "f", stakeholder: "Dana", feedback: "Nice", category: "positive" }],
    };
    expect(ids("sprint", { sprints: [ended], impediments: [], sprintReviews: [review] })).toEqual(
      []
    );
  });
});

describe("standup and async standup", () => {
  it("share one rule: open standup blockers, then the sprint board", () => {
    const ws = {
      impediments: [
        imp({ id: "a", sourceRef: { tool: "standup", id: "e1" } }),
        imp({ id: "b", sourceRef: { tool: "async-standup", id: "e2" }, resolvedAt: "2026-10-22" }),
      ],
      sprints: [sprint()],
      stories: [story()],
    };
    expect(ids("standup", ws)).toEqual(["standup-impediments", "standup-owners", "standup-board"]);
    expect(steps("async-standup", ws)).toEqual(steps("standup", ws));
    expect(steps("standup", ws)[2].href).toBe("/kanban?sprint=s2");
    // Owned stories come up in someone's turn: no owners step.
    expect(ids("standup", { ...ws, stories: [story({ owner: "Alice" })] })).toEqual([
      "standup-impediments",
      "standup-board",
    ]);
  });
});

describe("impediments", () => {
  it("sends overdue or two-week-old impediments to the retro", () => {
    expect(steps("impediments", { impediments: [imp({ dueDate: "2026-10-21" })] })[0].detail).toBe(
      "1 impediment is past due. Ask the team what keeps it in place."
    );
    expect(steps("impediments", { impediments: [imp({ raisedAt: "2026-10-01" })] })[0].detail).toBe(
      "1 impediment is open for two weeks or more."
    );
    expect(ids("impediments", { impediments: [imp()] })).toEqual([]);
    expect(ids("impediments", { impediments: [imp({ escalatedAt: "2026-10-21" })] })).toEqual([
      "impediments-sos",
    ]);
    expect(
      ids("impediments", {
        impediments: [imp({ raisedAt: "2026-10-01", resolvedAt: "2026-10-02" })],
      })
    ).toEqual([]);
  });
});

describe("ceremony-timer", () => {
  it("points at the next ceremony's tool", () => {
    const [step] = steps("ceremony-timer", { sprints: [sprint()], ceremonyCadences: [] });
    // Saturday 24 Oct at 09:00, default cadence: the next one is Monday's Daily Scrum.
    expect(step).toMatchObject({
      id: "timer-next-ceremony",
      label: "Get ready for the Daily Scrum",
      href: "/standup?sprint=s2",
    });
  });
});

describe("sprint-review", () => {
  it("asks whether the goal was met before the retro, until it's answered", () => {
    const s1 = sprint({ id: "s1", name: "Sprint 1", status: "completed", endDate: "2026-10-16" });
    const review: SprintReview = {
      ...blankReview(s1),
      feedbackItems: [{ id: "f", stakeholder: "Dana", feedback: "Nice", category: "positive" }],
    };
    const goal = {
      id: "sprint-goal:sprint:s1",
      sprintId: "s1",
      businessObjective: "",
      goal: "Customers can pay by card",
      criteria: [],
      keyResults: [],
    };
    const ws = { sprints: [s1], sprintReviews: [review], stories: [], sprintGoals: [goal] };
    const [first] = steps("sprint-review", ws);
    expect(first).toMatchObject({
      id: "review-goal-met",
      label: "Answer “Did we meet the sprint goal?” for Sprint 1",
      href: "/sprint-goal?sprint=s1",
    });
    const answered = { ...goal, outcome: { met: "met" as const, decidedAt: "2026-10-16" } };
    expect(ids("sprint-review", { ...ws, sprintGoals: [answered] })).toEqual(["review-retro"]);
  });

  it("leads to the retro once a review has content, and to refinement for its stories", () => {
    const s1 = sprint({ id: "s1", name: "Sprint 1", status: "completed", endDate: "2026-10-16" });
    const review: SprintReview = {
      ...blankReview(s1),
      feedbackItems: [
        { id: "f", stakeholder: "Dana", feedback: "Add refunds", category: "suggestion" },
      ],
    };
    const out = steps("sprint-review", {
      sprints: [s1, sprint()],
      sprintReviews: [review],
      stories: [
        story({
          id: "x",
          sprintId: undefined,
          status: "backlog",
          sourceRef: { tool: "sprint-review", id: "f" },
        }),
      ],
    });
    expect(out.map((s) => s.id)).toEqual(["review-retro", "review-refine"]);
    expect(out[0].label).toBe("Hold the retrospective for Sprint 1");
    expect(ids("sprint-review", { sprints: [s1], sprintReviews: [], stories: [] })).toEqual([]);
  });
});

describe("interrupt-buffer (tools plan phase 1)", () => {
  it("sends a sprint over its buffer to the cockpit", () => {
    const out = steps("interrupt-buffer", {
      sprints: [sprint({ interruptBuffer: { points: 2 } })],
      interruptItems: [
        {
          id: "i1",
          sprintId: "s2",
          title: "Login broken",
          kind: "bug",
          size: 3,
          emergency: false,
          loggedAt: "2026-10-20T09:00:00.000Z",
        },
      ],
    });
    expect(out.map((s) => s.id)).toEqual(["interrupt-buffer-over"]);
    expect(out[0].href).toBe("/sprint?sprint=s2");
  });

  it("stays quiet within the buffer", () => {
    expect(
      ids("interrupt-buffer", {
        sprints: [sprint({ interruptBuffer: { points: 8 } })],
        interruptItems: [],
      })
    ).toEqual([]);
  });
});

describe("picker (tools plan phase 1)", () => {
  const team = [{ id: "m1", name: "Sam" }];

  it("asks for the team while the roster is empty or only the example", () => {
    expect(ids("picker", { teamMembers: [] })).toEqual(["picker-team"]);
    expect(ids("picker", { teamMembers: [{ id: "example-m1", name: "Sam" }] })).toEqual([
      "picker-team",
    ]);
    expect(ids("picker", { teamMembers: team })).toEqual([]);
  });

  it("leads on to a ceremony starting within the hour", () => {
    // Monday 26 Oct at 09:00; the default Daily Scrum is at 09:30.
    vi.setSystemTime(new Date("2026-10-26T09:00:00"));
    expect(
      steps("picker", { teamMembers: team, sprints: [sprint()], ceremonyCadences: [] })[0]
    ).toMatchObject({
      id: "picker-ceremony",
      label: "Go on to the Daily Scrum",
      href: "/standup?sprint=s2",
    });
    vi.setSystemTime(new Date("2026-10-24T09:00:00"));
    expect(ids("picker", { teamMembers: team, sprints: [sprint()], ceremonyCadences: [] })).toEqual(
      []
    );
  });
});

describe("quick-vote", () => {
  it("leads a proposed decision to the Decision Log and a vote's topic to the retro", () => {
    const out = steps("quick-vote", {
      decisions: [
        {
          id: "d1",
          title: "Thursday demos? Most picked: Thumbs up (4)",
          decision: "",
          status: "proposed",
          sourceRef: { tool: "quick-vote", id: "qvr-1" },
        } as never,
      ],
      retroBoards: [
        {
          id: "retro:current",
          cards: [
            {
              id: "c1",
              text: "Worth it? Average 2.1 of 4",
              isActionItem: false,
              sourceRef: { tool: "quick-vote", id: "qvr-2" },
            },
            {
              id: "example-c2",
              text: "Example",
              isActionItem: false,
              sourceRef: { tool: "quick-vote", id: "x" },
            },
          ],
        } as never,
      ],
    });
    expect(out.map((s) => [s.id, s.href])).toEqual([
      ["quick-vote-decide", "/decision-log?id=d1"],
      ["quick-vote-retro", "/retro"],
    ]);
    expect(out[0].label).toBe(
      "Record the decision on “Thursday demos? Most picked: Thumbs up (4)”"
    );
    expect(out[1].detail).toBe("1 vote result is on the retro board.");
  });

  it("stays quiet with nothing sent, or once the decision is made", () => {
    expect(ids("quick-vote", { decisions: [], retroBoards: [] })).toEqual([]);
    expect(
      ids("quick-vote", {
        decisions: [
          {
            id: "d1",
            title: "X",
            decision: "Go",
            status: "accepted",
            sourceRef: { tool: "quick-vote", id: "q" },
          } as never,
        ],
      })
    ).toEqual([]);
  });
});
