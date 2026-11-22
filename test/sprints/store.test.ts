/**
 * Removing a sprint from a sprint tool, then Undo, puts back everything the
 * removal took: the sprint, its series, and the story and canvas links that
 * `removeSprint` cleared. The story writers return the story as the store
 * saved it, after its own stamps and cleaning.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint } from "@/lib/stores/workspace-types";
import {
  removeSprintWithSeries,
  setStoryBlocked,
  setStoryDodCheck,
  setStorySprint,
  setStoryStatus,
  updateSeries,
  updateSprint,
} from "@/lib/sprints/store";
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

describe("the story writers return the story as saved", () => {
  // Set straight into the state, so the store's cleaning hasn't run on it:
  // the next write through `upsertStory` trims the notes.
  beforeEach(() => {
    useWorkspaceStore.setState({
      stories: [
        { id: "st1", title: "Login", status: "todo", sprintId: "sprint_1", notes: "  Use SSO  " },
      ],
    });
  });

  const stored = () => useWorkspaceStore.getState().stories.find((s) => s.id === "st1");

  it("setStoryStatus re-reads the row after the write", () => {
    const saved = setStoryStatus("st1", "in_progress", "2026-11-23T09:00:00.000Z");
    expect(saved).toBe(stored());
    expect(saved).toMatchObject({ status: "in_progress", notes: "Use SSO" });
  });

  it("setStoryBlocked re-reads the row after the write", () => {
    const saved = setStoryBlocked("st1", true);
    expect(saved).toBe(stored());
    expect(saved).toMatchObject({ blocked: true, notes: "Use SSO" });
  });

  it("setStorySprint and setStoryDodCheck do too", () => {
    expect(setStorySprint("st1", undefined)).toBe(stored());
    expect(stored()?.notes).toBe("Use SSO");
    expect(setStoryDodCheck("st1", "tests", true)).toBe(stored());
  });

  it("writes nothing and gives the stored row back when nothing changes", () => {
    const before = useWorkspaceStore.getState().stories;
    expect(setStoryStatus("st1", "todo")).toBe(before[0]);
    expect(setStoryBlocked("st1", false)).toBe(before[0]);
    expect(useWorkspaceStore.getState().stories).toBe(before);
  });
});
