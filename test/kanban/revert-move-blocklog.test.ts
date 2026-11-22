// @vitest-environment node
/**
 * The Sprint board's move Undo (`revertMove`) and blocked spells: a move to
 * Done drops the flag, which closes the open spell; its Undo puts the flag
 * back and the spells as they were, so the spell is open again and the
 * store keeps that log as written. Not through the move's flow keys: a
 * spell opened after a move to Review stays when that move is undone.
 */

import { describe, expect, it } from "vitest";
import { revertMove } from "@/app/(tools)/kanban/sprint-view";
import { stampStoryBlocks } from "@/lib/flow/block-stamps";
import { withStoryBlocked, withStoryStatus } from "@/lib/sprints/story-status";
import type { Story } from "@/lib/stores/workspace-types";

const T0 = "2026-11-23T09:00:00.000Z";
const T1 = "2026-11-24T09:00:00.000Z";
const T2 = "2026-11-25T09:00:00.000Z";
const T3 = "2026-11-26T09:00:00.000Z";

const before: Story = {
  id: "st1",
  title: "Pay by card",
  status: "in_progress",
  sprintId: "s1",
  startedAt: T0,
  blocked: true,
  statusHistory: [{ status: "in_progress", from: "todo", at: T0 }],
  blockLog: [{ from: T1, cause: "Waiting on the gateway" }],
};

/** What the store saves for a write: the block stamps over the stored row. */
const save = (next: Story, stored: Story, at: string) => stampStoryBlocks(next, stored, at);

describe("revertMove and the blocked log", () => {
  it("opens the spell a move to Done closed again, and the store keeps it", () => {
    const done = save(withStoryStatus(before, "done", T2), before, T2);
    expect(done.blocked).toBeUndefined();
    expect(done.blockLog).toEqual([{ from: T1, cause: "Waiting on the gateway", to: T2 }]);

    const back = revertMove(done, before, "done")!;
    expect(back).toMatchObject({ status: "in_progress", blocked: true });
    expect(back.blockLog).toEqual(before.blockLog);
    // A log the write set itself: kept as written, not stamped again.
    expect(save(back, done, T3)).toBe(back);
  });

  it("leaves the log alone when the move didn't clear the flag", () => {
    const todo: Story = { id: "st2", title: "Receipts", status: "todo", sprintId: "s1" };
    const moved = save(withStoryStatus(todo, "review", T1), todo, T1);
    // Blocked after the move: a spell opened in Review.
    const blocked = save(withStoryBlocked(moved, true), moved, T2);
    expect(blocked.blockLog).toEqual([{ from: T2 }]);

    const back = revertMove(blocked, todo, "review")!;
    expect(back.status).toBe("todo");
    expect(back.blocked).toBe(true);
    expect(back.blockLog).toEqual([{ from: T2 }]);
  });

  it("drops the log when the story had none before the move", () => {
    const untracked: Story = { ...before, blockLog: undefined };
    delete untracked.blockLog;
    const done = save(withStoryStatus(untracked, "done", T2), untracked, T2);
    expect(done.blockLog).toBeUndefined();
    const back = revertMove({ ...done, blockLog: [{ from: T2, to: T3 }] }, untracked, "done")!;
    expect(back.blocked).toBe(true);
    expect("blockLog" in back).toBe(false);
  });

  it("still refuses a story that has moved again since", () => {
    const done = save(withStoryStatus(before, "done", T2), before, T2);
    const reopened = withStoryStatus(done, "review", T3);
    expect(revertMove(reopened, before, "done")).toBeNull();
  });
});
