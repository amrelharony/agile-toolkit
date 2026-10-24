import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getNextStepRule } from "@/lib/tools/next-steps";
import type {
  Impediment,
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
    expect(
      ids("kanban", {
        sprints: [sprint()],
        stories: [story({ id: "a", blocked: true }), story({ id: "b", status: "done" })],
      })
    ).toEqual(["kanban-blocked"]);
    const done = steps("kanban", {
      sprints: [sprint()],
      stories: [story({ id: "a", status: "done" }), story({ id: "b", status: "done" })],
    });
    expect(done.map((s) => [s.id, s.href])).toEqual([
      ["kanban-review", "/sprint-review?sprint=s2"],
    ]);
  });

  it("stays quiet without an active sprint", () => {
    expect(ids("kanban", { sprints: [sprint({ status: "planned" })], stories: [] })).toEqual([]);
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
    expect(ids("standup", ws)).toEqual(["standup-impediments", "standup-board"]);
    expect(steps("async-standup", ws)).toEqual(steps("standup", ws));
    expect(steps("standup", ws)[1].href).toBe("/kanban?sprint=s2");
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
