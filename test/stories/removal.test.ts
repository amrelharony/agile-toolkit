/**
 * What a story row's remove control may do (delete, leave a running sprint,
 * or nothing), and the delete itself: the story goes with the Canvas links
 * the store's cascade clears, and Undo puts all of it back as it was.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint, Story, WhiteboardObject } from "@/lib/stores/workspace-types";
import { deleteStoryKeepingUndo } from "@/lib/stories/delete";
import { storyRemoval } from "@/lib/stories/removal";
import { liveLink } from "@/lib/handoffs/registry";
import { burnSeries } from "@/lib/sprints/burn";

const sprint = (id: string, status: Sprint["status"]): Sprint => ({
  id,
  name: id,
  startDate: "2026-10-05",
  endDate: "2026-10-16",
  pointsPlanned: 0,
  status,
});
const SPRINTS = [
  sprint("planned", "planned"),
  sprint("active", "active"),
  sprint("completed", "completed"),
  sprint("cancelled", "cancelled"),
];
const story = (over: Partial<Story> = {}): Story => ({
  id: "st1",
  title: "Pay with a saved card",
  status: "backlog",
  ...over,
});

describe("what the remove control may do", () => {
  it("deletes a story in the backlog or in a sprint that hasn't started", () => {
    expect(storyRemoval(story(), SPRINTS)).toBe("delete");
    expect(storyRemoval(story({ status: "todo", sprintId: "planned" }), SPRINTS)).toBe("delete");
    // Carried into a sprint that hasn't started, with work already begun.
    expect(storyRemoval(story({ status: "in_progress", sprintId: "planned" }), SPRINTS)).toBe(
      "delete"
    );
  });

  it("only takes a story out of a running sprint", () => {
    for (const status of ["todo", "in_progress", "review"] as const) {
      expect(storyRemoval(story({ status, sprintId: "active" }), SPRINTS)).toBe(
        "remove-from-sprint"
      );
    }
  });

  it("locks done stories and the stories of a closed sprint", () => {
    expect(storyRemoval(story({ status: "done" }), SPRINTS)).toBe("locked");
    expect(storyRemoval(story({ status: "done", sprintId: "planned" }), SPRINTS)).toBe("locked");
    expect(storyRemoval(story({ status: "done", sprintId: "active" }), SPRINTS)).toBe("locked");
    expect(storyRemoval(story({ status: "todo", sprintId: "completed" }), SPRINTS)).toBe("locked");
    expect(storyRemoval(story({ status: "todo", sprintId: "cancelled" }), SPRINTS)).toBe("locked");
  });

  it("treats a story whose sprint is gone as a backlog story", () => {
    expect(storyRemoval(story({ status: "todo", sprintId: "deleted-sprint" }), SPRINTS)).toBe(
      "delete"
    );
  });
});

describe("why a running sprint's story isn't deleted", () => {
  it("keeps the burnup's past: scope a deleted story was part of would vanish", () => {
    const active: Sprint = { ...sprint("active", "active"), pointsPlanned: 8 };
    const joined = "2026-10-05T08:00:00.000Z";
    const left = "2026-10-08T08:00:00.000Z";
    // Work began on day 1, so a later move is a change of scope, not the plan.
    const staying = story({
      id: "a",
      status: "in_progress",
      sprintId: "active",
      points: 5,
      startedAt: "2026-10-06T09:00:00.000Z",
      statusHistory: [{ status: "in_progress", from: "todo", at: "2026-10-06T09:00:00.000Z" }],
      sprintHistory: [{ sprintId: "active", at: joined, points: 5 }],
    });
    // "Remove from sprint" on day 3: its sprint moves stay on the story.
    const removed = story({
      id: "b",
      status: "backlog",
      points: 3,
      sprintHistory: [
        { sprintId: "active", at: joined, points: 3 },
        { from: "active", at: left, points: 3 },
      ],
    });
    const read = (stories: Story[]) =>
      burnSeries({ sprint: active, series: undefined, stories, today: "2026-10-09" });
    const kept = read([staying, removed]);
    // The first days still show its 3 points in scope, and the day it left.
    expect(kept.days[0].scope).toBe(8);
    expect(kept.days[4].scope).toBe(5);
    expect(kept.scopeRemoved).toBe(3);
    // Had it been deleted, the sprint would read 5 points from the start.
    const deleted = read([staying]);
    expect(deleted.days[0].scope).toBe(5);
    expect(deleted.scopeRemoved).toBe(0);
  });
});

describe("deleting a story, with a way back", () => {
  const card = (id: string, over: Partial<WhiteboardObject> = {}): WhiteboardObject =>
    ({
      id,
      type: "sticky",
      boardId: "wb1",
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      z: 1,
      version: 1,
      updatedAt: "2026-10-01T00:00:00.000Z",
      createdAt: "2026-10-01T00:00:00.000Z",
      content: "",
      kind: "note",
      label: "",
      ...over,
    }) as WhiteboardObject;

  const ws = () => useWorkspaceStore.getState();
  const A = story({ id: "a", title: "A" });
  const B = story({
    id: "b",
    title: "B",
    status: "todo",
    sprintId: "planned",
    notes: "Keep me",
    createdAt: "2026-10-01T00:00:00.000Z",
  });
  const C = story({ id: "c", title: "C" });

  beforeEach(() => {
    useWorkspaceStore.setState({ stories: [A, B, C], whiteboardObjects: [] });
  });

  it("removes the story, and the undo puts it back in its place exactly as it was", () => {
    const undo = deleteStoryKeepingUndo("b");
    expect(ws().stories.map((s) => s.id)).toEqual(["a", "c"]);
    undo?.();
    expect(ws().stories.map((s) => s.id)).toEqual(["a", "b", "c"]);
    // The same record: no new stamps, though it is in a sprint.
    expect(ws().stories[1]).toEqual(B);
  });

  it("puts it back at the end when the list got shorter meanwhile", () => {
    const undo = deleteStoryKeepingUndo("c");
    ws().removeStory("b");
    undo?.();
    expect(ws().stories.map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("does nothing for a story that isn't there, or one that is back already", () => {
    expect(deleteStoryKeepingUndo("nope")).toBeNull();
    const undo = deleteStoryKeepingUndo("b");
    undo?.();
    undo?.();
    expect(ws().stories.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("re-links the Canvas cards and voting widgets the delete unpinned", () => {
    useWorkspaceStore.setState({
      whiteboardObjects: [
        card("pinned", { sourceRef: { tool: "story", entityId: "b" } }),
        card("wizard", { sourceRef: { tool: "backlog", entityId: "b" } }),
        card("vote", { type: "voting", storyId: "b" } as Partial<WhiteboardObject>),
        card("other", { sourceRef: { tool: "story", entityId: "a" } }),
        card("repinned", { sourceRef: { tool: "story", entityId: "b" } }),
      ],
    });
    const undo = deleteStoryKeepingUndo("b");
    const after = (id: string) => ws().whiteboardObjects?.find((o) => o.id === id);
    expect(after("pinned")?.sourceRef).toBeUndefined();
    expect((after("vote") as { storyId?: string }).storyId).toBeUndefined();
    expect(after("other")?.sourceRef).toEqual({ tool: "story", entityId: "a" });
    // Someone pins one of them to another story before the undo.
    ws().upsertWhiteboardObjects([
      { ...after("repinned")!, sourceRef: { tool: "story", entityId: "a" } },
    ]);

    undo?.();
    expect(after("pinned")).toMatchObject({
      sourceRef: { tool: "story", entityId: "b" },
      version: 3,
    });
    expect(after("wizard")?.sourceRef).toEqual({ tool: "backlog", entityId: "b" });
    expect((after("vote") as { storyId?: string }).storyId).toBe("b");
    // A link made since is left alone.
    expect(after("repinned")?.sourceRef).toEqual({ tool: "story", entityId: "a" });
    expect(after("other")?.version).toBe(1);
  });

  it("leaves hand-off links to the existing rule: not sent while gone, sent again once back", () => {
    const links = [{ route: "backlog-story" as const, targetId: "b", at: "2026-10-01" }];
    expect(liveLink(links, "backlog-story")).toBeDefined();
    const undo = deleteStoryKeepingUndo("b");
    expect(liveLink(links, "backlog-story")).toBeUndefined();
    undo?.();
    expect(liveLink(links, "backlog-story")).toBeDefined();
  });
});
