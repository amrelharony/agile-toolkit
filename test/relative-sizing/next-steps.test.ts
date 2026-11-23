/**
 * Relative Sizing's next steps (lib/relative-sizing/next-steps): five or
 * more unsized backlog stories ask to be sized together; otherwise sized
 * ones with no sprint being planned ask for Sprint Planning. Examples never
 * count.
 */

import { describe, expect, it } from "vitest";
import { relativeSizingSteps } from "@/lib/relative-sizing/next-steps";
import { UNSIZED_BATCH_MIN } from "@/lib/relative-sizing/unsized";
import { getNextStepRule, loadNextStepRule } from "@/lib/tools/next-steps";
import {
  emptyWorkspace,
  type Sprint,
  type Story,
  type Workspace,
} from "@/lib/stores/workspace-types";

const story = (id: string, over: Partial<Story> = {}): Story => ({
  id,
  title: `Story ${id}`,
  status: "backlog",
  ...over,
});
const sprint = (over: Partial<Sprint> = {}): Sprint => ({
  id: "s1",
  name: "Sprint 1",
  startDate: "2026-11-23",
  endDate: "2026-12-04",
  pointsPlanned: 20,
  status: "planned",
  ...over,
});
const unsized = (n: number) => Array.from({ length: n }, (_, i) => story(`u${i}`));

describe("relativeSizingSteps", () => {
  it("asks to size five or more unsized stories together", () => {
    const steps = relativeSizingSteps({ stories: unsized(UNSIZED_BATCH_MIN), sprints: [] });
    expect(steps).toEqual([
      expect.objectContaining({
        id: "relative-sizing-unsized",
        label: "Size the 5 unsized backlog stories together",
        href: "/relative-sizing?stories=unsized",
      }),
    ]);
  });

  it("leaves examples and stories in a sprint out of the count", () => {
    const stories = [
      ...unsized(UNSIZED_BATCH_MIN - 1),
      story("example-1"),
      story("x", { sprintId: "s1" }),
    ];
    expect(relativeSizingSteps({ stories, sprints: [] }).map((s) => s.id)).not.toContain(
      "relative-sizing-unsized"
    );
  });

  it("points sized stories at Sprint Planning while no sprint is being planned", () => {
    const stories = [story("a", { points: 3 }), story("b", { points: 5 })];
    expect(relativeSizingSteps({ stories, sprints: [] })[0]).toMatchObject({
      id: "relative-sizing-plan-sprint",
      href: "/sprint-planning",
    });
    const planning = [...stories, story("c", { sprintId: "s1", status: "todo", points: 2 })];
    expect(relativeSizingSteps({ stories: planning, sprints: [sprint()] })).toEqual([]);
    const done = [...stories, story("c", { sprintId: "s1", status: "done", points: 2 })];
    expect(
      relativeSizingSteps({ stories: done, sprints: [sprint({ status: "completed" })] })
    ).toHaveLength(1);
  });

  it("says nothing with nothing to size", () => {
    expect(relativeSizingSteps({ stories: [], sprints: [] })).toEqual([]);
  });

  it("is the rule next-steps.ts runs for the page", async () => {
    await loadNextStepRule("relative-sizing");
    const rule = getNextStepRule("relative-sizing")!;
    const ws = { ...emptyWorkspace, stories: unsized(6) } as Workspace;
    expect(rule.steps(rule.select(ws)).map((s) => s.id)).toEqual(["relative-sizing-unsized"]);
  });
});
