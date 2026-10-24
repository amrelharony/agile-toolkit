/**
 * The Run-the-sprint agent actions after the Phase 3 data changes:
 *
 *   - tool.impediments.list_state / set_status over the one impediment store;
 *   - tool.async_standup.post writes an async StandupEntry, one per person
 *     per day, and the async reads include older AsyncUpdate rows;
 *   - tool.standup.list_state counts both modes, and resolve_blocker works
 *     on an old async update;
 *   - tool.sprint_review.* take a sprintId (one review per sprint).
 */

import { beforeEach, describe, expect, it } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

import "@/lib/actions/tools/impediments";
import "@/lib/actions/tools/async-standup";
import "@/lib/actions/tools/standup";
import "@/lib/actions/tools/sprint-review";

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
      doneStories: [{ id: "a", title: "Pay by card", points: 5 }],
      notDoneCount: 1,
      committed: 8,
      completed: 5,
      fromStories: true,
      sayDoPct: 63,
    });
    const draft = await call<{ sprintId: null; facts: null }>("tool.sprint_review.list_state");
    expect(draft).toMatchObject({ sprintId: null, facts: null });
  });
});
