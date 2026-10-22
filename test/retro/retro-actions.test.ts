import { describe, expect, it } from "vitest";
import type { RetroBoard, RetroCard } from "@/lib/stores/workspace-types";
import { retroFormats } from "@/lib/constants/retro-formats";
import {
  RETRO_CURRENT_ID,
  collectRetroActions,
  summarizeRetroActions,
  withActionDone,
  withActionPatch,
} from "@/lib/retro/actions";

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

const OLD = board("retro:2026-09-20T10:00:00.000Z", [card("o1", { assignee: "Sam" }), card("o2")], {
  archivedAt: "2026-09-20T10:00:00.000Z",
});
const LAST = board(
  "retro:2026-10-05T10:00:00.000Z",
  [
    card("l1", { dueDate: "2026-10-15" }),
    card("l2", { done: true, doneAt: "2026-10-10T09:00:00.000Z" }),
    card("l3", { sentTo: [{ route: "impediment", targetId: "imp-1", at: "2026-10-06" }] }),
    card("note", { isActionItem: false }),
  ],
  { archivedAt: "2026-10-05T10:00:00.000Z" }
);
const CURRENT = board(
  RETRO_CURRENT_ID,
  [card("c1", { carriedFrom: "o2", dueDate: "2026-10-30" })],
  {
    previousRetroId: LAST.id,
  }
);

describe("collectRetroActions", () => {
  it("lists the current board first, then the archives newest first, action items only", () => {
    const actions = collectRetroActions([OLD, LAST, CURRENT], { today: "2026-10-22" });
    expect(actions.map((a) => a.id)).toEqual(["c1", "l1", "l2", "l3", "o1"]);
    expect(actions[0]).toMatchObject({
      current: true,
      retroLabel: "Current retro",
      carriedFrom: "o2",
    });
    expect(actions[1].retroLabel).toBe("Start / Stop / Continue · 5 Oct 2026");
  });

  it("leaves out an archived action that was carried onto the current board", () => {
    const ids = collectRetroActions([OLD, CURRENT], { today: "2026-10-22" }).map((a) => a.id);
    expect(ids).not.toContain("o2");
    expect(ids).toContain("o1");
  });

  it("flags overdue open actions and respects a done mark", () => {
    const actions = collectRetroActions([LAST], { today: "2026-10-22" });
    expect(actions.find((a) => a.id === "l1")).toMatchObject({ done: false, overdue: true });
    expect(actions.find((a) => a.id === "l2")).toMatchObject({ done: true, overdue: false });
  });

  it("counts an action as done when the item it was sent to is finished", () => {
    const open = collectRetroActions([LAST], { today: "2026-10-22", targetDone: () => false });
    expect(open.find((a) => a.id === "l3")).toMatchObject({ done: false, closedByTarget: false });
    const closed = collectRetroActions([LAST], {
      today: "2026-10-22",
      targetDone: (link) => link.targetId === "imp-1",
    });
    expect(closed.find((a) => a.id === "l3")).toMatchObject({ done: true, closedByTarget: true });
  });

  it("summarises open, overdue and done", () => {
    const actions = collectRetroActions([OLD, LAST, CURRENT], { today: "2026-10-22" });
    expect(summarizeRetroActions(actions)).toEqual({ open: 4, overdue: 1, done: 1 });
  });
});

describe("editing an action on its board", () => {
  it("marks it done with a timestamp, and open again without one", () => {
    const done = withActionDone(LAST, "l1", true, "2026-10-22T08:00:00.000Z")!;
    expect(done.cards.find((c) => c.id === "l1")).toMatchObject({
      done: true,
      doneAt: "2026-10-22T08:00:00.000Z",
    });
    const reopened = withActionDone(done, "l1", false)!;
    const c = reopened.cards.find((x) => x.id === "l1")!;
    expect(c.done).toBeUndefined();
    expect(c.doneAt).toBeUndefined();
  });

  it("patches owner and due date, removing a cleared field", () => {
    const next = withActionPatch(LAST, "l1", { assignee: "Priya", dueDate: undefined })!;
    const c = next.cards.find((x) => x.id === "l1")!;
    expect(c.assignee).toBe("Priya");
    expect("dueDate" in c).toBe(false);
    expect(next.cards.find((x) => x.id === "note")).toEqual(LAST.cards[3]);
  });

  it("returns null for a card that isn't on the board", () => {
    expect(withActionDone(LAST, "ghost", true)).toBeNull();
  });
});
