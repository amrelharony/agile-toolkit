// @vitest-environment node
/**
 * "Like this one": finished stories scored by shared words (title words
 * weigh 2, the start of the notes 1, at least one title word in common),
 * best first then most recently done; the guide's reference stories when
 * none reads alike; and the candidates Amr gets to choose from.
 */

import { describe, expect, it } from "vitest";
import {
  REFERENCE_HINT_MAX,
  SIMILAR_NOTES_READ,
  aiCandidates,
  medianPoints,
  rankSimilar,
  referenceHintItems,
  similarHint,
  similarPool,
  similarStories,
  type ReferencePins,
} from "@/lib/estimation/similar";
import type { Story } from "@/lib/stores/workspace-types";

const done = (
  id: string,
  title: string,
  points: number | undefined,
  extra: Partial<Story> = {}
): Story => ({ id, title, points, status: "done", ...extra });

const STORIES: Story[] = [
  done("s1", "Card refunds for marketplace orders", 5, { doneAt: "2026-10-01T10:00:00Z" }),
  done("s2", "Export the monthly sales report", 3, { doneAt: "2026-10-05T10:00:00Z" }),
  done("s3", "Refund a voucher payment", 3, { doneAt: "2026-10-20T10:00:00Z" }),
  done("s4", "Reset a password by email", 2),
];

const TARGET = { title: "Refund a card payment from the order page" };

describe("the pool", () => {
  it("takes done stories with points and a title, never the example's or the target", () => {
    const pool = similarPool({ id: "s9", title: "x" }, [
      ...STORIES,
      done("s5", "Refund flow", 0),
      done("s6", "Refund flow", undefined),
      done("s7", "  ", 3),
      done("example-1", "Refund flow", 3),
      { id: "s8", title: "Refund flow", points: 3, status: "in_progress" },
      done("s9", "Refund flow", 3),
    ]);
    expect(pool.map((s) => s.id)).toEqual(["s1", "s2", "s3", "s4"]);
  });
});

describe("similarStories", () => {
  it("finds stories that share title words, best first, with what both mention", () => {
    const matches = similarStories(TARGET, STORIES);
    expect(matches.map((m) => m.story.id)).toEqual(["s1", "s3"]);
    // "refunds" and "refund", "orders" and "order" stem alike; "from" and
    // "the" don't count.
    expect(matches[0].shared).toEqual(["card", "order", "refund"]);
    expect(matches[0].score).toBeCloseTo(0.5);
    expect(matches[1].shared).toEqual(["payment", "refund"]);
    expect(matches[1].score).toBeCloseTo(1 / 3);
  });

  it("orders equal scores by the most recently done", () => {
    const twins = [
      done("old", "Refund export", 3, { doneAt: "2026-01-01T00:00:00Z" }),
      done("new", "Refund export", 5, { doneAt: "2026-09-01T00:00:00Z" }),
    ];
    expect(similarStories({ title: "Refund export" }, twins).map((m) => m.story.id)).toEqual([
      "new",
      "old",
    ]);
  });

  it("needs a shared title word: notes alone are too loose", () => {
    const stories = [done("n1", "Billing screen", 3, { notes: "refund card payment" })];
    expect(similarStories(TARGET, stories)).toEqual([]);
  });

  it("reads the start of the notes, weighing them under the title", () => {
    const withNotes = { title: "Refund screen", notes: "Card payments only." };
    const a = done("a", "Refund screen for cards", 3);
    const b = done("b", "Refund screen", 5);
    // "cards" in a's title meets "Card" in the notes: a little closer than b.
    const ranked = rankSimilar(withNotes, [b, a]);
    expect(ranked.map((r) => r.item.id)).toEqual(["a", "b"]);
    expect(ranked[0].score).toBeCloseTo(5 / 7);
    expect(ranked[1].score).toBeCloseTo(4 / 6);
    expect(ranked[0].shared).toEqual(["refund", "screen", "card"]);
    // Past the first 300 characters, nothing is read.
    const late = { title: "Refund screen", notes: `${"x ".repeat(SIMILAR_NOTES_READ)} card` };
    expect(rankSimilar(late, [a])[0].shared).toEqual(["refund", "screen"]);
  });

  it("keeps to the limit and the minimum score, and asks nothing of an empty title", () => {
    expect(similarStories(TARGET, STORIES, { limit: 1 })).toHaveLength(1);
    expect(similarStories(TARGET, STORIES, { minScore: 0.99 })).toEqual([]);
    expect(similarStories({ title: "  " }, STORIES)).toEqual([]);
  });
});

describe("medianPoints", () => {
  it("takes the middle, or the mean of the two middles", () => {
    expect(medianPoints([5])).toBe(5);
    expect(medianPoints([3, 8, 5])).toBe(5);
    expect(medianPoints([3, 5])).toBe(4);
    expect(medianPoints([])).toBeNull();
  });
});

const PINS: ReferencePins = {
  cards: ["1", "3", "5"],
  lookup: (card) =>
    card === "3"
      ? { stories: [{ title: "Login page" }, { title: "Contact form", example: true }] }
      : card === "5"
        ? { stories: [{ title: "Checkout" }] }
        : null,
};

describe("similarHint", () => {
  it("shows the matches with their median when something reads alike", () => {
    const hint = similarHint(TARGET, STORIES, PINS);
    expect(hint.kind).toBe("similar");
    if (hint.kind === "similar") expect(hint.medianPoints).toBe(4);
  });

  it("falls back to the guide's reference stories, in deck order", () => {
    const hint = similarHint({ title: "Dark mode toggle" }, STORIES, PINS);
    expect(hint).toEqual({
      kind: "reference",
      items: [
        { card: "3", title: "Login page", example: false },
        { card: "3", title: "Contact form", example: true },
        { card: "5", title: "Checkout", example: false },
      ],
    });
  });

  it("has nothing to show with no match and no pins", () => {
    expect(similarHint({ title: "Dark mode toggle" }, STORIES)).toEqual({ kind: "none" });
    expect(
      similarHint({ title: "Dark mode toggle" }, [], { cards: [], lookup: () => null })
    ).toEqual({ kind: "none" });
  });

  it("shows a few reference stories at most", () => {
    const many: ReferencePins = {
      cards: ["1", "2"],
      lookup: () => ({ stories: Array.from({ length: 5 }, (_, i) => ({ title: `Story ${i}` })) }),
    };
    expect(referenceHintItems(many)).toHaveLength(REFERENCE_HINT_MAX);
  });
});

describe("aiCandidates", () => {
  it("puts the best scores first, then the most recently done", () => {
    expect(aiCandidates(TARGET, STORIES).map((s) => s.id)).toEqual(["s1", "s3", "s2", "s4"]);
  });

  it("keeps to the cap, and leaves out what the pool leaves out", () => {
    const many = Array.from({ length: 60 }, (_, i) => done(`m${i}`, `Story ${i}`, 3));
    expect(aiCandidates(TARGET, many)).toHaveLength(40);
    expect(aiCandidates(TARGET, many, 5)).toHaveLength(5);
    expect(aiCandidates(TARGET, [done("example-1", "Refund card", 3)])).toEqual([]);
  });
});
