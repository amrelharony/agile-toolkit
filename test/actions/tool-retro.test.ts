/**
 * tool.retro.* action coverage.
 *
 *   1. list_state (read) + add_card (write w/ mcpHandler, no confirm)
 *   2. list_state summarises per-column counts, vote total, action items,
 *      and top-voted cards; reports exists:false with no board
 *   3. add_card appends to the active board, and no-ops {added:false} when
 *      no retro is active
 */

import { describe, it, expect, beforeEach } from "vitest";
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
