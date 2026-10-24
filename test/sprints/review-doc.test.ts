import { describe, expect, it } from "vitest";
import {
  blankReview,
  DRAFT_REVIEW_ID,
  reviewDocId,
  reviewFacts,
  reviewHasContent,
} from "@/lib/sprints/review-doc";
import type { Sprint, SprintGoal, Story } from "@/lib/stores/workspace-types";

/** One review per sprint, and what it can say without typing. */

const sprint: Sprint = {
  id: "s1",
  name: "Sprint 12",
  startDate: "2026-10-12",
  endDate: "2026-10-23",
  goal: "Typed on the sprint",
  pointsPlanned: 20,
  pointsCompleted: 15,
  status: "active",
};

const story = (id: string, status: Story["status"], points?: number): Story => ({
  id,
  title: `Story ${id}`,
  status,
  sprintId: "s1",
  ...(points === undefined ? {} : { points }),
});

describe("review documents", () => {
  it("keys each sprint's review by its id; no sprint is the draft", () => {
    expect(reviewDocId("s1")).toBe("sprint-review:sprint:s1");
    expect(reviewDocId(null)).toBe(DRAFT_REVIEW_ID);
    expect(blankReview(sprint)).toMatchObject({
      id: "sprint-review:sprint:s1",
      sprintId: "s1",
      sprintName: "Sprint 12",
      features: [],
    });
    expect("sprintId" in blankReview()).toBe(false);
    expect(reviewHasContent(blankReview(sprint))).toBe(false);
    expect(
      reviewHasContent({
        ...blankReview(sprint),
        checklistItems: [{ id: "c", label: "x", checked: false }],
      })
    ).toBe(true);
  });
});

describe("reviewFacts", () => {
  const goals: SprintGoal[] = [
    {
      id: "sprint-goal:sprint:s1",
      sprintId: "s1",
      businessObjective: "",
      goal: "Customers can pay by card",
      criteria: [],
      keyResults: [],
      outcome: { met: "partly", decidedAt: "2026-10-23" },
    },
  ];

  it("reads the goal, its outcome, the done stories and their points", () => {
    const facts = reviewFacts(
      sprint,
      [
        story("a", "done", 5),
        story("b", "done"),
        story("c", "in_progress", 3),
        { ...story("x", "done", 8), sprintId: "s0" },
      ],
      goals
    );
    expect(facts.goal).toBe("Customers can pay by card");
    expect(facts.goalOutcome).toMatchObject({ met: "partly" });
    expect(facts.done.map((s) => s.id)).toEqual(["a", "b"]);
    expect(facts.notDone.map((s) => s.id)).toEqual(["c"]);
    expect(facts).toMatchObject({
      committed: 8,
      completed: 5,
      fromStories: true,
      unestimatedDone: 1,
    });
    expect(facts.sayDo?.pct).toBe(63);
  });

  it("reads a closed sprint's recorded points, not the stories left after carry-over", () => {
    // Closed at 5 of a 20-point commitment; the unfinished stories moved on.
    const closed = {
      ...sprint,
      status: "completed" as const,
      pointsPlanned: 20,
      pointsCompleted: 5,
    };
    const facts = reviewFacts(closed, [story("a", "done", 5)], undefined);
    expect(facts).toMatchObject({ committed: 20, completed: 5, fromStories: false });
    expect(facts.sayDo?.pct).toBe(25);
    expect(facts.done.map((s) => s.id)).toEqual(["a"]);
    // No commitment recorded: no say/do rather than a made-up 100%.
    expect(
      reviewFacts({ ...closed, pointsPlanned: 0 }, [story("a", "done", 5)], undefined).sayDo
    ).toBeNull();
  });

  it("falls back to the sprint's goal and typed points without pointed stories", () => {
    const facts = reviewFacts(sprint, [story("a", "done")], undefined);
    expect(facts).toMatchObject({
      goal: "Typed on the sprint",
      goalOutcome: null,
      committed: 20,
      completed: 15,
      fromStories: false,
    });
    expect(facts.sayDo?.pct).toBe(75);
    expect(reviewFacts({ ...sprint, pointsCompleted: undefined }, [], undefined).sayDo).toBeNull();
  });
});
