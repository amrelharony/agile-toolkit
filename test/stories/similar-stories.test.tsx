import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

/**
 * <SimilarStories> with Amr's answer: the picks replace the list, marked
 * "Picked by Amr"; a pick that names a story that wasn't offered, or one
 * twice, is dropped; the points shown are the store's, not the answer's;
 * the request carries only ids, titles and points; and picks made for one
 * story never show for the next. Without AI the picks are the panel's own
 * word match (notes included), so they never contradict the list.
 */

type Answer = { matches: { id: string; why: string }[] };

const h = vi.hoisted(() => ({
  input: null as unknown,
  // A canned answer, or one worked out from the request (the task's fallback).
  answer: null as null | Answer | ((input: never) => Answer),
  source: "ai" as "ai" | "fallback",
}));

// Ask Amr stands in for the kit's button: it hands back the canned answer.
vi.mock("@/components/ai", () => ({
  AiButton: ({
    input,
    onResult,
  }: {
    input: unknown;
    onResult: (data: unknown, meta: { source: string }) => void;
  }) => (
    <button
      type="button"
      onClick={() => {
        h.input = input;
        const answer = typeof h.answer === "function" ? h.answer(input as never) : h.answer;
        onResult(answer, { source: h.source });
      }}
    >
      Ask Amr
    </button>
  ),
}));

import { SimilarStories } from "@/components/stories/similar-stories";
import { pokerSimilarFallback, type PokerSimilarInput } from "@/lib/ai/tasks/planning-poker.lite";
import type { Story } from "@/lib/stores/workspace-types";

const done = (id: string, title: string, points: number, notes?: string): Story => ({
  id,
  title,
  points,
  status: "done",
  ...(notes ? { notes } : {}),
});

const STORIES: Story[] = [
  done("s1", "Card refunds for marketplace orders", 5, "Private notes about refunds"),
  done("s2", "Refund a voucher payment", 3),
  done("s3", "Export the monthly sales report", 2),
];

const panel = () => screen.getByRole("region", { name: "Like this one" });
const items = () =>
  within(panel())
    .getAllByRole("listitem")
    .map((li) => li.textContent);

beforeEach(() => {
  h.input = null;
  h.source = "ai";
  h.answer = {
    matches: [
      { id: "s3", why: "Both touch money reports" },
      { id: "nope", why: "Not offered" },
      { id: "s3", why: "Twice" },
      { id: "s1", why: "Refunds again" },
    ],
  };
});

describe("Amr's picks", () => {
  it("replace the list, offered stories only, once each, in the answer's order", () => {
    render(
      <SimilarStories target={{ title: "Refund a card payment" }} source={{ stories: STORIES }} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Ask Amr" }));
    expect(panel()).toHaveTextContent("Picked by Amr.");
    expect(items()).toEqual([
      "Export the monthly sales report · 2 ptsBoth touch money reports",
      "Card refunds for marketplace orders · 5 ptsRefunds again",
    ]);
  });

  it("sends only ids, titles and points, never another story's notes", () => {
    render(
      <SimilarStories
        target={{ title: "Refund a card payment", notes: "From the order page" }}
        source={{ stories: STORIES }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Ask Amr" }));
    const input = h.input as {
      story: unknown;
      candidates: { id: string; title: string; points: number }[];
    };
    expect(input.story).toEqual({ title: "Refund a card payment", notes: "From the order page" });
    expect(input.candidates.map((c) => c.id).sort()).toEqual(["s1", "s2", "s3"]);
    expect(input.candidates.find((c) => c.id === "s1")).toEqual({
      id: "s1",
      title: "Card refunds for marketplace orders",
      points: 5,
    });
    for (const c of input.candidates)
      expect(Object.keys(c).sort()).toEqual(["id", "points", "title"]);
    expect(JSON.stringify(h.input)).not.toContain("Private notes");
  });

  it("shows the points the store holds now", () => {
    const { rerender } = render(
      <SimilarStories target={{ title: "Refund a card payment" }} source={{ stories: STORIES }} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Ask Amr" }));
    const resized = STORIES.map((s) => (s.id === "s1" ? { ...s, points: 8 } : s));
    act(() => {
      rerender(
        <SimilarStories target={{ title: "Refund a card payment" }} source={{ stories: resized }} />
      );
    });
    expect(items()[1]).toBe("Card refunds for marketplace orders · 8 ptsRefunds again");
  });

  it("are dropped when the story changes", () => {
    const { rerender } = render(
      <SimilarStories target={{ title: "Refund a card payment" }} source={{ stories: STORIES }} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Ask Amr" }));
    expect(panel()).toHaveTextContent("Picked by Amr.");
    rerender(
      <SimilarStories target={{ title: "Refund a voucher" }} source={{ stories: STORIES }} />
    );
    expect(panel()).not.toHaveTextContent("Picked by Amr.");
    expect(items()[0]).toMatch(/^Refund a voucher payment · 3 ptsBoth mention/);
  });

  it("say so when Amr found nothing alike", () => {
    h.answer = { matches: [] };
    render(
      <SimilarStories target={{ title: "Refund a card payment" }} source={{ stories: STORIES }} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Ask Amr" }));
    expect(panel()).toHaveTextContent("Picked by Amr.No finished story is like this one.");
  });

  it("keep focus in the panel when the word match comes back", () => {
    render(
      <SimilarStories target={{ title: "Refund a card payment" }} source={{ stories: STORIES }} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Ask Amr" }));
    const back = within(panel()).getByRole("button", { name: "Show the word match again" });
    back.focus();
    fireEvent.click(back);
    // The button is gone; focus is on the panel's label, not the page.
    expect(within(panel()).queryByRole("button", { name: "Show the word match again" })).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    expect(panel()).toContainElement(document.activeElement as HTMLElement);
    expect(document.activeElement).toHaveTextContent("Like this one");
  });

  it("leave out the target itself, when it is a workspace story", () => {
    render(
      <SimilarStories
        target={{ id: "s2", title: "Refund a voucher payment" }}
        source={{ stories: STORIES }}
      />
    );
    const shown = within(panel())
      .queryAllByRole("listitem")
      .map((li) => li.textContent ?? "");
    expect(shown.some((t) => t.startsWith("Refund a voucher payment"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Ask Amr" }));
    const input = h.input as { candidates: { id: string }[] };
    expect(input.candidates.map((c) => c.id)).not.toContain("s2");
  });
});

describe("without AI", () => {
  // Alike only through its notes: the request carries no notes of other
  // stories, so the task's own fallback can't see the match.
  const NOTES_MATCH: Story[] = [
    done("f1", "Card fees report", 5, "refund payment order"),
    done("f2", "Export the monthly sales report", 2),
  ];
  const target = { title: "Refund the card payment order" };

  it("finds what the word match shows, notes included", () => {
    h.source = "fallback";
    h.answer = (input: PokerSimilarInput) => pokerSimilarFallback(input);
    render(<SimilarStories target={target} source={{ stories: NOTES_MATCH }} />);
    expect(items()).toEqual(["Card fees report · 5 ptsBoth mention: card, order, payment"]);
    fireEvent.click(screen.getByRole("button", { name: "Ask Amr" }));
    // The titles-only fallback found nothing...
    expect(pokerSimilarFallback(h.input as PokerSimilarInput).matches).toEqual([]);
    // ...but the panel answers with its own word match, so it agrees with the list.
    expect(panel()).toHaveTextContent("Found without AI, by shared words.");
    expect(panel()).not.toHaveTextContent("No finished story is like this one.");
    expect(items()).toEqual(["Card fees report · 5 ptsShares: card, order, payment"]);
  });

  it("says nothing is alike when the word match has nothing either", () => {
    h.source = "fallback";
    h.answer = { matches: [{ id: "f2", why: "Shares: report" }] };
    render(
      <SimilarStories target={{ title: "Dark mode toggle" }} source={{ stories: NOTES_MATCH }} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Ask Amr" }));
    expect(panel()).toHaveTextContent(
      "Found without AI, by shared words.No finished story is like this one."
    );
  });
});
