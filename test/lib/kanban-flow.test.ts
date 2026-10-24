/**
 * lib/kanban/flow: a Flow-board move records itself in the card's history
 * (capped at the latest KANBAN_HISTORY_CAP); the page and tool.kanban.move_card
 * both write through it.
 */

import { describe, expect, it } from "vitest";
import { KANBAN_HISTORY_CAP, movedCard } from "@/lib/kanban/flow";
import type { KanbanCard } from "@/lib/stores/workspace-types";

const AT = "2026-10-20T09:00:00.000Z";

const card = (patch: Partial<KanbanCard> = {}): KanbanCard => ({
  id: "c1",
  title: "Checkout",
  column: "backlog",
  class: "standard",
  createdAt: "2026-10-01T09:00:00.000Z",
  ...patch,
});

describe("movedCard history", () => {
  it("records each move with the column it left, oldest first", () => {
    const ready = movedCard(card(), "ready", AT);
    expect(ready.history).toEqual([{ column: "ready", from: "backlog", at: AT }]);
    const later = "2026-10-21T15:30:00.000Z";
    expect(movedCard(ready, "in_progress", later).history).toEqual([
      { column: "ready", from: "backlog", at: AT },
      { column: "in_progress", from: "ready", at: later },
    ]);
  });

  it("records nothing for a move to the column it is in (the same card back)", () => {
    const c = card({ history: [{ column: "backlog", from: "ready", at: AT }] });
    expect(movedCard(c, "backlog", AT)).toBe(c);
  });

  it("keeps only the latest moves", () => {
    expect(KANBAN_HISTORY_CAP).toBe(50);
    let c = card();
    for (let i = 0; i < KANBAN_HISTORY_CAP + 7; i++) {
      c = movedCard(
        c,
        i % 2 ? "backlog" : "ready",
        new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString()
      );
    }
    expect(c.history).toHaveLength(KANBAN_HISTORY_CAP);
    // The oldest seven went; the first kept entry still says where it came from.
    expect(c.history![0]).toEqual({
      column: "backlog",
      from: "ready",
      at: new Date(Date.UTC(2026, 8, 1, 0, 7)).toISOString(),
    });
    expect(c.history![KANBAN_HISTORY_CAP - 1].column).toBe(c.column);
  });

  it("doesn't change a stored card's other stamps", () => {
    const done = movedCard(card({ column: "review", startedAt: AT }), "done", AT);
    expect(done).toMatchObject({ column: "done", startedAt: AT, completedAt: AT, columnSince: AT });
  });
});
