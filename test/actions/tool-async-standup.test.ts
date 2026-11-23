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

import { describe, it, expect, beforeEach, vi } from "vitest";

// The MCP path talks to the server store: an in-memory row per kind + id.
const rows = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverListEntities: vi.fn(async (_u: string, kind: string) =>
      Array.from(rows.entries())
        .filter(([k]) => k.startsWith(`${kind}/`))
        .map(([, v]) => v)
    ),
    serverUpsertEntity: vi.fn(async (_u: string, kind: string, entity: { id: string }) => {
      rows.set(`${kind}/${entity.id}`, entity);
    }),
  };
});

import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { AsyncUpdate, StandupEntry, TeamTimePerson } from "@/lib/stores/workspace-types";

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

describe("formats, DRIs and hand-overs (P2.9)", () => {
  const person = (id: string, name: string, timeZone: string, site?: string): TeamTimePerson => ({
    id,
    name,
    timeZone,
    start: "09:00",
    end: "17:00",
    workingDays: [1, 2, 3, 4, 5],
    ...(site ? { site } : {}),
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
  });
  const call = <T>(
    path: "handler" | "mcpHandler",
    verb: string,
    params: Record<string, unknown>
  ) => {
    const action = registry.get(`tool.async_standup.${verb}`)!;
    return action[path]!(action.paramsSchema.parse(params), ctx()) as Promise<T>;
  };
  const stored = (id: string) =>
    (useWorkspaceStore.getState().standupEntries ?? []).find((e) => e.id === id);

  beforeEach(() => {
    rows.clear();
    useWorkspaceStore.setState({
      asyncUpdates: [],
      standupEntries: [],
      teamMembers: [{ id: "m1", name: "Sky" }],
      teamTimePeople: [
        { ...person("p1", "Sky (old name)", "Australia/Sydney"), teamMemberId: "m1" },
        person("p2", "Lou", "Europe/London", "London office"),
        person("example-x", "Ex", "Asia/Tokyo"),
      ],
    });
  });

  it("posts the ppp format, the DRI with a blocker and the hand-over; a classic post stores none", async () => {
    const r = await call<{ id: string }>("handler", "post", {
      member: "Sky",
      date: "2026-11-17",
      yesterday: "Progress",
      today: "Plans",
      blockers: "Keys",
      format: "ppp",
      dri: " Bo ",
      handoff: "Build on staging",
    });
    expect(stored(r.id)).toMatchObject({
      format: "ppp",
      blockerDri: "Bo",
      handoff: "Build on staging",
    });
    const plain = await call<{ id: string }>("handler", "post", {
      member: "Lou",
      date: "2026-11-17",
      yesterday: "y",
      today: "t",
      format: "classic",
      dri: "Bo",
    });
    const e = stored(plain.id) as StandupEntry;
    expect(e).not.toHaveProperty("format");
    expect(e).not.toHaveProperty("blockerDri");
    expect(e).not.toHaveProperty("handoff");
    expect(() =>
      registry.get("tool.async_standup.post")!.paramsSchema.parse({
        member: "A",
        yesterday: "",
        today: "t",
        dri: "x".repeat(121),
      })
    ).toThrow();
  });

  it("digests with Team Time's places, as the page does, and counts the hand-overs", async () => {
    await call("handler", "post", {
      member: "Sky",
      date: "2026-11-17",
      yesterday: "y",
      today: "t",
      handoff: "Build on staging",
    });
    await call("handler", "post", {
      member: "Lou",
      date: "2026-11-17",
      yesterday: "y",
      today: "t",
    });
    const r = await call<{ markdown: string; handoffCount: number }>("handler", "digest", {
      date: "2026-11-17",
    });
    expect(r.handoffCount).toBe(1);
    expect(r.markdown).toContain(
      "## Hand-overs\n- **Sky**, Sydney → London office: Build on staging"
    );
    expect(r.markdown).not.toContain("Tokyo");
  });

  it("reads the places from the server on the MCP path", async () => {
    rows.set("workspace:teamMember/m1", { id: "m1", name: "Sky" });
    rows.set("workspace:teamTimePerson/p1", {
      ...person("p1", "Sky (old)", "Australia/Sydney"),
      teamMemberId: "m1",
    });
    rows.set("workspace:teamTimePerson/p2", person("p2", "Lou", "Europe/London", "London office"));
    rows.set("workspace:teamTimePerson/bad", { id: "bad", timeZone: "Mars/Base" });
    await call("mcpHandler", "post", {
      member: "Lou",
      date: "2026-11-17",
      yesterday: "y",
      today: "t",
      handoff: "Over to Sydney",
    });
    const r = await call<{ markdown: string; handoffCount: number }>("mcpHandler", "digest", {
      date: "2026-11-17",
    });
    expect(r.handoffCount).toBe(1);
    expect(r.markdown).toContain("- **Lou**, London office → Sydney: Over to Sydney");
    // The browser store saw none of it.
    expect(useWorkspaceStore.getState().standupEntries).toEqual([]);
  });
});
