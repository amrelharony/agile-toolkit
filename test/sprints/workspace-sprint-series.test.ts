/**
 * The workspace's `sprintSeries` slice: removed with its sprint, carried by
 * export and import, cleared by reset.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint, SprintSeries } from "@/lib/stores/workspace-types";

const SPRINT: Sprint = {
  id: "sprint_1",
  name: "Sprint 1",
  startDate: "2026-10-05",
  endDate: "2026-10-16",
  pointsPlanned: 40,
  status: "active",
};
const OTHER: Sprint = { ...SPRINT, id: "sprint_2", name: "Sprint 2", status: "planned" };
const SERIES: SprintSeries = { id: "sprint_1", days: [{ day: 0, remaining: 40 }] };
const OTHER_SERIES: SprintSeries = { id: "sprint_2", ratings: { Focus: 6 } };

beforeEach(() => {
  useWorkspaceStore.getState().resetWorkspace();
});

describe("sprintSeries slice", () => {
  it("upserts by id and removes", () => {
    const ws = useWorkspaceStore.getState();
    ws.upsertSprintSeries(SERIES);
    ws.upsertSprintSeries({ ...SERIES, days: [{ day: 0, remaining: 39 }] });
    expect(useWorkspaceStore.getState().sprintSeries).toEqual([
      { id: "sprint_1", days: [{ day: 0, remaining: 39 }] },
    ]);
    useWorkspaceStore.getState().removeSprintSeries("sprint_1");
    expect(useWorkspaceStore.getState().sprintSeries).toEqual([]);
  });

  it("goes with its sprint when the sprint is removed", () => {
    const ws = useWorkspaceStore.getState();
    ws.upsertSprint(SPRINT);
    ws.upsertSprint(OTHER);
    ws.upsertSprintSeries(SERIES);
    ws.upsertSprintSeries(OTHER_SERIES);

    useWorkspaceStore.getState().removeSprint("sprint_1");
    const state = useWorkspaceStore.getState();
    expect(state.sprints.map((s) => s.id)).toEqual(["sprint_2"]);
    expect(state.sprintSeries?.map((s) => s.id)).toEqual(["sprint_2"]);
  });

  it("leaves the series slice alone when the sprint has none", () => {
    const ws = useWorkspaceStore.getState();
    ws.upsertSprint(SPRINT);
    ws.upsertSprintSeries(OTHER_SERIES);
    const before = useWorkspaceStore.getState().sprintSeries;
    useWorkspaceStore.getState().removeSprint("sprint_1");
    expect(useWorkspaceStore.getState().sprintSeries).toBe(before);
  });

  it("round-trips through export and import, and reset clears it", () => {
    const ws = useWorkspaceStore.getState();
    ws.upsertSprint(SPRINT);
    ws.upsertSprintSeries(SERIES);
    const json = useWorkspaceStore.getState().exportJSON();

    useWorkspaceStore.getState().resetWorkspace();
    expect(useWorkspaceStore.getState().sprintSeries).toEqual([]);

    useWorkspaceStore.getState().importJSON(json);
    expect(useWorkspaceStore.getState().sprintSeries).toEqual([SERIES]);
  });
});
