/**
 * `workspace.sprint_series.*`: a sprint's daily log and ratings, reachable
 * by agents. `update` writes the parsed record, so every SprintSeries field
 * must be in the Zod schema or the next unrelated update erases it.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { SprintSeries } from "@/lib/stores/workspace-types";

import "@/lib/actions/workspace";

const ctx = () => ({ userId: "u", source: "agent" as const, squadProfileIds: [] as string[] });

function action(name: string) {
  const a = registry.get(`workspace.sprint_series.${name}`);
  expect(a, `workspace.sprint_series.${name}`).toBeDefined();
  return a!;
}

const SERIES: SprintSeries = {
  id: "sprint_1",
  days: [
    { day: 0, remaining: 40, scope: 40 },
    { day: 1, remaining: 36, note: "Login done" },
    { day: 2, completed: 9, scope: 44, scopeChange: true },
  ],
  ratings: { "Team morale": 7, Collaboration: 8 },
  migratedFrom: ["agile-toolkit:burndown"],
  updatedAt: "2026-10-19T09:00:00.000Z",
};

beforeEach(() => {
  useWorkspaceStore.setState({ sprints: [], sprintSeries: [] });
});

describe("workspace.sprint_series", () => {
  it("keeps the daily log when ratings are patched, and the reverse", async () => {
    await action("create").handler({ entity: structuredClone(SERIES) }, ctx());

    await action("update").handler(
      { id: "sprint_1", patch: { ratings: { "Team morale": 9 } } },
      ctx()
    );
    let stored = useWorkspaceStore.getState().sprintSeries?.[0];
    expect(stored?.days).toEqual(SERIES.days);
    expect(stored?.migratedFrom).toEqual(["agile-toolkit:burndown"]);
    expect(stored?.ratings).toEqual({ "Team morale": 9 });

    await action("update").handler(
      { id: "sprint_1", patch: { days: [{ day: 0, remaining: 38 }] } },
      ctx()
    );
    stored = useWorkspaceStore.getState().sprintSeries?.[0];
    expect(stored?.ratings).toEqual({ "Team morale": 9 });
    expect(stored?.days).toEqual([{ day: 0, remaining: 38 }]);
    expect(stored?.updatedAt).toBe(SERIES.updatedAt);
  });

  it("needs the sprint's id: a create without one is rejected", () => {
    const { id: _id, ...noId } = SERIES;
    void _id;
    expect(action("create").paramsSchema.safeParse({ entity: noId }).success).toBe(false);
    expect(action("create").paramsSchema.safeParse({ entity: SERIES }).success).toBe(true);
  });

  it("lists and deletes", async () => {
    await action("create").handler({ entity: structuredClone(SERIES) }, ctx());
    const listed = (await action("list").handler({}, ctx())) as { items: SprintSeries[] };
    expect(listed.items.map((s) => s.id)).toEqual(["sprint_1"]);

    await action("delete").handler({ id: "sprint_1" }, ctx());
    expect(useWorkspaceStore.getState().sprintSeries).toEqual([]);
  });
});
