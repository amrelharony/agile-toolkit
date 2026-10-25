/**
 * The Run-the-sprint agent actions after the Phase 3 data changes:
 *
 *   - tool.impediments.list_state / set_status over the one impediment store;
 *   - tool.async_standup.post writes an async StandupEntry, one per person
 *     per day, and the async reads include older AsyncUpdate rows;
 *   - tool.standup.list_state counts both modes, resolve_blocker works on an
 *     old async update and reopens, post writes a live entry under the same
 *     one-per-day rule, and remove_entry takes the old update with it;
 *   - tool.kanban.* stamp and count cards as the Flow board does;
 *   - tool.sprint_review.* take a sprintId (one review per sprint), read the
 *     old starter draft as none, and add done stories to the demo and
 *     feedback to the backlog as the page does.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { LEGACY_STARTER } from "@/lib/sprints/review-doc";

import "@/lib/actions/tools/impediments";
import "@/lib/actions/tools/async-standup";
import "@/lib/actions/tools/standup";
import "@/lib/actions/tools/sprint-review";
import "@/lib/actions/tools/kanban";

const ctx = { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
const call = <T>(id: string, params: Record<string, unknown> = {}) =>
  registry.get(id)!.handler(params, ctx) as Promise<T>;
const ws = () => useWorkspaceStore.getState();

beforeEach(() => {
  useWorkspaceStore.setState({
    impediments: [],
    standupEntries: [],
    asyncUpdates: [],
    teamMembers: [],
    sprintReviews: [],
    sprints: [],
    stories: [],
    sprintGoals: [],
    kanbanBoards: [],
  });
});

describe("tool.impediments", () => {
  beforeEach(() =>
    useWorkspaceStore.setState({
      impediments: [
        { id: "a", title: "A", severity: "low", raisedAt: "2026-10-01", dueDate: "2026-10-05" },
        { id: "b", title: "B", severity: "critical", raisedAt: "2026-10-10" },
      ],
    })
  );

  it("list_state summarises and orders as the page does", async () => {
    const r = await call<{
      open: number;
      overdue: number;
      critical: number;
      impediments: { id: string; status: string; ageDays: number; daysOverdue: number }[];
    }>("tool.impediments.list_state", { today: "2026-10-24" });
    expect(r).toMatchObject({ open: 2, overdue: 1, critical: 1 });
    expect(r.impediments.map((i) => [i.id, i.status, i.ageDays, i.daysOverdue])).toEqual([
      ["a", "open", 23, 19],
      ["b", "open", 14, 0],
    ]);
  });

  it("set_status escalates, resolves and reopens; unknown ids change nothing", async () => {
    expect(registry.get("tool.impediments.set_status")?.category).toBe("write");
    await call("tool.impediments.set_status", { id: "b", status: "escalated", date: "2026-10-11" });
    expect(ws().impediments[1]).toMatchObject({ escalatedAt: "2026-10-11" });
    const resolved = await call("tool.impediments.set_status", {
      id: "b",
      status: "resolved",
      date: "2026-10-12",
    });
    expect(resolved).toEqual({ updated: true, status: "resolved" });
    expect(ws().impediments[1]).toMatchObject({
      escalatedAt: "2026-10-11",
      resolvedAt: "2026-10-12",
    });
    await call("tool.impediments.set_status", { id: "b", status: "open" });
    expect(ws().impediments[1].resolvedAt).toBeUndefined();
    expect(await call("tool.impediments.set_status", { id: "nope", status: "open" })).toEqual({
      updated: false,
    });
  });
});

describe("async posts are standup entries", () => {
  it("post writes an async entry and replaces that person's post for the day", async () => {
    const first = await call<{ id: string; replaced: boolean }>("tool.async_standup.post", {
      member: "Alice",
      date: "2026-10-23",
      yesterday: "Spike",
      today: "Build",
      blockers: "Keys",
    });
    expect(first.replaced).toBe(false);
    expect(ws().standupEntries).toEqual([
      expect.objectContaining({ id: first.id, member: "Alice", mode: "async", blockers: "Keys" }),
    ]);
    const again = await call<{ id: string; replaced: boolean }>("tool.async_standup.post", {
      member: "alice",
      date: "2026-10-23",
      yesterday: "Spike",
      today: "Ship",
    });
    expect(again).toMatchObject({ id: first.id, replaced: true });
    expect(ws().standupEntries).toHaveLength(1);
    expect(ws().standupEntries?.[0]).toMatchObject({ today: "Ship", blockers: "" });
  });

  it("posting over an old async update keeps its id, so the day has one post", async () => {
    useWorkspaceStore.setState({
      asyncUpdates: [{ id: "old", member: "Bo", date: "2026-10-23", yesterday: "a", today: "b" }],
    });
    const r = await call<{ id: string }>("tool.async_standup.post", {
      member: "Bo",
      date: "2026-10-23",
      yesterday: "a",
      today: "c",
    });
    expect(r.id).toBe("old");
    const digest = await call<{ updateCount: number; markdown: string }>(
      "tool.async_standup.digest",
      {
        date: "2026-10-23",
      }
    );
    expect(digest.updateCount).toBe(1);
    expect(digest.markdown).toContain("- **Today**: c");
  });

  it("standup list_state counts live and async; resolve_blocker works on an old async update", async () => {
    useWorkspaceStore.setState({
      teamMembers: [
        { id: "m1", name: "Alice" },
        { id: "m2", name: "Bo" },
        { id: "m3", name: "Kim" },
      ],
      standupEntries: [
        {
          id: "e1",
          member: "Alice",
          date: "2026-10-23",
          yesterday: "",
          today: "",
          blockers: "",
          timestamp: 1,
        },
      ],
      asyncUpdates: [
        { id: "u1", member: "Bo", date: "2026-10-23", yesterday: "", today: "", blockers: "VPN" },
      ],
    });
    const state = await call<{ byMode: object; missingMembers: string[]; openBlockers: unknown[] }>(
      "tool.standup.list_state",
      { date: "2026-10-23" }
    );
    expect(state.byMode).toEqual({ live: 1, async: 1 });
    expect(state.missingMembers).toEqual(["Kim"]);
    expect(state.openBlockers).toHaveLength(1);

    expect(await call("tool.standup.resolve_blocker", { id: "u1" })).toEqual({ updated: true });
    expect(ws().standupEntries?.find((e) => e.id === "u1")).toMatchObject({
      mode: "async",
      blockers: "VPN",
      blockerResolved: true,
    });
  });
});

describe("live posts and the shared standup rules", () => {
  it("post writes a live entry, replacing that person's entry for the day in either mode", async () => {
    const first = await call<{ id: string }>("tool.async_standup.post", {
      member: "Alice",
      date: "2026-10-23",
      yesterday: "Spike",
      today: "Build",
      blockers: "Keys",
    });
    await call("tool.standup.resolve_blocker", { id: first.id });
    const live = await call<{ id: string; replaced: boolean }>("tool.standup.post", {
      member: "alice",
      date: "2026-10-23",
      yesterday: "Spike",
      today: "Ship",
      blockers: "Keys",
    });
    expect(live).toMatchObject({ id: first.id, replaced: true });
    expect(ws().standupEntries).toEqual([
      expect.objectContaining({ id: first.id, mode: "live", today: "Ship", blockerResolved: true }),
    ]);
  });

  it("resolve_blocker reopens with resolved: false", async () => {
    const { id } = await call<{ id: string }>("tool.standup.post", {
      member: "Bo",
      date: "2026-10-23",
      yesterday: "",
      today: "Tests",
      blockers: "VPN",
    });
    await call("tool.standup.resolve_blocker", { id });
    expect(ws().standupEntries?.[0].blockerResolved).toBe(true);
    await call("tool.standup.resolve_blocker", { id, resolved: false });
    expect("blockerResolved" in (ws().standupEntries?.[0] ?? {})).toBe(false);
  });

  it("remove_entry takes the old async update under the same id with it", async () => {
    useWorkspaceStore.setState({
      asyncUpdates: [{ id: "old", member: "Bo", date: "2026-10-23", yesterday: "a", today: "b" }],
    });
    await call("tool.async_standup.post", {
      member: "Bo",
      date: "2026-10-23",
      yesterday: "a",
      today: "c",
    });
    expect(await call("tool.standup.remove_entry", { id: "old" })).toEqual({ removed: true });
    expect(ws().standupEntries).toEqual([]);
    expect(ws().asyncUpdates).toEqual([]);
    expect(await call("tool.standup.remove_entry", { id: "old" })).toEqual({ removed: false });
  });

  it("the digest covers the day's entries of both modes, as the page's does", async () => {
    await call("tool.standup.post", {
      member: "Alice",
      date: "2026-10-23",
      yesterday: "",
      today: "Live",
    });
    await call("tool.async_standup.post", {
      member: "Bo",
      date: "2026-10-23",
      yesterday: "",
      today: "Async",
    });
    const all = await call<{ updateCount: number }>("tool.async_standup.digest", {
      date: "2026-10-23",
    });
    expect(all.updateCount).toBe(2);
    const asyncOnly = await call<{ updateCount: number; markdown: string }>(
      "tool.async_standup.digest",
      { date: "2026-10-23", mode: "async" }
    );
    expect(asyncOnly.updateCount).toBe(1);
    expect(asyncOnly.markdown).toContain("## Bo");
  });
});

describe("tool.kanban stamps like the Flow board", () => {
  const board = () => ws().kanbanBoards?.find((b) => b.id === "kanban:current");
  const card = (id: string) => board()?.cards.find((c) => c.id === id);

  it("add_card takes an assignee and a blocked flag and dates the column", async () => {
    const { id } = await call<{ id: string }>("tool.kanban.add_card", {
      title: "Fix login",
      column: "review",
      assignee: " Sam ",
      blocked: true,
    });
    expect(card(id)).toMatchObject({ assignee: "Sam", blocked: true, column: "review" });
    expect(card(id)?.columnSince).toBe(card(id)?.createdAt);
    expect(card(id)?.startedAt).toBe(card(id)?.createdAt);
    const done = await call<{ id: string }>("tool.kanban.add_card", {
      title: "Shipped",
      column: "done",
      blocked: true,
    });
    expect("blocked" in (card(done.id) ?? {})).toBe(false);
  });

  it("move_card restarts columnSince, clears blocked in Done and drops completedAt on leaving it", async () => {
    const { id } = await call<{ id: string }>("tool.kanban.add_card", {
      title: "Card",
      blocked: true,
    });
    await call("tool.kanban.move_card", { cardId: id, column: "in_progress" });
    const started = card(id)!;
    expect(started.startedAt).toBe(started.columnSince);
    await call("tool.kanban.move_card", { cardId: id, column: "done" });
    expect(card(id)).toMatchObject({ column: "done", completedAt: expect.any(String) });
    expect("blocked" in card(id)!).toBe(false);
    await call("tool.kanban.move_card", { cardId: id, column: "review" });
    expect("completedAt" in card(id)!).toBe(false);
    await call("tool.kanban.move_card", { cardId: id, column: "ready" });
    expect("startedAt" in card(id)!).toBe(false);
  });

  it("list_state counts blocked cards and only cards in Done for cycle time", async () => {
    useWorkspaceStore.setState({
      kanbanBoards: [
        {
          id: "kanban:current",
          wipLimits: { backlog: 0, ready: 5, in_progress: 3, review: 2, done: 0 },
          cards: [
            {
              id: "a",
              title: "A",
              column: "in_progress",
              class: "standard",
              createdAt: "2026-10-01",
              blocked: true,
            },
            {
              id: "b",
              title: "B",
              column: "done",
              class: "standard",
              createdAt: "2026-10-01",
              startedAt: "2026-10-01",
              completedAt: "2026-10-05",
            },
            // Moved out of Done by an older agent write: its stamp no longer counts.
            {
              id: "c",
              title: "C",
              column: "review",
              class: "standard",
              createdAt: "2026-10-01",
              startedAt: "2026-10-01",
              completedAt: "2026-10-03",
            },
          ],
        },
      ],
    });
    const r = await call<Record<string, unknown>>("tool.kanban.list_state");
    expect(r).toMatchObject({
      blockedByColumn: { in_progress: 1, review: 0 },
      // 1 to 5 October, both days counted.
      avgCycleTimeDays: 5,
      p85CycleTimeDays: 5,
      cycleTimeSample: 1,
    });
  });
});

describe("tool.sprint_review per sprint", () => {
  beforeEach(() =>
    useWorkspaceStore.setState({
      sprints: [
        {
          id: "s1",
          name: "Sprint 12",
          startDate: "2026-10-12",
          endDate: "2026-10-23",
          pointsPlanned: 0,
          status: "active",
        },
      ],
      stories: [
        { id: "a", title: "Pay by card", status: "done", points: 5, sprintId: "s1" },
        { id: "b", title: "Refunds", status: "todo", points: 3, sprintId: "s1" },
      ],
    })
  );

  it("add_feedback lands on the sprint's own review, created with its name", async () => {
    await call("tool.sprint_review.add_feedback", {
      sprintId: "s1",
      stakeholder: "Dana",
      feedback: "Love it",
      category: "positive",
    });
    expect(ws().sprintReviews).toEqual([
      expect.objectContaining({
        id: "sprint-review:sprint:s1",
        sprintId: "s1",
        sprintName: "Sprint 12",
        feedbackItems: [expect.objectContaining({ stakeholder: "Dana", category: "positive" })],
      }),
    ]);
    expect(
      await call("tool.sprint_review.add_feedback", {
        sprintId: "nope",
        stakeholder: "x",
        feedback: "y",
        category: "concern",
      })
    ).toEqual({ added: false, reason: "unknown_sprint" });
  });

  it("list_state adds the facts from the sprint's stories", async () => {
    const r = await call<{ sprintId: string; exists: boolean; facts: Record<string, unknown> }>(
      "tool.sprint_review.list_state",
      { sprintId: "s1" }
    );
    expect(r.sprintId).toBe("s1");
    expect(r.exists).toBe(false);
    expect(r.facts).toMatchObject({
      doneStories: [{ id: "a", title: "Pay by card", points: 5, inDemo: false }],
      notDoneCount: 1,
      committed: 8,
      completed: 5,
      fromStories: true,
      sayDoPct: 63,
    });
    expect(r).toMatchObject({
      numbers: { source: "stories", committed: 8, completed: 5, sayDoPct: 63 },
    });
    const draft = await call<{ sprintId: null; facts: null }>("tool.sprint_review.list_state");
    expect(draft).toMatchObject({ sprintId: null, facts: null });
  });

  it("reads the old page's untouched starter draft as no draft, and writes over it", async () => {
    useWorkspaceStore.setState({
      sprintReviews: [
        { id: "sprint-review:current", meetingDate: "2026-01-05", ...LEGACY_STARTER },
      ],
    });
    const r = await call<{ exists: boolean; features: number; numbers: { source: string } }>(
      "tool.sprint_review.list_state"
    );
    expect(r).toMatchObject({ exists: false, features: 0, numbers: { source: "none" } });
    await call("tool.sprint_review.add_feedback", {
      stakeholder: "Dana",
      feedback: "Refunds?",
      category: "suggestion",
    });
    const [draft] = ws().sprintReviews ?? [];
    expect(draft.features).toEqual([]);
    expect(draft.sprintName).toBe("");
    expect(draft.feedbackItems).toHaveLength(1);
  });

  it("add_done_stories_to_demo adds each done story once", async () => {
    expect(await call("tool.sprint_review.add_done_stories_to_demo", { sprintId: "s1" })).toEqual({
      added: 1,
      alreadyInDemo: 0,
      notDone: 0,
    });
    expect(ws().sprintReviews?.[0].features).toEqual([
      expect.objectContaining({ id: "story-a", name: "Pay by card" }),
    ]);
    expect(
      await call("tool.sprint_review.add_done_stories_to_demo", {
        sprintId: "s1",
        storyIds: ["a", "b"],
      })
    ).toEqual({ added: 0, alreadyInDemo: 1, notDone: 1 });
    const r = await call<{ facts: { doneStories: { inDemo: boolean }[] } }>(
      "tool.sprint_review.list_state",
      { sprintId: "s1" }
    );
    expect(r.facts.doneStories[0].inDemo).toBe(true);
    expect(await call("tool.sprint_review.add_done_stories_to_demo", { sprintId: "nope" })).toEqual(
      { added: 0, reason: "unknown_sprint" }
    );
  });

  it("send_feedback_to_backlog makes one linked story, and again only once it's gone", async () => {
    const { id } = await call<{ id: string }>("tool.sprint_review.add_feedback", {
      sprintId: "s1",
      stakeholder: "Dana",
      feedback: "Let customers refund a payment themselves",
      category: "suggestion",
    });
    const before = await call<{ feedback: { notOnBacklog: number } }>(
      "tool.sprint_review.list_state",
      { sprintId: "s1" }
    );
    expect(before.feedback.notOnBacklog).toBe(1);

    const sent = await call<{ sent: boolean; storyId: string }>(
      "tool.sprint_review.send_feedback_to_backlog",
      { sprintId: "s1", feedbackId: id }
    );
    expect(sent.sent).toBe(true);
    expect(ws().stories?.find((s) => s.id === sent.storyId)).toMatchObject({
      title: "Let customers refund a payment themselves",
      status: "backlog",
      sourceRef: { tool: "sprint-review", id, doc: "sprint-review:sprint:s1" },
    });
    expect(ws().sprintReviews?.[0].feedbackItems[0].sentTo).toEqual([
      { route: "backlog-story", targetId: sent.storyId, at: expect.any(String) },
    ]);
    expect(
      await call("tool.sprint_review.send_feedback_to_backlog", { sprintId: "s1", feedbackId: id })
    ).toEqual({ sent: false, reason: "already_sent", storyId: sent.storyId });

    ws().removeStory(sent.storyId);
    const again = await call<{ sent: boolean; storyId: string }>(
      "tool.sprint_review.send_feedback_to_backlog",
      { sprintId: "s1", feedbackId: id }
    );
    expect(again.sent).toBe(true);
    expect(ws().sprintReviews?.[0].feedbackItems[0].sentTo).toHaveLength(1);
    expect(
      await call("tool.sprint_review.send_feedback_to_backlog", { sprintId: "s1", feedbackId: "x" })
    ).toEqual({ sent: false, reason: "unknown_feedback" });
  });
});
