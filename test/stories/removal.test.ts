/**
 * What a story row's remove control may do (delete, leave a running sprint,
 * or nothing), and the delete itself: the story goes with the Canvas links
 * the store's cascade clears, and Undo puts all of it back as it was.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint, Story, WhiteboardObject } from "@/lib/stores/workspace-types";
import { deleteStoryKeepingUndo } from "@/lib/stories/delete";
import { keptForSprintNote, sprintKeepingStory, storyRemoval } from "@/lib/stories/removal";
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

describe("a story that has left a sprint it was part of", () => {
  // The sprints run 5 to 16 October.
  const joined = "2026-10-05T08:00:00.000Z";
  const during = "2026-10-08T08:00:00.000Z";
  const after = "2026-10-19T08:00:00.000Z";
  const moved = (from: string, at: string, to?: string) => ({
    ...(to ? { sprintId: to } : {}),
    from,
    at,
  });

  it("stays locked in the backlog after it is removed from a running sprint", () => {
    const removed = story({
      sprintHistory: [{ sprintId: "active", at: joined }, moved("active", during)],
    });
    expect(storyRemoval(removed, SPRINTS)).toBe("locked");
    expect(sprintKeepingStory(removed, SPRINTS)?.id).toBe("active");
  });

  it("stays locked when a closed sprint's left-over is carried over or sent back", () => {
    for (const closed of ["completed", "cancelled"]) {
      const history = [{ sprintId: closed, at: joined }];
      const carried = story({
        status: "in_progress",
        sprintId: "planned",
        sprintHistory: [...history, moved(closed, after, "planned")],
      });
      expect(storyRemoval(carried, SPRINTS)).toBe("locked");
      expect(sprintKeepingStory(carried, SPRINTS)?.id).toBe(closed);
      const sentBack = story({ sprintHistory: [...history, moved(closed, after)] });
      expect(storyRemoval(sentBack, SPRINTS)).toBe("locked");
      // The close dialog's own carry-over is flagged, and counts the same.
      const atClose = story({
        sprintHistory: [...history, { ...moved(closed, after), carriedOver: true }],
      });
      expect(storyRemoval(atClose, SPRINTS)).toBe("locked");
    }
  });

  it("names the latest sprint it left when it was part of several", () => {
    const twice = story({
      sprintHistory: [
        { sprintId: "completed", at: joined },
        moved("completed", during, "active"),
        moved("active", "2026-10-09T08:00:00.000Z"),
      ],
    });
    expect(sprintKeepingStory(twice, SPRINTS)?.id).toBe("active");
  });

  it("can still be deleted when it only ever left sprints that are planned or gone", () => {
    const replanned = story({
      sprintHistory: [
        { sprintId: "planned", at: joined },
        moved("planned", during),
        { sprintId: "deleted-sprint", at: during },
        moved("deleted-sprint", after),
      ],
    });
    expect(storyRemoval(replanned, SPRINTS)).toBe("delete");
    expect(sprintKeepingStory(replanned, SPRINTS)).toBeUndefined();
  });

  it("can still be deleted when it left while the sprint was being planned", () => {
    // Ticked in and out before the sprint's first day: its board never had it.
    const planning = story({
      sprintHistory: [
        { sprintId: "active", at: "2026-10-01T08:00:00.000Z" },
        moved("active", "2026-10-02T08:00:00.000Z"),
      ],
    });
    expect(storyRemoval(planning, SPRINTS)).toBe("delete");
  });

  it("leaves a story that is in a started sprint now to that sprint's rule", () => {
    const history = [{ sprintId: "completed", at: joined }, moved("completed", after, "active")];
    const carried = story({ status: "todo", sprintId: "active", sprintHistory: history });
    expect(storyRemoval(carried, SPRINTS)).toBe("remove-from-sprint");
    expect(sprintKeepingStory(carried, SPRINTS)).toBeUndefined();
    // Done is locked as done, with no sprint to name.
    expect(sprintKeepingStory(story({ status: "done", sprintHistory: history }), SPRINTS)).toBe(
      undefined
    );
  });

  it("reads past sprint moves that aren't what the type says", () => {
    const odd = story({
      sprintHistory: [null, "x", { from: "active" }, { from: "active", at: "soon" }] as never,
    });
    expect(storyRemoval(odd, SPRINTS)).toBe("delete");
    expect(storyRemoval(story({ sprintHistory: "none" as never }), SPRINTS)).toBe("delete");
  });

  it("says why in the same words on both pages", () => {
    expect(keptForSprintNote("Sprint 5")).toBe("Was in Sprint 5, so it can't be deleted");
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
    // So the story is kept once it is out, too: no bin in the backlog.
    expect(storyRemoval(removed, [active])).toBe("locked");
  });

  it("keeps a closed sprint's past: a left-over that moved on still counts in it", () => {
    const closed: Sprint = { ...sprint("completed", "completed"), pointsPlanned: 8 };
    const joined = "2026-10-05T08:00:00.000Z";
    const finished = story({
      id: "a",
      status: "done",
      sprintId: "completed",
      points: 5,
      startedAt: "2026-10-06T09:00:00.000Z",
      doneAt: "2026-10-09T09:00:00.000Z",
      statusHistory: [
        { status: "in_progress", from: "todo", at: "2026-10-06T09:00:00.000Z" },
        { status: "done", from: "in_progress", at: "2026-10-09T09:00:00.000Z" },
      ],
      sprintHistory: [{ sprintId: "completed", at: joined, points: 5 }],
    });
    // Not done when the sprint closed; Sprint Planning carried it over.
    const carried = story({
      id: "b",
      status: "todo",
      sprintId: "planned",
      points: 3,
      sprintHistory: [
        { sprintId: "completed", at: joined, points: 3 },
        { sprintId: "planned", from: "completed", at: "2026-10-19T08:00:00.000Z", points: 3 },
      ],
    });
    const read = (stories: Story[]) =>
      burnSeries({
        sprint: closed,
        series: undefined,
        stories,
        today: "2026-10-20",
        prefer: "stories",
      });
    const lastDay = (stories: Story[]) => read(stories).days.at(-1);
    expect(lastDay([finished, carried])).toMatchObject({ scope: 8, done: 5 });
    // Deleted from the next sprint, the closed one would read as all done.
    expect(lastDay([finished])).toMatchObject({ scope: 5, done: 5 });
    expect(storyRemoval(carried, [closed, sprint("planned", "planned")])).toBe("locked");
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

  /** How many times the store is written (each write saves the whole workspace). */
  const countWrites = (run: () => void) => {
    let writes = 0;
    const stop = useWorkspaceStore.subscribe(() => {
      writes += 1;
    });
    run();
    stop();
    return writes;
  };

  it("removes several stories in one write, with the Canvas links of each", () => {
    useWorkspaceStore.setState({
      whiteboardObjects: [
        card("pinned-a", { sourceRef: { tool: "story", entityId: "a" } }),
        card("wizard-c", { sourceRef: { tool: "backlog", entityId: "c" } }),
        card("vote-c", { type: "voting", storyId: "c" } as Partial<WhiteboardObject>),
        card("pinned-b", { sourceRef: { tool: "story", entityId: "b" } }),
        card("plain"),
      ],
    });
    const after = (id: string) => ws().whiteboardObjects?.find((o) => o.id === id);
    expect(countWrites(() => ws().removeStories(["a", "c", "nope"]))).toBe(1);
    expect(ws().stories.map((s) => s.id)).toEqual(["b"]);
    expect(after("pinned-a")).toMatchObject({ version: 2 });
    expect(after("pinned-a")?.sourceRef).toBeUndefined();
    expect(after("wizard-c")?.sourceRef).toBeUndefined();
    expect((after("vote-c") as { storyId?: string }).storyId).toBeUndefined();
    // The story that stayed keeps its card, untouched.
    expect(after("pinned-b")).toMatchObject({
      sourceRef: { tool: "story", entityId: "b" },
      version: 1,
    });
    expect(after("plain")?.version).toBe(1);
  });

  it("writes nothing when none of the stories is there", () => {
    const before = ws().stories;
    expect(countWrites(() => ws().removeStories([]))).toBe(0);
    expect(countWrites(() => ws().removeStories(["nope"]))).toBe(0);
    expect(ws().stories).toBe(before);
  });

  it("removes one story as it always did", () => {
    useWorkspaceStore.setState({
      whiteboardObjects: [
        card("pinned", { sourceRef: { tool: "story", entityId: "b" } }),
        card("vote", { type: "voting", storyId: "b" } as Partial<WhiteboardObject>),
        card("other", { sourceRef: { tool: "story", entityId: "a" } }),
        // A voting widget with no story is not a link to anything.
        card("free-vote", { type: "voting" } as Partial<WhiteboardObject>),
      ],
    });
    const after = (id: string) => ws().whiteboardObjects?.find((o) => o.id === id);
    ws().removeStory("b");
    expect(ws().stories.map((s) => s.id)).toEqual(["a", "c"]);
    expect(after("pinned")?.sourceRef).toBeUndefined();
    expect((after("vote") as { storyId?: string }).storyId).toBeUndefined();
    expect(after("other")?.version).toBe(1);
    expect(after("free-vote")?.version).toBe(1);
  });
});

describe("adding several stories in one write", () => {
  const ws = () => useWorkspaceStore.getState();

  beforeEach(() => {
    useWorkspaceStore.setState({
      stories: [story({ id: "kept", title: "Kept", createdAt: "2026-10-01T00:00:00.000Z" })],
    });
  });

  it("stamps each new story as a single write does: created, and joined its sprint", () => {
    let writes = 0;
    const stop = useWorkspaceStore.subscribe(() => {
      writes += 1;
    });
    ws().bulkUpsertStories([
      story({ id: "n1", title: "New in the backlog" }),
      story({ id: "n2", title: "New in a sprint", status: "todo", sprintId: "planned", points: 3 }),
    ]);
    stop();
    expect(writes).toBe(1);
    const [kept, n1, n2] = ws().stories;
    expect(kept.createdAt).toBe("2026-10-01T00:00:00.000Z");
    expect(n1.createdAt).toEqual(expect.any(String));
    expect(n1.sprintHistory).toBeUndefined();
    // One time for the batch.
    expect(n2.createdAt).toBe(n1.createdAt);
    expect(n2.sprintHistory).toEqual([{ sprintId: "planned", at: n2.createdAt, points: 3 }]);
  });

  it("records a change of sprint on a story it already holds, and keeps its place", () => {
    ws().bulkUpsertStories([
      story({ id: "kept", title: "Kept", status: "todo", sprintId: "planned" }),
      story({ id: "n1", title: "New" }),
    ]);
    expect(ws().stories.map((s) => s.id)).toEqual(["kept", "n1"]);
    expect(ws().stories[0].sprintHistory).toMatchObject([{ sprintId: "planned" }]);
    // An empty batch changes nothing.
    const before = ws().stories;
    ws().bulkUpsertStories([]);
    expect(ws().stories).toBe(before);
  });
});
