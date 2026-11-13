import { describe, expect, it } from "vitest";
import { retroFormats } from "@/lib/constants/retro-formats";
import type { BoardState, RetroCard } from "@/app/(tools)/retro/types";
import {
  LEAN_COFFEE_COLUMNS,
  currentTopic,
  doneTopics,
  isLeanCoffee,
  leanTopics,
  minutesIn,
  thumbsDecision,
  topicQueue,
  withTopicBack,
  withTopicDone,
  withTopicExtended,
  withTopicStarted,
  withTopicsMerged,
} from "@/lib/retro/lean-coffee";

/**
 * The Lean Coffee runner's rules (lib/retro/lean-coffee): topics in vote
 * order with their groups' votes, one in Discussing at a time with the
 * board's timer as its timebox, Done when the room moves on, the thumbs'
 * verdict, and merging topics that are the same.
 */

const lean = retroFormats.find((f) => f.id === "lean-coffee")!;
const card = (id: string, over: Partial<RetroCard> = {}): RetroCard => ({
  id,
  columnKey: LEAN_COFFEE_COLUMNS.todo,
  text: `Topic ${id}`,
  votes: 0,
  groupedWith: null,
  isActionItem: false,
  assignee: "",
  discussing: false,
  ...over,
});
const board = (cards: RetroCard[], over: Partial<BoardState> = {}): BoardState => ({
  format: lean,
  phase: "discuss",
  cards,
  userVotes: 0,
  timerSeconds: 300,
  timerRunning: false,
  discussingIndex: 0,
  ...over,
});

describe("a Lean Coffee board", () => {
  it("is the lean-coffee format with its three columns", () => {
    expect(isLeanCoffee(board([]))).toBe(true);
    expect(isLeanCoffee(board([], { format: retroFormats[0] }))).toBe(false);
    expect(
      isLeanCoffee(board([], { format: { ...lean, columns: lean.columns.slice(0, 2) } }))
    ).toBe(false);
  });
});

describe("the topics", () => {
  const cards = [
    card("a", { votes: 1 }),
    card("b", { votes: 3 }),
    card("c", { votes: 1 }),
    card("g", { votes: 2, groupedWith: "a" }),
    card("x", { isActionItem: true, votes: 9 }),
    card("d", { columnKey: LEAN_COFFEE_COLUMNS.done, votes: 5 }),
  ];

  it("are top-level, non-action cards, with their group's votes", () => {
    expect(leanTopics(cards).map((t) => [t.id, t.votes])).toEqual([
      ["a", 3],
      ["b", 3],
      ["c", 1],
      ["d", 5],
    ]);
  });

  it("are taken most votes first, the board's order between equals", () => {
    expect(topicQueue(cards).map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(doneTopics(cards).map((t) => t.id)).toEqual(["d"]);
  });
});

describe("running a topic", () => {
  it("starts one in Discussing with its group, the timer set and running", () => {
    const b = withTopicStarted(
      board([card("a"), card("g", { groupedWith: "a" }), card("b")]),
      "a",
      420
    );
    expect(b.cards.find((c) => c.id === "a")).toMatchObject({
      columnKey: "discussing",
      discussing: true,
    });
    expect(b.cards.find((c) => c.id === "g")).toMatchObject({
      columnKey: "discussing",
      discussing: false,
    });
    expect(b).toMatchObject({ timerSeconds: 420, timerRunning: true });
    expect(currentTopic(b.cards)?.id).toBe("a");
  });

  it("moves a topic still in Discussing to Done when the next one starts", () => {
    const first = withTopicStarted(board([card("a"), card("b")]), "a", 420);
    const second = withTopicStarted(first, "b", 420);
    expect(second.cards.find((c) => c.id === "a")?.columnKey).toBe("done");
    expect(currentTopic(second.cards)?.id).toBe("b");
  });

  it("keeps going with more time, finishes to Done, and goes back on Undo", () => {
    const started = withTopicStarted(board([card("a")]), "a", 420);
    const over = { ...started, timerSeconds: 0, timerRunning: false };
    expect(withTopicExtended(over, 180)).toMatchObject({ timerSeconds: 180, timerRunning: true });
    const done = withTopicDone(started, "a");
    expect(done.cards[0]).toMatchObject({ columnKey: "done", discussing: false });
    expect(done.timerRunning).toBe(false);
    expect(withTopicBack(done, "a").cards[0].columnKey).toBe("to-discuss");
  });

  it("leaves the board alone for a card that isn't a topic", () => {
    const b = board([card("x", { isActionItem: true })]);
    expect(withTopicStarted(b, "x", 60)).toBe(b);
    expect(withTopicStarted(b, "nope", 60)).toBe(b);
    expect(withTopicDone(b, "nope")).toBe(b);
  });
});

describe("the thumbs", () => {
  it("keep going on more ups, move on on more downs, else the facilitator decides", () => {
    expect(thumbsDecision({ keep: 3, move: 1 })).toBe("keep");
    expect(thumbsDecision({ keep: 1, move: 4 })).toBe("move");
    expect(thumbsDecision({ keep: 2, move: 2 })).toBe("tie");
    expect(thumbsDecision({ keep: 0, move: 0 })).toBe("none");
  });

  it("read a timebox only from its choices", () => {
    expect(minutesIn(10, [5, 7, 10], 7)).toBe(10);
    expect(minutesIn(9, [5, 7, 10], 7)).toBe(7);
    expect(minutesIn("10", [5, 7, 10], 7)).toBe(7);
  });
});

describe("merging topics", () => {
  it("puts the others under the most-voted one, their own groups too", () => {
    const b = board(
      [
        card("a", { votes: 1 }),
        card("b", { votes: 4 }),
        card("c", { votes: 2 }),
        card("ga", { groupedWith: "a" }),
      ],
      { phase: "vote" }
    );
    const merged = withTopicsMerged(b, ["a", "b"]);
    expect(merged.cards.map((c) => [c.id, c.groupedWith])).toEqual([
      ["a", "b"],
      ["b", null],
      ["c", null],
      ["ga", "b"],
    ]);
    expect(leanTopics(merged.cards).find((t) => t.id === "b")?.votes).toBe(5);
  });

  it("needs two topics", () => {
    const b = board([card("a"), card("b")]);
    expect(withTopicsMerged(b, ["a"])).toBe(b);
    expect(withTopicsMerged(b, ["a", "gone"])).toBe(b);
  });
});
