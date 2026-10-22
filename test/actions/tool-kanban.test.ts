/**
 * tool.kanban.* coverage.
 *
 *   1. list_state (read) + add_card / move_card (write, mcpHandler, no confirm)
 *   2. list_state: per-column counts, WIP breaches, avg cycle time
 *   3. add_card creates the board + defaults; move_card stamps started/completed
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { KanbanBoard } from "@/lib/stores/workspace-types";

import "@/lib/actions/tools/kanban";

const KB_ID = "kanban:current";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

function board(partial: Partial<KanbanBoard> = {}): KanbanBoard {
  return {
    id: KB_ID,
    cards: [],
    wipLimits: { backlog: 0, ready: 5, in_progress: 2, review: 2, done: 0 },
    ...partial,
  };
}

describe("tool.kanban — registration", () => {
  it("list_state read; add_card/move_card write + mcpHandler + no confirm", () => {
    expect(registry.get("tool.kanban.list_state")?.category).toBe("read");
    for (const id of ["tool.kanban.add_card", "tool.kanban.move_card"]) {
      expect(registry.get(id)?.category).toBe("write");
      expect(registry.get(id)?.mcpHandler).toBeTypeOf("function");
      expect(registry.get(id)?.requiresConfirmation).toBe(false);
    }
  });
});

describe("tool.kanban.list_state", () => {
  beforeEach(() => useWorkspaceStore.setState({ kanbanBoards: [] }));

  it("reports exists:false with no board", async () => {
    const r = (await registry.get("tool.kanban.list_state")!.handler({}, ctx())) as {
      exists: boolean;
      totalCards: number;
    };
    expect(r.exists).toBe(false);
    expect(r.totalCards).toBe(0);
  });

  it("counts by column, flags WIP breaches, and averages cycle time", async () => {
    useWorkspaceStore.getState().upsertKanbanBoard(
      board({
        cards: [
          {
            id: "a",
            title: "A",
            column: "in_progress",
            class: "standard",
            createdAt: "2026-01-01",
          },
          {
            id: "b",
            title: "B",
            column: "in_progress",
            class: "standard",
            createdAt: "2026-01-01",
          },
          {
            id: "c",
            title: "C",
            column: "in_progress",
            class: "standard",
            createdAt: "2026-01-01",
          },
          {
            id: "d",
            title: "D",
            column: "done",
            class: "standard",
            createdAt: "2026-01-01",
            startedAt: "2026-01-01",
            completedAt: "2026-01-05",
          },
        ],
      })
    );
    const r = (await registry.get("tool.kanban.list_state")!.handler({}, ctx())) as {
      totalCards: number;
      byColumn: Record<string, number>;
      wipBreaches: { column: string; count: number; limit: number }[];
      avgCycleTimeDays: number | null;
    };
    expect(r.totalCards).toBe(4);
    expect(r.byColumn.in_progress).toBe(3);
    // in_progress limit 2, count 3 → breach
    expect(r.wipBreaches.find((w) => w.column === "in_progress")).toMatchObject({
      count: 3,
      limit: 2,
    });
    expect(r.avgCycleTimeDays).toBe(4); // 2026-01-01 → 2026-01-05
  });
});

describe("tool.kanban add_card / move_card", () => {
  beforeEach(() => useWorkspaceStore.setState({ kanbanBoards: [] }));

  it("add_card creates the board with defaults", async () => {
    const r = (await registry.get("tool.kanban.add_card")!.handler({ title: "New" }, ctx())) as {
      added: boolean;
    };
    expect(r.added).toBe(true);
    const stored = (useWorkspaceStore.getState().kanbanBoards ?? []).find((b) => b.id === KB_ID);
    expect(stored?.cards).toHaveLength(1);
    expect(stored?.cards[0].column).toBe("backlog");
    expect(stored?.cards[0].class).toBe("standard");
  });

  it("move_card stamps startedAt (in_progress) then completedAt (done)", async () => {
    useWorkspaceStore.getState().upsertKanbanBoard(
      board({
        cards: [
          { id: "x", title: "X", column: "backlog", class: "standard", createdAt: "2026-01-01" },
        ],
      })
    );
    const move = registry.get("tool.kanban.move_card")!;
    await move.handler({ cardId: "x", column: "in_progress" }, ctx());
    let card = (useWorkspaceStore.getState().kanbanBoards ?? [])[0].cards[0];
    expect(card.column).toBe("in_progress");
    expect(card.startedAt).toBeTruthy();
    expect(card.completedAt).toBeUndefined();

    await move.handler({ cardId: "x", column: "done" }, ctx());
    card = (useWorkspaceStore.getState().kanbanBoards ?? [])[0].cards[0];
    expect(card.column).toBe("done");
    expect(card.completedAt).toBeTruthy();
  });

  // Bug: move_card kept completedAt when a card left Done (and startedAt when
  // it went back to Backlog/Ready), unlike the board's own move, so a
  // reopened card still counted toward throughput and cycle time.
  it("move_card drops stale stamps when a card leaves Done, like the board does", async () => {
    useWorkspaceStore.getState().upsertKanbanBoard(
      board({
        cards: [
          {
            id: "x",
            title: "X",
            column: "done",
            class: "standard",
            createdAt: "2026-01-01",
            startedAt: "2026-01-02",
            completedAt: "2026-01-05",
          },
        ],
      })
    );
    const move = registry.get("tool.kanban.move_card")!;
    const cardX = () => (useWorkspaceStore.getState().kanbanBoards ?? [])[0].cards[0];

    await move.handler({ cardId: "x", column: "in_progress" }, ctx());
    expect(cardX().completedAt).toBeUndefined();
    expect(cardX().startedAt).toBe("2026-01-02");
    let state = (await registry.get("tool.kanban.list_state")!.handler({}, ctx())) as {
      avgCycleTimeDays: number | null;
    };
    expect(state.avgCycleTimeDays).toBeNull();

    await move.handler({ cardId: "x", column: "ready" }, ctx());
    expect(cardX().startedAt).toBeUndefined();

    // Re-done: fresh stamps, so the rework counts once.
    await move.handler({ cardId: "x", column: "in_progress" }, ctx());
    await move.handler({ cardId: "x", column: "done" }, ctx());
    expect(cardX().startedAt).toBeTruthy();
    expect(cardX().completedAt).toBeTruthy();
    state = (await registry.get("tool.kanban.list_state")!.handler({}, ctx())) as {
      avgCycleTimeDays: number | null;
    };
    expect(state.avgCycleTimeDays).toBe(0);
  });

  it("move_card returns {updated:false} for an unknown card", async () => {
    useWorkspaceStore.getState().upsertKanbanBoard(board());
    const r = (await registry
      .get("tool.kanban.move_card")!
      .handler({ cardId: "nope", column: "done" }, ctx())) as { updated: boolean };
    expect(r.updated).toBe(false);
  });
});

// Bug: the agent stamped date-only UTC days while the board stamps full
// timestamps, so cycle times from agent moves lost up to a day.
describe("tool.kanban stamps — full timestamps like the board", () => {
  beforeEach(() => useWorkspaceStore.setState({ kanbanBoards: [] }));

  it("add_card and move_card write full ISO timestamps", async () => {
    const add = (await registry
      .get("tool.kanban.add_card")!
      .handler({ title: "Ship it", column: "in_progress" }, ctx())) as { id: string };
    await registry.get("tool.kanban.move_card")!.handler({ cardId: add.id, column: "done" }, ctx());
    const card = useWorkspaceStore.getState().kanbanBoards![0].cards[0];
    const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    expect(card.createdAt).toMatch(iso);
    expect(card.startedAt).toMatch(iso);
    expect(card.completedAt).toMatch(iso);
  });
});
