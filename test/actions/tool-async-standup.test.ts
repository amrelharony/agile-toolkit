/**
 * tool.async_standup.* action coverage.
 *
 * Both actions are reads (posting is plain workspace.async_update.create).
 * We cover:
 *   1. both actions registered as category=read
 *   2. list_state counts total + today's updates/blockers + per-day histogram
 *   3. digest groups by member, rolls up blockers, and respects the date arg
 *      (and returns a "No updates posted" stub for an empty day)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { AsyncUpdate } from "@/lib/stores/workspace-types";

import "@/lib/actions/tools/async-standup";

function ctx() {
  return { userId: "test-user", source: "agent" as const, squadProfileIds: [] as string[] };
}

const TODAY = new Date().toISOString().slice(0, 10);

function seed(partial: Partial<AsyncUpdate> & Pick<AsyncUpdate, "id" | "member">): AsyncUpdate {
  return {
    date: TODAY,
    yesterday: "shipped X",
    today: "working on Y",
    ...partial,
  };
}

describe("tool.async_standup — registration", () => {
  it("registers list_state and digest, both read", () => {
    expect(registry.get("tool.async_standup.list_state")?.category).toBe("read");
    expect(registry.get("tool.async_standup.digest")?.category).toBe("read");
  });
});

describe("tool.async_standup.list_state", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ asyncUpdates: [] });
  });

  it("returns zeroes for an empty workspace", async () => {
    const action = registry.get("tool.async_standup.list_state");
    const r = (await action!.handler({}, ctx())) as {
      total: number;
      todaysCount: number;
      todaysBlockers: AsyncUpdate[];
      byDate: { date: string; count: number }[];
    };
    expect(r.total).toBe(0);
    expect(r.todaysCount).toBe(0);
    expect(r.todaysBlockers).toEqual([]);
    expect(r.byDate).toEqual([]);
  });

  it("counts today's updates + blockers and builds a per-day histogram", async () => {
    const seeds: AsyncUpdate[] = [
      seed({ id: "a1", member: "Alice" }),
      seed({ id: "a2", member: "Bob", blockers: "waiting on infra" }),
      seed({ id: "a3", member: "Carol", date: "2026-01-01" }),
    ];
    for (const s of seeds) useWorkspaceStore.getState().upsertAsyncUpdate(s);

    const action = registry.get("tool.async_standup.list_state");
    const r = (await action!.handler({}, ctx())) as {
      total: number;
      today: string;
      todaysCount: number;
      todaysBlockers: AsyncUpdate[];
      byDate: { date: string; count: number }[];
    };
    expect(r.total).toBe(3);
    expect(r.todaysCount).toBe(2);
    expect(r.todaysBlockers.map((u) => u.member)).toEqual(["Bob"]);
    // newest day first
    expect(r.byDate[0].date).toBe(TODAY);
    expect(r.byDate[0].count).toBe(2);
    expect(r.byDate.find((d) => d.date === "2026-01-01")?.count).toBe(1);
  });
});

describe("tool.async_standup.digest", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ asyncUpdates: [] });
  });

  it("returns a 'No updates posted' stub for an empty day", async () => {
    const action = registry.get("tool.async_standup.digest");
    const r = (await action!.handler({ date: "2026-01-01" }, ctx())) as {
      date: string;
      markdown: string;
      updateCount: number;
      blockerCount: number;
    };
    expect(r.date).toBe("2026-01-01");
    expect(r.updateCount).toBe(0);
    expect(r.markdown).toContain("No updates posted");
  });

  it("groups by member, rolls up blockers, and counts them", async () => {
    useWorkspaceStore
      .getState()
      .upsertAsyncUpdate(seed({ id: "a1", member: "Alice", today: "ship the thing" }));
    useWorkspaceStore
      .getState()
      .upsertAsyncUpdate(seed({ id: "a2", member: "Bob", blockers: "blocked on review" }));

    const action = registry.get("tool.async_standup.digest");
    const r = (await action!.handler({}, ctx())) as {
      markdown: string;
      updateCount: number;
      blockerCount: number;
    };
    expect(r.updateCount).toBe(2);
    expect(r.blockerCount).toBe(1);
    expect(r.markdown).toContain("## Blockers");
    expect(r.markdown).toContain("Bob");
    expect(r.markdown).toContain("blocked on review");
    expect(r.markdown).toContain("## Alice");
  });

  it("only includes the requested day", async () => {
    useWorkspaceStore.getState().upsertAsyncUpdate(seed({ id: "a1", member: "Alice" }));
    useWorkspaceStore
      .getState()
      .upsertAsyncUpdate(seed({ id: "old", member: "Old", date: "2026-01-01" }));

    const action = registry.get("tool.async_standup.digest");
    const r = (await action!.handler({ date: "2026-01-01" }, ctx())) as {
      markdown: string;
      updateCount: number;
    };
    expect(r.updateCount).toBe(1);
    expect(r.markdown).toContain("## Old");
    expect(r.markdown).not.toContain("## Alice");
  });
});
