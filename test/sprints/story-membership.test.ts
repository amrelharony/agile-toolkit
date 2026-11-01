/**
 * A story's sprint moves (Story.sprintHistory) and its creation stamp:
 *
 *   - withStorySprint records a move (and a carry-over), capped, and is a
 *     no-op when the sprint doesn't change;
 *   - stampStoryMembership stamps new stories and changed sprints, and keeps
 *     a history the write set itself (an Undo);
 *   - the workspace store stamps every local write, including removeSprint;
 *   - agents' writes (stampStoryWrite) are stamped the same way.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Story } from "@/lib/stores/workspace-types";
import {
  STORY_SPRINT_HISTORY_CAP,
  stampStoryMembership,
  stampStoryWrite,
  withStorySprint,
} from "@/lib/sprints/story-status";
import { setStorySprint } from "@/lib/sprints/store";

const AT = "2026-10-20T09:00:00.000Z";
const LATER = "2026-10-22T15:30:00.000Z";

const story = (over: Partial<Story> = {}): Story => ({
  id: "st1",
  title: "Checkout",
  status: "todo",
  points: 5,
  ...over,
});

const ws = () => useWorkspaceStore.getState();
const stored = (id = "st1") => ws().stories.find((s) => s.id === id);

describe("withStorySprint", () => {
  it("records a move with the sprint it left and the points it had", () => {
    const moved = withStorySprint(story({ sprintId: "s1" }), "s2", AT);
    expect(moved.sprintId).toBe("s2");
    expect(moved.sprintHistory).toEqual([{ sprintId: "s2", from: "s1", at: AT, points: 5 }]);
  });

  it("records a move back to the backlog without a sprint, and a carry-over", () => {
    const out = withStorySprint(story({ sprintId: "s1" }), undefined, AT);
    expect(out).not.toHaveProperty("sprintId");
    expect(out.sprintHistory).toEqual([{ from: "s1", at: AT, points: 5 }]);
    const carried = withStorySprint(story({ sprintId: "s1" }), "s2", AT, { carriedOver: true });
    expect(carried.sprintHistory?.[0]).toMatchObject({ carriedOver: true });
  });

  it("leaves an unestimated story's points out, and is a no-op on the same sprint", () => {
    const s = story({ sprintId: "s1", points: undefined });
    expect(withStorySprint(s, "s1", AT)).toBe(s);
    expect(withStorySprint(s, "s2", AT).sprintHistory?.[0]).not.toHaveProperty("points");
  });

  it("keeps only the latest moves", () => {
    let s = story();
    for (let i = 0; i < STORY_SPRINT_HISTORY_CAP + 5; i++) {
      s = withStorySprint(s, i % 2 === 0 ? `s${i}` : undefined, AT);
    }
    expect(s.sprintHistory).toHaveLength(STORY_SPRINT_HISTORY_CAP);
    expect(s.sprintHistory?.at(-1)).toMatchObject({ sprintId: `s${STORY_SPRINT_HISTORY_CAP + 4}` });
  });
});

describe("stampStoryMembership", () => {
  it("stamps a new story's creation, and its sprint as the first move", () => {
    const out = stampStoryMembership(story({ sprintId: "s1" }), undefined, AT);
    expect(out.createdAt).toBe(AT);
    expect(out.sprintHistory).toEqual([{ sprintId: "s1", at: AT, points: 5 }]);
    // A backlog story only gets its creation.
    expect(stampStoryMembership(story(), undefined, AT)).toEqual({ ...story(), createdAt: AT });
  });

  it("keeps a creation stamp and history a new record brings", () => {
    const brought = story({
      createdAt: "2026-01-01",
      sprintId: "s1",
      sprintHistory: [{ sprintId: "s1", at: "2026-01-01" }],
    });
    expect(stampStoryMembership(brought, undefined, AT)).toBe(brought);
  });

  it("records a change of sprint, and nothing when it stays", () => {
    const prev = story({ sprintId: "s1", sprintHistory: [{ sprintId: "s1", at: AT }] });
    const next = { ...prev, sprintId: "s2" };
    expect(stampStoryMembership(next, prev, LATER).sprintHistory).toEqual([
      { sprintId: "s1", at: AT },
      { sprintId: "s2", from: "s1", at: LATER, points: 5 },
    ]);
    const retitled = { ...prev, title: "Checkout v2" };
    expect(stampStoryMembership(retitled, prev, LATER)).toBe(retitled);
  });

  it("keeps a history the write set itself, as an Undo does", () => {
    const prev = story({ sprintId: "s2", sprintHistory: [{ sprintId: "s2", at: AT }] });
    const restored = story({ sprintId: "s1", sprintHistory: [] });
    expect(stampStoryMembership(restored, prev, LATER)).toBe(restored);
  });
});

describe("the workspace store", () => {
  beforeEach(() => useWorkspaceStore.setState({ stories: [], sprints: [] }));

  it("stamps every local write of a story", () => {
    ws().upsertStory(story());
    expect(stored()?.createdAt).toEqual(expect.any(String));
    ws().upsertStory({ ...stored()!, sprintId: "s1" });
    ws().upsertStory({ ...stored()!, sprintId: undefined });
    expect(stored()?.sprintHistory?.map((c) => [c.from ?? null, c.sprintId ?? null])).toEqual([
      [null, "s1"],
      ["s1", null],
    ]);
  });

  it("records the stories a removed sprint leaves", () => {
    useWorkspaceStore.setState({
      sprints: [
        {
          id: "s1",
          name: "S1",
          startDate: "2026-10-12",
          endDate: "2026-10-23",
          pointsPlanned: 5,
          status: "active",
        },
      ],
      stories: [story({ sprintId: "s1" })],
    });
    ws().removeSprint("s1");
    expect(stored()).not.toHaveProperty("sprintId");
    expect(stored()?.sprintHistory).toEqual([{ from: "s1", at: expect.any(String), points: 5 }]);
  });

  it("setStorySprint marks a carry-over", () => {
    useWorkspaceStore.setState({ stories: [story({ sprintId: "s1" })] });
    setStorySprint("st1", "s2", { at: AT, carriedOver: true });
    expect(stored()?.sprintHistory).toEqual([
      { sprintId: "s2", from: "s1", at: AT, points: 5, carriedOver: true },
    ]);
    expect(setStorySprint("nope", "s2")).toBeNull();
  });
});

describe("agents' writes", () => {
  it("stamp the sprint move and the status change together", () => {
    const prev = story({ sprintId: "s1", status: "todo" });
    const out = stampStoryWrite({ ...prev, sprintId: "s2", status: "in_progress" }, prev, AT);
    expect(out.startedAt).toBe(AT);
    expect(out.sprintHistory).toEqual([{ sprintId: "s2", from: "s1", at: AT, points: 5 }]);
  });
});
