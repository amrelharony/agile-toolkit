/**
 * A story's flow stamps: when work started, when it was done, the blocked
 * flag and a capped history of status changes. One pure rule
 * (`withStoryStatus`), used by the app's writer (`setStoryStatus`), by
 * agents' `workspace.story.create/update` (MCP path included) and by
 * `intent.plan_sprint`, so every status change leaves the same trail.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// The MCP path talks to the server store: an in-memory row per kind + id.
const rows = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverGetEntity: vi.fn(async (_u: string, kind: string, id: string) => {
      return rows.get(`${kind}/${id}`) ?? null;
    }),
    serverUpsertEntity: vi.fn(async (_u: string, kind: string, entity: { id: string }) => {
      rows.set(`${kind}/${entity.id}`, entity);
    }),
    serverListEntities: vi.fn(async (_u: string, kind: string) =>
      Array.from(rows.entries())
        .filter(([k]) => k.startsWith(`${kind}/`))
        .map(([, v]) => v)
    ),
  };
});

import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Story } from "@/lib/stores/workspace-types";
import {
  STORY_STATUS_HISTORY_CAP,
  isStoryStatus,
  stampRefinedWrite,
  stampStoryWrite,
  withRefinedPutBack,
  withStoryBlocked,
  withStoryStatus,
} from "@/lib/sprints/story-status";
import { setStoryBlocked, setStoryStatus } from "@/lib/sprints/store";

import "@/lib/actions/workspace/index";
import "@/lib/actions/intents/plan-sprint";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

const T1 = "2026-10-19T09:00:00.000Z";
const T2 = "2026-10-20T09:00:00.000Z";
const T3 = "2026-10-21T09:00:00.000Z";

const story = (over: Partial<Story> = {}): Story => ({
  id: "st1",
  title: "Login",
  status: "todo",
  sprintId: "s1",
  points: 3,
  ...over,
});

describe("withStoryStatus", () => {
  it("stamps the start on the move into progress and the finish on done", () => {
    const started = withStoryStatus(story(), "in_progress", T1);
    expect(started).toMatchObject({ status: "in_progress", startedAt: T1 });
    expect(started.doneAt).toBeUndefined();
    const reviewed = withStoryStatus(started, "review", T2);
    expect(reviewed.startedAt).toBe(T1); // still the first start
    const done = withStoryStatus(reviewed, "done", T3);
    expect(done).toMatchObject({ startedAt: T1, doneAt: T3 });
    expect(done.statusHistory).toEqual([
      { status: "in_progress", from: "todo", at: T1 },
      { status: "review", from: "in_progress", at: T2 },
      { status: "done", from: "review", at: T3 },
    ]);
  });

  it("starts and finishes at once when a story goes straight to done", () => {
    expect(withStoryStatus(story(), "done", T1)).toMatchObject({ startedAt: T1, doneAt: T1 });
  });

  it("clears the done time when a story is reopened, and both when it goes back", () => {
    const done = withStoryStatus(withStoryStatus(story(), "in_progress", T1), "done", T2);
    const reopened = withStoryStatus(done, "in_progress", T3);
    expect(reopened.startedAt).toBe(T1);
    expect("doneAt" in reopened).toBe(false);
    const back = withStoryStatus(reopened, "backlog", T3);
    expect("startedAt" in back).toBe(false);
    expect("doneAt" in back).toBe(false);
    expect(back.statusHistory).toHaveLength(4);
  });

  it("clears the blocked flag when a story is done, and keeps it otherwise", () => {
    const blocked = story({ blocked: true });
    expect(withStoryStatus(blocked, "in_progress", T1).blocked).toBe(true);
    expect("blocked" in withStoryStatus(blocked, "done", T1)).toBe(false);
  });

  it("returns the same story when the status doesn't change", () => {
    const s = story();
    expect(withStoryStatus(s, "todo", T1)).toBe(s);
  });

  it("keeps only the latest changes", () => {
    let s = story();
    for (let i = 0; i < STORY_STATUS_HISTORY_CAP + 20; i++) {
      s = withStoryStatus(s, i % 2 === 0 ? "in_progress" : "todo", `2026-10-19T09:00:${i}Z`);
    }
    expect(s.statusHistory).toHaveLength(STORY_STATUS_HISTORY_CAP);
    expect(s.statusHistory?.[STORY_STATUS_HISTORY_CAP - 1].at).toBe(
      `2026-10-19T09:00:${STORY_STATUS_HISTORY_CAP + 19}Z`
    );
  });

  it("never mutates the story it was given", () => {
    const s = Object.freeze(story({ blocked: true, statusHistory: Object.freeze([]) as never }));
    expect(() => withStoryStatus(s, "done", T1)).not.toThrow();
    expect(s.status).toBe("todo");
  });
});

describe("withStoryBlocked / isStoryStatus", () => {
  it("sets and removes the flag", () => {
    const s = story();
    expect(withStoryBlocked(s, false)).toBe(s);
    const b = withStoryBlocked(s, true);
    expect(b.blocked).toBe(true);
    expect("blocked" in withStoryBlocked(b, false)).toBe(false);
  });

  it("knows the five statuses", () => {
    expect(isStoryStatus("in_progress")).toBe(true);
    expect(isStoryStatus("Doing")).toBe(false);
    expect(isStoryStatus(undefined)).toBe(false);
  });
});

describe("stampStoryWrite (agents' writes)", () => {
  it("stamps a status change", () => {
    const prev = story();
    const next = stampStoryWrite({ ...prev, status: "in_progress" }, prev, T1);
    expect(next).toMatchObject({ startedAt: T1 });
    expect(next.statusHistory).toEqual([{ status: "in_progress", from: "todo", at: T1 }]);
  });

  it("keeps a stamp the write set itself (a backfill)", () => {
    const prev = story({ status: "in_progress", startedAt: T1 });
    const next = stampStoryWrite({ ...prev, status: "done", doneAt: T2 }, prev, T3);
    expect(next.doneAt).toBe(T2);
    expect(next.startedAt).toBe(T1);
  });

  it("changes nothing when the status is the same", () => {
    // The owner isn't what the story says, so no refinedAt either (below).
    const prev = story();
    const next = { ...prev, owner: "Sam" };
    expect(stampStoryWrite(next, prev, T1)).toBe(next);
  });

  it("stamps refinedAt when the title changes, beside the status stamps", () => {
    const prev = story();
    const next = stampStoryWrite({ ...prev, title: "Log in", status: "in_progress" }, prev, T1);
    expect(next).toMatchObject({ title: "Log in", startedAt: T1, refinedAt: T1 });
  });

  it("gives a new story the start and done times its status implies", () => {
    expect(stampStoryWrite(story({ status: "done" }), undefined, T1)).toMatchObject({
      startedAt: T1,
      doneAt: T1,
    });
    expect(stampStoryWrite(story({ status: "backlog" }), undefined, T1).startedAt).toBeUndefined();
    expect(
      stampStoryWrite(story({ status: "in_progress", startedAt: T2 }), undefined, T1).startedAt
    ).toBe(T2);
  });
});

describe("stampRefinedWrite (what the story says)", () => {
  it("stamps refinedAt when the title, points, notes or criteria change", () => {
    const prev = story({ refinedAt: T1 });
    for (const patch of [
      { title: "Log in" },
      { points: 5 },
      { notes: "Use the SSO page." },
      { acceptanceCriteria: "Signed in once." },
      { gwt: [{ id: "g1", given: "a user", when: "they sign in", then: "they see home" }] },
    ] satisfies Partial<Story>[]) {
      expect(
        stampRefinedWrite({ ...prev, ...patch }, prev, T2).refinedAt,
        Object.keys(patch)[0]
      ).toBe(T2);
    }
  });

  it("stamps nothing on a create, another field's change, or a write that sets it itself", () => {
    const fresh = story();
    expect(stampRefinedWrite(fresh, undefined, T1)).toBe(fresh);
    const prev = story();
    const moved = { ...prev, status: "done" as const, sprintId: "s2", owner: "Sam" };
    expect(stampRefinedWrite(moved, prev, T1)).toBe(moved);
    // An Undo putting an older copy back keeps that copy's stamp, or none.
    const refined = story({ title: "Log in", refinedAt: T2 });
    const undone = story();
    expect(stampRefinedWrite(undone, refined, T3)).toBe(undone);
  });

  it("is stamped by the store's writes, single and bulk", () => {
    useWorkspaceStore.setState({ stories: [story()] });
    useWorkspaceStore.getState().upsertStory({ ...story(), status: "in_progress" });
    expect(useWorkspaceStore.getState().stories[0].refinedAt).toBeUndefined();
    useWorkspaceStore
      .getState()
      .upsertStory({ ...useWorkspaceStore.getState().stories[0], points: 5 });
    expect(useWorkspaceStore.getState().stories[0].refinedAt).toEqual(expect.any(String));
    useWorkspaceStore.setState({ stories: [story()] });
    useWorkspaceStore.getState().bulkUpsertStories([{ ...story(), title: "Log in" }]);
    expect(useWorkspaceStore.getState().stories[0].refinedAt).toEqual(expect.any(String));
  });
});

describe("withRefinedPutBack (an Undo of its own change)", () => {
  it("puts the earlier stamp back while the story carries the undone write's", () => {
    const now = story({ refinedAt: T2 });
    expect(withRefinedPutBack(now, T2, T1).refinedAt).toBe(T1);
    const none = withRefinedPutBack(now, T2, undefined);
    expect(none).not.toHaveProperty("refinedAt");
    // The store then keeps it as written, so a stale story is stale again.
    const undone = withRefinedPutBack({ ...now, points: 5 }, T2, T1);
    expect(stampRefinedWrite(undone, now, T3).refinedAt).toBe(T1);
  });

  it("leaves a newer edit's stamp, or a write that stamped nothing, alone", () => {
    const later = story({ refinedAt: T3 });
    expect(withRefinedPutBack(later, T2, T1)).toBe(later);
    const unstamped = story({ refinedAt: T1 });
    expect(withRefinedPutBack(unstamped, T1, T1)).toBe(unstamped);
  });
});

describe("setStoryStatus / setStoryBlocked", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ stories: [story(), story({ id: "st2", title: "Logout" })] });
  });

  it("writes the stamped story and leaves the others alone", () => {
    const saved = setStoryStatus("st1", "in_progress", T1);
    expect(saved).toMatchObject({ status: "in_progress", startedAt: T1 });
    const stories = useWorkspaceStore.getState().stories;
    expect(stories.find((s) => s.id === "st1")).toEqual(saved);
    expect(stories.find((s) => s.id === "st2")).toEqual(story({ id: "st2", title: "Logout" }));
  });

  it("doesn't write when nothing changes, and is null for an unknown story", () => {
    const before = useWorkspaceStore.getState().stories;
    expect(setStoryStatus("st1", "todo", T1)).toEqual(story());
    expect(useWorkspaceStore.getState().stories).toBe(before);
    expect(setStoryStatus("nope", "done")).toBeNull();
    expect(setStoryBlocked("nope", true)).toBeNull();
  });

  it("flags and unflags a story", () => {
    expect(setStoryBlocked("st1", true)?.blocked).toBe(true);
    expect(setStoryBlocked("st1", false)?.blocked).toBeUndefined();
  });
});

describe("workspace.story actions", () => {
  beforeEach(() => {
    rows.clear();
    useWorkspaceStore.setState({ stories: [story()] });
  });

  it("an update that changes the status stamps it (browser path)", async () => {
    await registry
      .get("workspace.story.update")!
      .handler({ id: "st1", patch: { status: "done" } }, ctx());
    const saved = useWorkspaceStore.getState().stories[0];
    expect(saved.status).toBe("done");
    expect(saved.startedAt).toBeTruthy();
    expect(saved.doneAt).toBeTruthy();
    expect(saved.statusHistory).toEqual([{ status: "done", from: "todo", at: saved.doneAt }]);
  });

  it("an update keeps the stamps it doesn't touch (they are in the schema)", async () => {
    useWorkspaceStore.setState({
      stories: [
        story({
          status: "in_progress",
          startedAt: T1,
          blocked: true,
          statusHistory: [{ status: "in_progress", from: "todo", at: T1 }],
        }),
      ],
    });
    await registry
      .get("workspace.story.update")!
      .handler({ id: "st1", patch: { title: "Log in" } }, ctx());
    expect(useWorkspaceStore.getState().stories[0]).toMatchObject({
      title: "Log in",
      startedAt: T1,
      blocked: true,
      statusHistory: [{ status: "in_progress", from: "todo", at: T1 }],
    });
  });

  it("an update stamps refinedAt when what the story says changes, and later ones keep it", async () => {
    await registry
      .get("workspace.story.update")!
      .handler({ id: "st1", patch: { points: 5 } }, ctx());
    const refined = useWorkspaceStore.getState().stories[0].refinedAt;
    expect(refined).toEqual(expect.any(String));
    await registry
      .get("workspace.story.update")!
      .handler({ id: "st1", patch: { owner: "Sam" } }, ctx());
    expect(useWorkspaceStore.getState().stories[0].refinedAt).toBe(refined);
  });

  it("rejects a status that isn't one of the five", async () => {
    await expect(
      registry
        .get("workspace.story.update")!
        .handler({ id: "st1", patch: { status: "Doing" } }, ctx())
    ).rejects.toThrow();
  });

  it("stamps on the MCP path too", async () => {
    rows.set("workspace:story/st1", story());
    await registry.get("workspace.story.update")!.mcpHandler!(
      { id: "st1", patch: { status: "in_progress" } },
      ctx()
    );
    const saved = rows.get("workspace:story/st1") as Story;
    expect(saved.startedAt).toBeTruthy();
    expect(saved.statusHistory?.[0]).toMatchObject({ status: "in_progress", from: "todo" });
  });

  it("create stamps a story that starts out in progress", async () => {
    await registry
      .get("workspace.story.create")!
      .handler({ entity: { title: "Search", status: "in_progress" } }, ctx());
    const created = useWorkspaceStore.getState().stories.find((s) => s.title === "Search");
    expect(created?.startedAt).toBeTruthy();
  });

  it("intent.plan_sprint logs the move from the backlog", async () => {
    useWorkspaceStore.setState({
      sprints: [
        {
          id: "s9",
          name: "Sprint 9",
          startDate: "2026-10-19",
          endDate: "2026-10-30",
          pointsPlanned: 0,
          status: "planned",
        },
      ],
      stories: [story({ id: "b1", status: "backlog", sprintId: undefined, points: 2 })],
    });
    await registry
      .get("intent.plan_sprint")!
      .handler({ sprintId: "s9", capacityPoints: 5, commit: true }, ctx());
    const planned = useWorkspaceStore.getState().stories[0];
    expect(planned).toMatchObject({ status: "todo", sprintId: "s9" });
    expect(planned.statusHistory?.[0]).toMatchObject({ status: "todo", from: "backlog" });
  });
});
