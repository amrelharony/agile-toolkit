/**
 * tool.retro.* action coverage.
 *
 *   1. list_state (read) + add_card (write w/ mcpHandler, no confirm)
 *   2. list_state summarises per-column counts, vote total, action items,
 *      and top-voted cards; reports exists:false with no board
 *   3. add_card appends to the active board, and no-ops {added:false} when
 *      no retro is active
 *   4. list_state's previousActions: the action items of the retro the
 *      board follows (else the newest archive), with carry-over and sentTo,
 *      on the browser and MCP paths
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverGetEntity: vi.fn(async () => null),
    serverListEntities: vi.fn(async () => []),
    serverUpsertEntity: vi.fn(async () => {}),
  };
});

import * as serverStore from "@/lib/actions/server-store";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { RetroBoard, RetroCard } from "@/lib/stores/workspace-types";
import { retroFormats } from "@/lib/constants/retro-formats";

import "@/lib/actions/tools/retro";

const RB_ID = "retro:current";

function ctx() {
  return { userId: "test-user", source: "agent" as const, squadProfileIds: [] as string[] };
}

function card(partial: Partial<RetroCard> & Pick<RetroCard, "id" | "columnKey">): RetroCard {
  return {
    text: "card",
    votes: 0,
    groupedWith: null,
    isActionItem: false,
    assignee: "",
    discussing: false,
    ...partial,
  };
}

function board(cards: RetroCard[]): RetroBoard {
  return {
    id: RB_ID,
    // format is a rich object in prod; a name is all the summary reads.
    format: { name: "Mad Sad Glad" } as RetroBoard["format"],
    phase: "write",
    cards,
    userVotes: 0,
    timerSeconds: 300,
    timerRunning: false,
    discussingIndex: 0,
  };
}

describe("tool.retro — registration", () => {
  it("registers list_state (read) and add_card (write + mcpHandler, no confirm)", () => {
    expect(registry.get("tool.retro.list_state")?.category).toBe("read");
    expect(registry.get("tool.retro.add_card")?.category).toBe("write");
    expect(registry.get("tool.retro.add_card")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.retro.add_card")?.requiresConfirmation).toBe(false);
  });
});

describe("tool.retro.list_state", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ retroBoards: [] });
  });

  it("reports exists:false when no retro is active", async () => {
    const action = registry.get("tool.retro.list_state");
    const r = (await action!.handler({}, ctx())) as { exists: boolean; totalCards: number };
    expect(r.exists).toBe(false);
    expect(r.totalCards).toBe(0);
  });

  it("summarises columns, votes, action items, and top-voted cards", async () => {
    useWorkspaceStore
      .getState()
      .upsertRetroBoard(
        board([
          card({ id: "c1", columnKey: "good", text: "shipped", votes: 2 }),
          card({ id: "c2", columnKey: "good", text: "fast", votes: 5 }),
          card({ id: "c3", columnKey: "bad", text: "flaky tests", votes: 1, isActionItem: true }),
        ])
      );

    const action = registry.get("tool.retro.list_state");
    const r = (await action!.handler({}, ctx())) as {
      exists: boolean;
      formatName: string;
      totalCards: number;
      totalVotes: number;
      actionItems: number;
      byColumn: { columnKey: string; count: number }[];
      topVoted: { id: string; votes: number }[];
    };
    expect(r.exists).toBe(true);
    expect(r.formatName).toBe("Mad Sad Glad");
    expect(r.totalCards).toBe(3);
    expect(r.totalVotes).toBe(8);
    expect(r.actionItems).toBe(1);
    expect(r.byColumn.find((c) => c.columnKey === "good")?.count).toBe(2);
    // highest-voted card first
    expect(r.topVoted[0].id).toBe("c2");
  });

  it("says nothing of a live room's thumbs vote, which stays in the host's tab", async () => {
    // A Lean Coffee topic under discussion: whatever the room voted on it,
    // with any number of voters, no keep or move count reaches Amr.
    useWorkspaceStore.getState().upsertRetroBoard({
      ...board([
        card({ id: "t1", columnKey: "discussing", text: "Standups", votes: 3, discussing: true }),
      ]),
      phase: "discuss",
    });
    const r = await registry.get("tool.retro.list_state")!.handler({}, ctx());
    expect(JSON.stringify(r)).not.toMatch(/"(poll|thumbs?|keep|move|voters)"/);
  });
});

describe("tool.retro.add_card", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ retroBoards: [] });
  });

  it("no-ops {added:false} when no retro is active", async () => {
    const action = registry.get("tool.retro.add_card");
    const r = (await action!.handler({ columnKey: "good", text: "x" }, ctx())) as {
      added: boolean;
    };
    expect(r.added).toBe(false);
  });

  it("appends a card to the active board", async () => {
    useWorkspaceStore.getState().upsertRetroBoard(board([]));

    const action = registry.get("tool.retro.add_card");
    const r = (await action!.handler({ columnKey: "good", text: "great teamwork" }, ctx())) as {
      added: boolean;
      id: string;
    };
    expect(r.added).toBe(true);

    const stored = (useWorkspaceStore.getState().retroBoards ?? []).find((b) => b.id === RB_ID);
    expect(stored?.cards).toHaveLength(1);
    expect(stored?.cards[0].text).toBe("great teamwork");
    expect(stored?.cards[0].columnKey).toBe("good");
  });
});

describe("tool.retro.list_state previousActions", () => {
  const ARCHIVE = "retro:2026-10-05T10:00:00.000Z";
  const OLDER = "retro:2026-09-01T10:00:00.000Z";
  const sent = { route: "kanban" as const, targetId: "k1", at: "2026-10-05T11:00:00.000Z" };

  function archived(id: string, cards: RetroCard[]): RetroBoard {
    return { ...board(cards), id, archivedAt: id.slice("retro:".length), phase: "actions" };
  }
  const archive = () =>
    archived(ARCHIVE, [
      card({
        id: "a1",
        columnKey: "good",
        text: "pair on tests",
        isActionItem: true,
        assignee: "Sam",
        sentTo: [sent],
      }),
      card({ id: "a2", columnKey: "bad", text: "fix CI", isActionItem: true }),
      card({ id: "n1", columnKey: "good", text: "not an action" }),
    ]);
  const older = () => archived(OLDER, [card({ id: "o1", columnKey: "good", isActionItem: true })]);
  const currentFollowing = (previousRetroId?: string) => ({
    ...board([
      card({
        id: "c1",
        columnKey: "good",
        text: "pair on tests",
        isActionItem: true,
        carriedFrom: "a1",
      }),
    ]),
    ...(previousRetroId ? { previousRetroId } : {}),
  });

  type Result = {
    exists: boolean;
    previousActions: {
      id: string;
      text: string;
      assignee: string;
      retroId: string;
      carriedOver: boolean;
      sentTo: unknown[];
    }[];
  };

  beforeEach(() => {
    useWorkspaceStore.setState({ retroBoards: [] });
  });

  it("is empty when there is no archived retro", async () => {
    useWorkspaceStore.getState().upsertRetroBoard(board([]));
    const r = (await registry.get("tool.retro.list_state")!.handler({}, ctx())) as Result;
    expect(r.previousActions).toEqual([]);
  });

  it("lists the followed retro's action items, carried over or sent", async () => {
    useWorkspaceStore.setState({ retroBoards: [older(), archive(), currentFollowing(ARCHIVE)] });
    const r = (await registry.get("tool.retro.list_state")!.handler({}, ctx())) as Result;
    expect(r.exists).toBe(true);
    expect(r.previousActions).toEqual([
      {
        id: "a1",
        text: "pair on tests",
        assignee: "Sam",
        retroId: ARCHIVE,
        carriedOver: true,
        done: false,
        sentTo: [sent],
      },
      {
        id: "a2",
        text: "fix CI",
        assignee: "",
        retroId: ARCHIVE,
        carriedOver: false,
        done: false,
        sentTo: [],
      },
    ]);
  });

  it("follows previousRetroId over the newest archive", async () => {
    useWorkspaceStore.setState({ retroBoards: [older(), archive(), currentFollowing(OLDER)] });
    const r = (await registry.get("tool.retro.list_state")!.handler({}, ctx())) as Result;
    expect(r.previousActions.map((a) => a.id)).toEqual(["o1"]);
  });

  it("falls back to the newest archive, even with no current board", async () => {
    useWorkspaceStore.setState({ retroBoards: [older(), archive()] });
    const r = (await registry.get("tool.retro.list_state")!.handler({}, ctx())) as Result;
    expect(r.exists).toBe(false);
    expect(r.previousActions.map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(r.previousActions.every((a) => !a.carriedOver)).toBe(true);
  });

  it("reads the same from the server on the MCP path", async () => {
    const boards = [older(), archive(), currentFollowing()];
    vi.mocked(serverStore.serverGetEntity).mockImplementation(
      (async (_u: string, _k: string, id: string) =>
        boards.find((b) => b.id === id) ?? null) as typeof serverStore.serverGetEntity
    );
    vi.mocked(serverStore.serverListEntities).mockImplementation(
      (async () => boards) as typeof serverStore.serverListEntities
    );

    const r = (await registry.get("tool.retro.list_state")!.mcpHandler!({}, ctx())) as Result;
    expect(r.exists).toBe(true);
    expect(r.previousActions.map((a) => [a.id, a.carriedOver])).toEqual([
      ["a1", true],
      ["a2", false],
    ]);
    expect(serverStore.serverListEntities).toHaveBeenCalledWith(
      "test-user",
      "workspace:retroBoard"
    );
  });
});

describe("tool.retro on an Emotional Seismograph board", () => {
  const SEISMO = retroFormats.find((f) => f.id === "seismograph")!;
  const seismoBoard = (cards: RetroCard[], over: Partial<RetroBoard> = {}): RetroBoard => ({
    ...board(cards),
    format: SEISMO,
    ...over,
  });
  const run = async <T>(name: string, params: Record<string, unknown> = {}) =>
    (await registry.get(`tool.retro.${name}`)!.handler(params, ctx())) as T;
  const cards = () =>
    (useWorkspaceStore.getState().retroBoards ?? []).find((b) => b.id === RB_ID)?.cards ?? [];

  beforeEach(() => {
    useWorkspaceStore.setState({ retroBoards: [], sprints: [] });
    vi.mocked(serverStore.serverGetEntity).mockReset().mockResolvedValue(null);
    vi.mocked(serverStore.serverListEntities).mockReset().mockResolvedValue([]);
    vi.mocked(serverStore.serverUpsertEntity)
      .mockReset()
      .mockResolvedValue(undefined as never);
  });

  it("offers the format to start, and set_card_day writes without a confirmation", () => {
    expect(registry.get("tool.retro.start")?.description).toContain("seismograph");
    const action = registry.get("tool.retro.set_card_day");
    expect(action?.category).toBe("write");
    expect(action?.requiresConfirmation).toBe(false);
    expect(action?.mcpHandler).toBeTypeOf("function");
    expect(action?.visitor).not.toBe(false);
  });

  it("add_card keeps a day here, and says it ignored one elsewhere", async () => {
    useWorkspaceStore.getState().upsertRetroBoard(seismoBoard([]));
    const r = await run<{ added: boolean; dayIgnored?: boolean }>("add_card", {
      columnKey: "lows",
      text: "The outage",
      day: 4,
    });
    expect(r).toMatchObject({ added: true });
    expect(r.dayIgnored).toBeUndefined();
    expect(cards()[0]).toMatchObject({ text: "The outage", day: 4 });
    useWorkspaceStore.setState({ retroBoards: [board([])] });
    const other = await run<{ added: boolean; dayIgnored?: boolean }>("add_card", {
      columnKey: "mad",
      text: "Late",
      day: 2,
    });
    expect(other).toMatchObject({ added: true, dayIgnored: true });
    expect("day" in cards()[0]).toBe(false);
    const schema = registry.get("tool.retro.add_card")!.paramsSchema;
    expect(schema.safeParse({ columnKey: "lows", text: "x", day: 31 }).success).toBe(false);
    expect(schema.safeParse({ columnKey: "lows", text: "x", day: 2.5 }).success).toBe(false);
  });

  it("set_card_day places a card, clears it, and refuses off this board", async () => {
    useWorkspaceStore
      .getState()
      .upsertRetroBoard(
        seismoBoard([
          card({ id: "c1", columnKey: "lows", text: "Outage" }),
          card({ id: "a1", columnKey: "lows", text: "Fix alerts", isActionItem: true }),
          card({ id: "g1", columnKey: "lows", text: "Same outage", groupedWith: "c1" }),
        ])
      );
    expect(await run("set_card_day", { cardId: "c1", day: 3 })).toEqual({
      updated: true,
      day: 3,
      charted: true,
    });
    expect(cards()[0].day).toBe(3);
    // An action item and a grouped card keep the day, but don't chart by it.
    expect(await run("set_card_day", { cardId: "a1", day: 5 })).toMatchObject({ charted: false });
    expect(await run("set_card_day", { cardId: "g1", day: 6 })).toMatchObject({ charted: false });
    expect(await run("set_card_day", { cardId: "c1", day: null })).toMatchObject({ updated: true });
    expect("day" in cards()[0]).toBe(false);
    expect(await run("set_card_day", { cardId: "nope", day: 1 })).toEqual({
      updated: false,
      reason: "unknown_card",
    });
    useWorkspaceStore.setState({ retroBoards: [board([card({ id: "c1", columnKey: "mad" })])] });
    expect(await run("set_card_day", { cardId: "c1", day: 1 })).toEqual({
      updated: false,
      reason: "not_seismograph",
    });
    useWorkspaceStore.setState({ retroBoards: [] });
    expect(await run("set_card_day", { cardId: "c1", day: 1 })).toEqual({
      updated: false,
      reason: "no_retro",
    });
  });

  it("list_state reads the chart from the cards: days from the sprint, placed, unplaced and the read", async () => {
    useWorkspaceStore.setState({
      sprints: [
        {
          id: "s1",
          name: "Sprint 12",
          startDate: "2026-11-09",
          endDate: "2026-11-20",
          pointsPlanned: 10,
          status: "completed",
        },
      ],
      retroBoards: [
        seismoBoard(
          [
            card({ id: "h1", columnKey: "highs", text: "Shipped", day: 4, votes: 2 }),
            card({ id: "l1", columnKey: "lows", text: "Outage", day: 4 }),
            card({ id: "s1c", columnKey: "steady", text: "Pairing" }),
            card({ id: "late", columnKey: "lows", text: "Past the end", day: 20 }),
            card({
              id: "sent",
              columnKey: "lows",
              text: "From Root Cause",
              sourceRef: { tool: "root-cause", id: "rca_1" },
              day: 1,
            }),
          ],
          { sprintId: "s1" }
        ),
      ],
    });
    const r = await run<{
      seismograph: {
        days: { day: number; date: string | null }[];
        placed: { cardId: string; band: string; day: number; votes: number }[];
        unplaced: { cardId: string; day: number | null }[];
        read: string[];
      } | null;
    }>("list_state");
    expect(r.seismograph?.days).toHaveLength(12);
    expect(r.seismograph?.days[0]).toEqual({ day: 0, date: "2026-11-09" });
    expect(r.seismograph?.placed.map((p) => [p.cardId, p.band, p.day, p.votes])).toEqual([
      ["h1", "high", 4, 2],
      ["l1", "low", 4, 0],
    ]);
    expect(r.seismograph?.unplaced.map((u) => [u.cardId, u.day])).toEqual([
      ["s1c", null],
      ["late", 20],
    ]);
    expect(r.seismograph?.read).toEqual(["Day 4 had both a high and a low."]);
    expect(registry.get("tool.retro.list_state")?.description).toContain("not the team's mood");
  });

  it("list_state has no seismograph on another board, and Day 0–9 with no sprint", async () => {
    useWorkspaceStore.setState({ retroBoards: [board([])] });
    expect((await run<{ seismograph: unknown }>("list_state")).seismograph).toBeNull();
    useWorkspaceStore.setState({ retroBoards: [seismoBoard([])] });
    const r = await run<{ seismograph: { days: unknown[] } }>("list_state");
    expect(r.seismograph.days).toHaveLength(10);
  });

  it("writes a card's day to the user's board over MCP", async () => {
    const row = seismoBoard([card({ id: "c1", columnKey: "highs", text: "Demo went well" })]);
    vi.mocked(serverStore.serverGetEntity).mockResolvedValue(row as never);
    const r = await registry.get("tool.retro.set_card_day")!.mcpHandler!(
      { cardId: "c1", day: 2 },
      ctx()
    );
    expect(r).toMatchObject({ updated: true, day: 2, charted: true });
    const [, kind, saved] = vi.mocked(serverStore.serverUpsertEntity).mock.calls[0] as unknown as [
      string,
      string,
      RetroBoard,
    ];
    expect(kind).toBe("workspace:retroBoard");
    expect(saved.cards[0].day).toBe(2);
    expect(useWorkspaceStore.getState().retroBoards).toEqual([]);
  });
});
