/**
 * tool.retro_actions.* coverage.
 *
 *   1. registration — list read; complete write.
 *   2. list across boards with counts and a status filter; complete marks
 *      the card on whichever board holds it, and reopens it.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { RetroBoard, RetroCard } from "@/lib/stores/workspace-types";
import { retroFormats } from "@/lib/constants/retro-formats";

import "@/lib/actions/tools/retro-actions";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

const card = (id: string, extra: Partial<RetroCard> = {}): RetroCard => ({
  id,
  columnKey: "start",
  text: `Action ${id}`,
  votes: 0,
  groupedWith: null,
  isActionItem: true,
  assignee: "",
  discussing: false,
  ...extra,
});
const board = (id: string, cards: RetroCard[], extra: Partial<RetroBoard> = {}): RetroBoard => ({
  id,
  format: retroFormats[0],
  phase: "actions",
  cards,
  userVotes: 0,
  timerSeconds: 0,
  timerRunning: false,
  discussingIndex: 0,
  ...extra,
});

describe("tool.retro_actions — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.retro_actions.list")?.category).toBe("read");
    expect(registry.get("tool.retro_actions.complete")?.category).toBe("write");
    expect(registry.get("tool.retro_actions.complete")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.retro_actions.complete")?.requiresConfirmation).toBe(false);
  });
});

describe("tool.retro_actions.list + complete", () => {
  beforeEach(() =>
    useWorkspaceStore.setState({
      retroBoards: [
        board(
          "retro:2026-10-05T10:00:00.000Z",
          [card("a1", { dueDate: "2000-01-01" }), card("a2", { done: true })],
          {
            archivedAt: "2026-10-05T10:00:00.000Z",
          }
        ),
        board("retro:current", [card("c1"), card("note", { isActionItem: false })]),
      ],
    })
  );

  it("lists actions across boards with counts, filtered by status", async () => {
    const all = (await registry.get("tool.retro_actions.list")!.handler({}, ctx())) as {
      open: number;
      overdue: number;
      done: number;
      actions: { id: string; retro: string; overdue: boolean }[];
    };
    expect(all).toMatchObject({ open: 2, overdue: 1, done: 1 });
    expect(all.actions.map((a) => a.id)).toEqual(["c1", "a1", "a2"]);
    expect(all.actions[0].retro).toBe("Current retro");

    const overdue = (await registry
      .get("tool.retro_actions.list")!
      .handler({ status: "overdue" }, ctx())) as { actions: { id: string }[] };
    expect(overdue.actions.map((a) => a.id)).toEqual(["a1"]);
  });

  it("filters to open or done actions, and reports nulls for unset fields", async () => {
    const list = registry.get("tool.retro_actions.list")!;
    const open = (await list.handler({ status: "open" }, ctx())) as {
      open: number;
      actions: { id: string; dueDate: string | null; doneAt: string | null }[];
    };
    expect(open.actions.map((a) => a.id)).toEqual(["c1", "a1"]);
    // The counts always cover every action, whatever the filter.
    expect(open.open).toBe(2);
    expect(open.actions[0]).toMatchObject({ dueDate: null, doneAt: null });

    const done = (await list.handler({ status: "done" }, ctx())) as {
      done: number;
      actions: { id: string; done: boolean }[];
    };
    expect(done.actions.map((a) => [a.id, a.done])).toEqual([["a2", true]]);
    expect(done.done).toBe(1);
  });

  it("returns updated:false for an id no board holds", async () => {
    const r = (await registry
      .get("tool.retro_actions.complete")!
      .handler({ cardId: "ghost" }, ctx())) as { updated: boolean };
    expect(r).toEqual({ updated: false });
  });

  it("completes an action on the board that holds it, and reopens it", async () => {
    const done = (await registry
      .get("tool.retro_actions.complete")!
      .handler({ cardId: "a1" }, ctx())) as { updated: boolean; boardId?: string; done?: boolean };
    expect(done).toEqual({ updated: true, boardId: "retro:2026-10-05T10:00:00.000Z", done: true });
    const stored = useWorkspaceStore
      .getState()
      .retroBoards!.find((b) => b.id === "retro:2026-10-05T10:00:00.000Z")!
      .cards.find((c) => c.id === "a1")!;
    expect(stored.done).toBe(true);
    expect(stored.doneAt).toBeTruthy();

    const reopened = (await registry
      .get("tool.retro_actions.complete")!
      .handler({ cardId: "a1", done: false }, ctx())) as { updated: boolean };
    expect(reopened.updated).toBe(true);

    const ghost = (await registry
      .get("tool.retro_actions.complete")!
      .handler({ cardId: "note" }, ctx())) as { updated: boolean };
    expect(ghost.updated).toBe(false);
  });
});
