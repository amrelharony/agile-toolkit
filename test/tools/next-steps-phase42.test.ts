/**
 * The next steps of Product Goal, Backlog Health and Interrupt Buffer
 * (lib/tools/next-steps-phase42.ts): each points somewhere real, ignores
 * example rows, and stays quiet when nothing applies.
 */

import { describe, expect, it } from "vitest";
import type { InterruptItem, ProductGoal, Sprint, Story } from "@/lib/stores/workspace-types";
import {
  backlogHealthSteps,
  interruptBufferSteps,
  productGoalSteps,
} from "@/lib/tools/next-steps-phase42";

const TODAY = "2026-11-12";

const goal = (over: Partial<ProductGoal> = {}): ProductGoal => ({
  id: "goal_a",
  statement: "Pay anywhere",
  measures: [],
  status: "active",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  ...over,
});
const sprint = (over: Partial<Sprint> = {}): Sprint => ({
  id: "s2",
  name: "Sprint 2",
  startDate: "2026-11-09",
  endDate: "2026-11-20",
  pointsPlanned: 20,
  status: "active",
  ...over,
});
const story = (over: Partial<Story> = {}): Story => ({
  id: "st",
  title: "Pay with a saved card",
  status: "backlog",
  points: 3,
  acceptanceCriteria: "Charged once.",
  backlogRank: 1,
  createdAt: "2026-11-01T00:00:00.000Z",
  ...over,
});
const item = (over: Partial<InterruptItem> = {}): InterruptItem => ({
  id: "i1",
  sprintId: "s2",
  title: "Login broken",
  kind: "bug",
  size: 3,
  emergency: false,
  loggedAt: "2026-11-10T09:00:00.000Z",
  ...over,
});
const ids = (steps: { id: string }[]) => steps.map((s) => s.id);

describe("product-goal", () => {
  it("points at the sprint goal, the backlog and a target that has passed", () => {
    const steps = productGoalSteps({
      goals: [goal({ targetDate: "2026-11-02" })],
      sprints: [sprint()],
      stories: [story()],
      today: TODAY,
    });
    expect(ids(steps)).toEqual([
      "product-goal-sprint-goal",
      "product-goal-backlog",
      "product-goal-past-target",
    ]);
    expect(steps[0]).toMatchObject({
      label: "Write Sprint 2's goal towards it",
      href: "/sprint-goal?sprint=s2",
    });
    expect(steps[2].detail).toBe(
      "Its target date passed 10 days ago: reached, changed or dropped?"
    );
  });

  it("stays quiet with no active goal, a sprint with a goal and no backlog", () => {
    expect(
      productGoalSteps({ goals: [], sprints: [sprint()], stories: [story()], today: TODAY })
    ).toEqual([]);
    expect(
      productGoalSteps({
        goals: [goal()],
        sprints: [sprint({ goal: "Refunds" })],
        stories: [],
        today: TODAY,
      })
    ).toEqual([]);
  });

  it("ignores example goals and sprints", () => {
    expect(
      productGoalSteps({
        goals: [goal({ id: "example-g" })],
        sprints: [sprint({ id: "example-s" })],
        stories: [],
        today: TODAY,
      })
    ).toEqual([]);
  });
});

describe("backlog-health", () => {
  it("asks to estimate, refine and decide, and for a Product Goal", () => {
    const steps = backlogHealthSteps({
      stories: [
        story({ id: "a", points: undefined }),
        story({ id: "b", title: "Login", acceptanceCriteria: undefined, backlogRank: 2 }),
        story({ id: "c", createdAt: "2026-06-01T00:00:00.000Z", backlogRank: 3 }),
      ],
      backlogItems: [],
      goals: [],
      today: TODAY,
    });
    expect(ids(steps)).toEqual([
      "backlog-health-estimate",
      "backlog-health-refine",
      "backlog-health-stale",
      "backlog-health-product-goal",
    ]);
    expect(steps[0]).toMatchObject({
      label: "Estimate 1 story in Planning Poker",
      href: "/planning-poker",
    });
  });

  it("stays quiet for a healthy backlog with a goal, and for none", () => {
    expect(
      backlogHealthSteps({ stories: [story()], backlogItems: [], goals: [goal()], today: TODAY })
    ).toEqual([]);
    expect(backlogHealthSteps({ stories: [], backlogItems: [], goals: [], today: TODAY })).toEqual(
      []
    );
    expect(
      backlogHealthSteps({
        stories: [story({ id: "example-x", points: undefined })],
        backlogItems: [],
        goals: [],
        today: TODAY,
      })
    ).toEqual([]);
  });
});

describe("interrupt-buffer", () => {
  it("sends an active sprint that is over the buffer to the cockpit", () => {
    const steps = interruptBufferSteps({
      sprints: [sprint({ interruptBuffer: { points: 2 } })],
      items: [item()],
    });
    expect(steps[0]).toMatchObject({ id: "interrupt-buffer-over", href: "/sprint?sprint=s2" });
    expect(steps[0].detail).toBe(
      "Sprint 2's buffer is spent: 3 of 2 points used: 1 point over the buffer."
    );
  });

  it("asks to plan a buffer after sprints with interrupts, and to look at them at the retro", () => {
    const steps = interruptBufferSteps({
      sprints: [
        sprint({ status: "planned" }),
        sprint({
          id: "s1",
          name: "Sprint 1",
          status: "completed",
          endDate: "2026-11-06",
          startDate: "2026-10-26",
        }),
      ],
      items: [item({ sprintId: "s1" })],
    });
    expect(ids(steps)).toEqual(["interrupt-buffer-plan", "interrupt-buffer-retro"]);
    expect(steps[0].href).toBe("/sprint-planning?sprint=s2");
    expect(steps[1].detail).toBe("Sprint 1 logged 1 interrupt, 3 points.");
  });

  it("stays quiet within the buffer, with no interrupts, and for examples", () => {
    expect(
      interruptBufferSteps({
        sprints: [sprint({ interruptBuffer: { points: 8 } })],
        items: [item()],
      })
    ).toEqual([]);
    expect(interruptBufferSteps({ sprints: [sprint()], items: [] })).toEqual([]);
    expect(
      interruptBufferSteps({
        sprints: [sprint({ id: "example-s", interruptBuffer: { points: 1 } })],
        items: [item({ id: "example-i", sprintId: "example-s" })],
      })
    ).toEqual([]);
  });
});
