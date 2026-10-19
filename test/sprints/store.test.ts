/**
 * Removing a sprint from a sprint tool, then Undo, puts back everything the
 * removal took: the sprint, its series, and the story and canvas links that
 * `removeSprint` cleared.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint } from "@/lib/stores/workspace-types";
import { removeSprintWithSeries, updateSeries, updateSprint } from "@/lib/sprints/store";
import { withDay } from "@/lib/sprints/series";
import { cardFixture } from "../canvas/object-fixtures";

const SPRINT: Sprint = {
  id: "sprint_1",
  name: "Sprint 1",
  startDate: "2026-10-05",
  endDate: "2026-10-16",
  pointsPlanned: 40,
  status: "active",
};

beforeEach(() => {
  useWorkspaceStore.getState().resetWorkspace();
  const ws = useWorkspaceStore.getState();
  ws.upsertSprint(SPRINT);
  ws.upsertStory({ id: "st1", title: "Login", status: "todo", sprintId: "sprint_1" });
  ws.upsertStory({ id: "st2", title: "Logout", status: "todo", sprintId: "sprint_1" });
  ws.upsertWhiteboardObjects([
    cardFixture({ id: "card1", sourceRef: { tool: "sprint", entityId: "sprint_1" } }),
  ]);
  updateSeries("sprint_1", (s) => withDay(s, 0, { remaining: 40 }));
});

describe("removeSprintWithSeries", () => {
  it("removes the sprint, its series and its links, and Undo restores them", () => {
    const undo = removeSprintWithSeries("sprint_1");
    let state = useWorkspaceStore.getState();
    expect(state.sprints).toEqual([]);
    expect(state.sprintSeries).toEqual([]);
    expect(state.stories.every((s) => s.sprintId === undefined)).toBe(true);
    expect(state.whiteboardObjects?.[0].sourceRef).toBeUndefined();

    // Meanwhile, one story was planned into another sprint.
    useWorkspaceStore
      .getState()
      .upsertStory({ id: "st2", title: "Logout", status: "todo", sprintId: "sprint_9" });

    undo!();
    state = useWorkspaceStore.getState();
    expect(state.sprints).toEqual([SPRINT]);
    expect(state.sprintSeries?.[0].days).toEqual([{ day: 0, remaining: 40 }]);
    expect(state.stories.find((s) => s.id === "st1")?.sprintId).toBe("sprint_1");
    // Not pulled back from the sprint it moved to.
    expect(state.stories.find((s) => s.id === "st2")?.sprintId).toBe("sprint_9");
    expect(state.whiteboardObjects?.[0].sourceRef).toEqual({
      tool: "sprint",
      entityId: "sprint_1",
    });
  });

  it("returns null for an unknown sprint", () => {
    expect(removeSprintWithSeries("nope")).toBeNull();
  });
});

describe("updateSprint", () => {
  it("patches a stored sprint and ignores unknown ids", () => {
    expect(updateSprint("sprint_1", { pointsCompleted: 31 })?.pointsCompleted).toBe(31);
    expect(useWorkspaceStore.getState().sprints[0].pointsCompleted).toBe(31);
    expect(updateSprint("nope", { name: "x" })).toBeNull();
  });
});
