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
