// @vitest-environment node
import { describe, expect, it } from "vitest";
import { asyncRoundMarkdown } from "@/app/(tools)/planning-poker/async/markdown";
import type { PokerAsyncRound } from "@/lib/stores/workspace-types";

/**
 * A round without a meeting as Markdown: blind before Reveal (who replied
 * and how many cards, never which), the cards and notes after it, and no
 * names once the round is closed.
 */

const FIB = ["1", "2", "3", "5", "8", "13", "21", "?", "∞"];

function round(over: Partial<PokerAsyncRound> = {}): PokerAsyncRound {
  return {
    id: "async_round000001",
    title: "Checkout stories",
    scaleType: "fibonacci",
    deck: [...FIB],
    stories: [
      { id: "s1", title: "Pay by phone" },
      { id: "s2", title: "Refund a payment" },
    ],
    replies: [],
    status: "open",
    createdAt: "2026-11-20T10:00:00.000Z",
    updatedAt: "2026-11-20T10:00:00.000Z",
    ...over,
  };
}

const lee = { id: "a", name: "Lee", votes: [{ storyId: "s1", card: "5" }], at: "x" };

describe("asyncRoundMarkdown", () => {
  it("counts one card as one card, and more as cards", () => {
    const one = asyncRoundMarkdown(round({ replies: [lee] }));
    expect(one).toContain("1 card in, hidden until the round is revealed.");
    expect(one).toContain("1 reply.");
    expect(one).not.toContain("1 cards");

    const two = asyncRoundMarkdown(
      round({
        replies: [
          {
            ...lee,
            votes: [
              { storyId: "s1", card: "5" },
              { storyId: "s2", card: "8" },
            ],
          },
        ],
      })
    );
    expect(two).toContain("2 cards in, hidden until the round is revealed.");
    expect(asyncRoundMarkdown(round())).toContain("0 cards in");
  });

  it("is blind before Reveal: who replied, never a card", () => {
    const md = asyncRoundMarkdown(round({ replies: [lee] }));
    expect(md).toContain("Replied: Lee.");
    expect(md).not.toMatch(/Lee 5|Cards:/);
  });
});
