/**
 * tool.parking_lot.* coverage, in the browser and over MCP.
 *
 *   1. registration — reads and writes, each with an MCP handler.
 *   2. list_state — the page's order, filters, link states, counts without
 *      the example.
 *   3. park — the remembered meeting; set_status — refuses a live send.
 *   4. send — each route makes its target with a link back, the point turns
 *      sent, a second send is refused, the example is never sent; over MCP
 *      the targets are the user's rows (a retro is started if none is open).
 *   5. suggest_routes — the keyword rules.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParkingLotItem, RetroBoard, Story } from "@/lib/stores/workspace-types";

const server = vi.hoisted(() => ({ rows: new Map<string, { id: string }>() }));

vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  const key = (kind: string, id: string) => `${kind}/${id}`;
  return {
    ...actual,
    serverListEntities: vi.fn(async (_u: string, kind: string) =>
      Array.from(server.rows.entries())
        .filter(([k]) => k.startsWith(`${kind}/`))
        .map(([, v]) => v)
    ),
    serverUpsertEntity: vi.fn(async (_u: string, kind: string, e: { id: string }) => {
      server.rows.set(key(kind, e.id), e);
    }),
  };
});

import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { retroFormats } from "@/lib/constants/retro-formats";
import "@/lib/actions/tools/parking-lot";

const ctx = (source: "agent" | "mcp" = "agent") => ({
  userId: "u",
  source,
  squadProfileIds: [] as string[],
});
const run = async <T>(id: string, params: Record<string, unknown> = {}, onServer = false) => {
  const a = registry.get(id)!;
  const handler = onServer ? (a.mcpHandler ?? a.handler) : a.handler;
  return (await handler(a.paramsSchema.parse(params), ctx(onServer ? "mcp" : "agent"))) as T;
};

const item = (over: Partial<ParkingLotItem> = {}): ParkingLotItem => ({
  id: "p1",
  text: "Who owns the release checklist?",
  meeting: "Daily Scrum",
  status: "open",
  createdAt: "2026-11-12T09:00:00.000Z",
  updatedAt: "2026-11-12T09:00:00.000Z",
  ...over,
});

const ws = () => useWorkspaceStore.getState();
const point = (id: string) => (ws().parkingLotItems ?? []).find((i) => i.id === id);

beforeEach(() => {
  server.rows.clear();
  useWorkspaceStore.setState({
    parkingLotItems: [],
    stories: [],
    impediments: [],
    retroBoards: [],
  });
});

describe("registration", () => {
  it("has the reads and the writes, each with an MCP handler", () => {
    for (const name of ["list_state", "suggest_routes"]) {
      expect(registry.get(`tool.parking_lot.${name}`)?.category, name).toBe("read");
    }
    for (const name of ["park", "set_status", "send"]) {
      const a = registry.get(`tool.parking_lot.${name}`);
      expect(a?.category, name).toBe("write");
      expect(a?.requiresConfirmation, name).toBe(false);
      expect(a?.visitor, name).toBeUndefined();
    }
    for (const name of ["list_state", "suggest_routes", "park", "set_status", "send"]) {
      expect(registry.get(`tool.parking_lot.${name}`)?.mcpHandler, name).toBeTypeOf("function");
    }
  });
});

describe("list_state", () => {
  it("lists the page's order with filters, link states and counts without the example", async () => {
    ws().upsertStory({ id: "s1", title: "x", status: "done" });
    useWorkspaceStore.setState({
      parkingLotItems: [
        item({
          id: "b",
          createdAt: "2026-11-12T09:05:00Z",
          meeting: "Planning",
          status: "sent",
          sentTo: [
            { route: "backlog-story", targetId: "s1", at: "2026-11-12T09:06:00Z" },
            { route: "impediment", targetId: "gone", at: "2026-11-12T09:06:00Z" },
          ],
        }),
        item({ id: "a" }),
        item({ id: "example-1", createdAt: "2026-11-12T08:00:00Z" }),
      ],
    });
    const all = await run<{
      counts: Record<string, number>;
      meetings: { name: string | null; open: number }[];
      rememberedMeeting: string | null;
      examples: number;
      items: { id: string; sentTo: { route: string; target: string }[] }[];
    }>("tool.parking_lot.list_state");
    expect(all.items.map((i) => i.id)).toEqual(["example-1", "a", "b"]);
    expect(all.counts).toEqual({ total: 2, open: 1, discussed: 0, sent: 1, dropped: 0 });
    expect(all.examples).toBe(1);
    expect(all.rememberedMeeting).toBe("Planning");
    expect(all.items[2].sentTo).toEqual([
      expect.objectContaining({ route: "backlog-story", target: "done" }),
      expect.objectContaining({ route: "impediment", target: "gone" }),
    ]);
    const daily = await run<{ items: { id: string }[] }>("tool.parking_lot.list_state", {
      meeting: "daily scrum",
      status: "open",
    });
    expect(daily.items.map((i) => i.id)).toEqual(["example-1", "a"]);
  });
});

describe("park and set_status", () => {
  it("parks in the remembered meeting unless told otherwise", async () => {
    useWorkspaceStore.setState({ parkingLotItems: [item()] });
    const r = await run<{ parked: boolean; id: string; meeting: string }>("tool.parking_lot.park", {
      text: "  Add CSV\nexport ",
    });
    expect(r).toMatchObject({ parked: true, meeting: "Daily Scrum" });
    expect(point(r.id)).toMatchObject({
      text: "Add CSV export",
      meeting: "Daily Scrum",
      status: "open",
    });
    expect(r.id).toMatch(/^parking_/);
    const other = await run<{ id: string }>("tool.parking_lot.park", {
      text: "Lunch",
      meeting: "",
      raisedBy: "Sam",
    });
    expect(point(other.id)).not.toHaveProperty("meeting");
    expect(point(other.id)?.raisedBy).toBe("Sam");
    await expect(run("tool.parking_lot.park", { text: "  " })).rejects.toThrow();
  });

  it("marks a point discussed or dropped, and refuses one whose send still lives", async () => {
    ws().upsertStory({ id: "s1", title: "x", status: "backlog" });
    useWorkspaceStore.setState({
      parkingLotItems: [
        item(),
        item({
          id: "sent",
          status: "sent",
          sentTo: [{ route: "backlog-story", targetId: "s1", at: "x" }],
        }),
      ],
    });
    expect(await run("tool.parking_lot.set_status", { id: "p1", status: "discussed" })).toEqual({
      updated: true,
      id: "p1",
      status: "discussed",
    });
    expect(point("p1")?.status).toBe("discussed");
    expect(point("p1")?.updatedAt).not.toBe("2026-11-12T09:00:00.000Z");
    expect(await run("tool.parking_lot.set_status", { id: "p1", status: "discussed" })).toEqual({
      updated: false,
      reason: "unchanged",
    });
    expect(
      await run("tool.parking_lot.set_status", { id: "sent", status: "dropped" })
    ).toMatchObject({
      updated: false,
      reason: "sent",
    });
    expect(await run("tool.parking_lot.set_status", { id: "nope", status: "open" })).toEqual({
      updated: false,
      reason: "not_found",
    });
  });
});

describe("send", () => {
  it("makes a backlog story, an impediment and a retro action, each linked both ways", async () => {
    useWorkspaceStore.setState({ parkingLotItems: [item({ raisedBy: "Priya" })] });
    const story = await run<{ sent: boolean; targetId: string; href: string }>(
      "tool.parking_lot.send",
      { id: "p1", route: "backlog-story" }
    );
    expect(story).toMatchObject({ sent: true, route: "backlog-story", href: "/sprint-planning" });
    expect(ws().stories.find((s) => s.id === story.targetId)).toMatchObject({
      title: "Who owns the release checklist?",
      status: "backlog",
      notes: "Parked in Daily Scrum, raised by Priya.",
      sourceRef: { tool: "parking-lot", id: "p1" },
    });
    expect(point("p1")).toMatchObject({ status: "sent" });

    const imp = await run<{ targetId: string }>("tool.parking_lot.send", {
      id: "p1",
      route: "impediment",
    });
    expect((ws().impediments ?? []).find((i) => i.id === imp.targetId)).toMatchObject({
      title: "Who owns the release checklist?",
      severity: "medium",
      raisedBy: "Priya",
      sourceRef: { tool: "parking-lot", id: "p1" },
    });

    const action = await run<{ targetId: string }>("tool.parking_lot.send", {
      id: "p1",
      route: "retro-action",
    });
    const board = (ws().retroBoards ?? []).find((b) => b.id === "retro:current");
    expect(board?.cards.find((c) => c.id === action.targetId)).toMatchObject({
      text: "Who owns the release checklist?",
      isActionItem: true,
      sourceRef: { tool: "parking-lot", id: "p1" },
    });
    expect(point("p1")?.sentTo?.map((l) => l.route)).toEqual([
      "backlog-story",
      "impediment",
      "retro-action",
    ]);
  });

  it("refuses a second send while the first lives, sends again once it is gone, never the example", async () => {
    useWorkspaceStore.setState({ parkingLotItems: [item(), item({ id: "example-1" })] });
    const first = await run<{ targetId: string }>("tool.parking_lot.send", {
      id: "p1",
      route: "backlog-story",
    });
    expect(await run("tool.parking_lot.send", { id: "p1", route: "backlog-story" })).toEqual({
      sent: false,
      reason: "already_sent",
      targetId: first.targetId,
    });
    ws().removeStory(first.targetId);
    const again = await run<{ sent: boolean; targetId: string }>("tool.parking_lot.send", {
      id: "p1",
      route: "backlog-story",
    });
    expect(again.sent).toBe(true);
    expect(point("p1")?.sentTo).toEqual([
      expect.objectContaining({ route: "backlog-story", targetId: again.targetId }),
    ]);
    expect(await run("tool.parking_lot.send", { id: "example-1", route: "impediment" })).toEqual({
      sent: false,
      reason: "example",
    });
    expect(await run("tool.parking_lot.send", { id: "nope", route: "impediment" })).toEqual({
      sent: false,
      reason: "not_found",
    });
  });

  it("over MCP writes the user's rows, starting a retro after the newest archive", async () => {
    server.rows.set("workspace:parkingLotItem/p1", item());
    const archived: RetroBoard = {
      id: "retro:2026-10-30T10:00:00.000Z",
      format: retroFormats[0],
      phase: "actions",
      cards: [],
      userVotes: 0,
      timerSeconds: 0,
      timerRunning: false,
      discussingIndex: 0,
      archivedAt: "2026-10-30T10:00:00.000Z",
    };
    server.rows.set(`workspace:retroBoard/${archived.id}`, archived);
    const r = await run<{ sent: boolean; targetId: string }>(
      "tool.parking_lot.send",
      { id: "p1", route: "retro-action" },
      true
    );
    expect(r.sent).toBe(true);
    const board = server.rows.get("workspace:retroBoard/retro:current") as RetroBoard;
    expect(board.previousRetroId).toBe(archived.id);
    expect(board.cards).toEqual([
      expect.objectContaining({
        id: r.targetId,
        isActionItem: true,
        sourceRef: { tool: "parking-lot", id: "p1" },
      }),
    ]);
    expect(server.rows.get("workspace:parkingLotItem/p1")).toMatchObject({
      status: "sent",
      sentTo: [expect.objectContaining({ route: "retro-action", targetId: r.targetId })],
    });
    // The browser's store is untouched over MCP.
    expect(ws().retroBoards).toEqual([]);

    const s = await run<{ targetId: string }>(
      "tool.parking_lot.send",
      { id: "p1", route: "backlog-story" },
      true
    );
    expect((server.rows.get(`workspace:story/${s.targetId}`) as Story).sourceRef).toEqual({
      tool: "parking-lot",
      id: "p1",
    });
    const listed = await run<{ items: { sentTo: { route: string; target: string }[] }[] }>(
      "tool.parking_lot.list_state",
      {},
      true
    );
    expect(listed.items[0].sentTo.map((l) => [l.route, l.target])).toEqual([
      ["retro-action", "live"],
      ["backlog-story", "live"],
    ]);
  });
});

describe("suggest_routes", () => {
  it("suggests by the keyword rules for the team's open points", async () => {
    useWorkspaceStore.setState({
      parkingLotItems: [
        item({ id: "a", text: "Blocked on the platform team's approval" }),
        item({ id: "b", text: "Add dark mode", status: "dropped" }),
        item({ id: "example-1", text: "Add search" }),
      ],
    });
    const r = await run<{ suggestions: { id: string; destination: string }[] }>(
      "tool.parking_lot.suggest_routes"
    );
    expect(r.suggestions.map((s) => [s.id, s.destination])).toEqual([["a", "impediment"]]);
  });
});
