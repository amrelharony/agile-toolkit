/**
 * tool.standup.* action coverage.
 *
 *   1. list_state (read) + resolve_blocker (write w/ mcpHandler, no confirm)
 *   2. list_state reports submitted vs missing roster members, and splits
 *      open vs resolved blockers, for the requested day
 *   3. resolve_blocker flips blockerResolved, is idempotent, and returns
 *      {updated:false} for an unknown id
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll, afterEach, vi } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { StandupEntry, TeamMember } from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";

import "@/lib/actions/tools/standup";

function ctx() {
  return { userId: "test-user", source: "agent" as const, squadProfileIds: [] as string[] };
}

// The board dates entries by the local day, and list_state defaults to it.
const TODAY = todayLocalISO();

function seed(partial: Partial<StandupEntry> & Pick<StandupEntry, "id" | "member">): StandupEntry {
  return {
    date: TODAY,
    yesterday: "y",
    today: "t",
    blockers: "",
    timestamp: Date.now(),
    ...partial,
  };
}

function member(id: string, name: string): TeamMember {
  return { id, name } as TeamMember;
}

describe("tool.standup — registration", () => {
  it("registers list_state (read) and resolve_blocker (write + mcpHandler, no confirm)", () => {
    expect(registry.get("tool.standup.list_state")?.category).toBe("read");
    expect(registry.get("tool.standup.resolve_blocker")?.category).toBe("write");
    expect(registry.get("tool.standup.resolve_blocker")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.standup.resolve_blocker")?.requiresConfirmation).toBe(false);
  });
});

describe("tool.standup.list_state", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ standupEntries: [], teamMembers: [] });
  });

  it("reports submitted vs missing roster members and splits blockers", async () => {
    useWorkspaceStore.setState({
      teamMembers: [member("m1", "Alice"), member("m2", "Bob"), member("m3", "Carol")],
    });
    useWorkspaceStore.getState().upsertStandupEntry(seed({ id: "e1", member: "Alice" }));
    useWorkspaceStore
      .getState()
      .upsertStandupEntry(seed({ id: "e2", member: "Bob", blockers: "blocked on infra" }));
    useWorkspaceStore
      .getState()
      .upsertStandupEntry(
        seed({ id: "e3", member: "Carol", blockers: "was blocked", blockerResolved: true })
      );

    const action = registry.get("tool.standup.list_state");
    const r = (await action!.handler({}, ctx())) as {
      todaysCount: number;
      submittedToday: string[];
      missingMembers: string[];
      openBlockers: StandupEntry[];
      resolvedBlockers: StandupEntry[];
    };
    expect(r.todaysCount).toBe(3);
    expect(r.submittedToday.sort()).toEqual(["Alice", "Bob", "Carol"]);
    expect(r.missingMembers).toEqual([]);
    expect(r.openBlockers.map((e) => e.member)).toEqual(["Bob"]);
    expect(r.resolvedBlockers.map((e) => e.member)).toEqual(["Carol"]);
  });

  it("lists roster members who have not submitted for the day", async () => {
    useWorkspaceStore.setState({
      teamMembers: [member("m1", "Alice"), member("m2", "Bob")],
    });
    useWorkspaceStore.getState().upsertStandupEntry(seed({ id: "e1", member: "Alice" }));

    const action = registry.get("tool.standup.list_state");
    const r = (await action!.handler({}, ctx())) as { missingMembers: string[] };
    expect(r.missingMembers).toEqual(["Bob"]);
  });

  it("scopes to the requested date", async () => {
    useWorkspaceStore.getState().upsertStandupEntry(seed({ id: "e1", member: "Alice" }));
    useWorkspaceStore
      .getState()
      .upsertStandupEntry(seed({ id: "old", member: "Old", date: "2026-01-01" }));

    const action = registry.get("tool.standup.list_state");
    const r = (await action!.handler({ date: "2026-01-01" }, ctx())) as {
      todaysCount: number;
      submittedToday: string[];
    };
    expect(r.todaysCount).toBe(1);
    expect(r.submittedToday).toEqual(["Old"]);
  });
});

describe("tool.standup.resolve_blocker", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ standupEntries: [], teamMembers: [] });
  });

  it("flips blockerResolved and returns {updated: true}", async () => {
    useWorkspaceStore
      .getState()
      .upsertStandupEntry(seed({ id: "e1", member: "Bob", blockers: "infra" }));

    const action = registry.get("tool.standup.resolve_blocker");
    const r = (await action!.handler({ id: "e1" }, ctx())) as { updated: boolean };
    expect(r.updated).toBe(true);
    const stored = (useWorkspaceStore.getState().standupEntries ?? []).find((e) => e.id === "e1");
    expect(stored?.blockerResolved).toBe(true);
  });

  it("is idempotent on an already-resolved entry", async () => {
    useWorkspaceStore
      .getState()
      .upsertStandupEntry(
        seed({ id: "e1", member: "Bob", blockers: "infra", blockerResolved: true })
      );

    const action = registry.get("tool.standup.resolve_blocker");
    const r = (await action!.handler({ id: "e1" }, ctx())) as { updated: boolean };
    expect(r.updated).toBe(true);
  });

  it("returns {updated: false} for an unknown id", async () => {
    const action = registry.get("tool.standup.resolve_blocker");
    const r = (await action!.handler({ id: "nope" }, ctx())) as { updated: boolean };
    expect(r.updated).toBe(false);
  });
});

/** Tokyo, 00:30 on 18 Oct local = 15:30 on 17 Oct UTC. */
function atTokyoJustAfterMidnight() {
  const prevTz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "Asia/Tokyo";
  });
  afterAll(() => {
    if (prevTz === undefined) delete process.env.TZ;
    else process.env.TZ = prevTz;
  });
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-17T15:30:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });
}

// Bug: the in-app list_state defaulted to the UTC day, so just after local
// midnight east of UTC it summarised yesterday's standup.
describe("tool.standup.list_state — local day", () => {
  atTokyoJustAfterMidnight();

  it("defaults to the user's local day, as the board dates entries", async () => {
    useWorkspaceStore.setState({
      teamMembers: [member("m1", "Alice")],
      standupEntries: [seed({ id: "e1", member: "Alice", date: "2026-10-18" })],
    });
    const r = (await registry.get("tool.standup.list_state")!.handler({}, ctx())) as {
      date: string;
      todaysCount: number;
      missingMembers: string[];
    };
    expect(r.date).toBe("2026-10-18");
    expect(r.todaysCount).toBe(1);
    expect(r.missingMembers).toEqual([]);
  });
});
