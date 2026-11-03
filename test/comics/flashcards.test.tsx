/**
 * /comics/flashcards: every story as a card, the book's 26 first, turned and
 * moved with buttons, and out of search.
 */

import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { StudyCard } from "@/lib/comics/types";

const h = vi.hoisted(() => ({ weekly: [] as StudyCard[] }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/comics/store", () => ({ listStudyCards: async () => h.weekly }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ title, children }: { title: string; children: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));

import FlashcardsPage, { metadata, revalidate } from "@/app/(tools)/comics/flashcards/page";
import { BOOK_EPISODES } from "@/lib/comics/book-episodes";

const WEEKLY: StudyCard = {
  ep: 27,
  title: "The Unread Handover",
  lesson: "Hand work over in words the next person can act on.",
  question: "What would the next person need to know?",
};

const deck = () => screen.getByRole("region", { name: "Flashcards" });

beforeEach(() => {
  h.weekly = [WEEKLY];
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the flashcards", () => {
  it("start on the book's first episode, its title only", async () => {
    render(await FlashcardsPage());
    expect(within(deck()).getByText("Card 1 of 27 · Episode 1")).toBeTruthy();
    expect(within(deck()).getByRole("heading", { name: BOOK_EPISODES[0].title })).toBeTruthy();
    expect(within(deck()).queryByText(BOOK_EPISODES[0].lesson)).toBeNull();
  });

  it("turn over to the lesson and the question, and back", async () => {
    render(await FlashcardsPage());
    fireEvent.click(within(deck()).getByRole("button", { name: "Show the lesson" }));
    expect(within(deck()).getByText(BOOK_EPISODES[0].lesson)).toBeTruthy();
    expect(within(deck()).getByText(BOOK_EPISODES[0].question)).toBeTruthy();
    fireEvent.click(within(deck()).getByRole("button", { name: "Back to the title" }));
    expect(within(deck()).queryByText(BOOK_EPISODES[0].lesson)).toBeNull();
  });

  it("move card by card, each starting on its title, with the weekly stories after the book", async () => {
    render(await FlashcardsPage());
    const previous = within(deck()).getByRole("button", { name: "Previous" });
    expect(previous).toBeDisabled();
    fireEvent.click(within(deck()).getByRole("button", { name: "Show the lesson" }));
    for (let i = 0; i < 26; i++) {
      fireEvent.click(within(deck()).getByRole("button", { name: /^Next/ }));
    }
    expect(within(deck()).getByRole("heading", { name: WEEKLY.title })).toBeTruthy();
    expect(within(deck()).queryByText(WEEKLY.lesson)).toBeNull();
    expect(within(deck()).getByRole("button", { name: /^Next/ })).toBeDisabled();
    // Next is disabled on the last card, so focus goes to Previous.
    expect(document.activeElement).toBe(within(deck()).getByRole("button", { name: "Previous" }));
  });

  it("shuffle into a new order, from the first card", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    render(await FlashcardsPage());
    fireEvent.click(within(deck()).getByRole("button", { name: /^Next/ }));
    fireEvent.click(within(deck()).getByRole("button", { name: "Shuffle" }));
    expect(within(deck()).getByText(/^Card 1 of 27/)).toBeTruthy();
    expect(within(deck()).queryByRole("heading", { name: BOOK_EPISODES[0].title })).toBeNull();
  });

  it("show the book's 26 before any weekly story is out", async () => {
    h.weekly = [];
    render(await FlashcardsPage());
    expect(within(deck()).getByText("Card 1 of 26 · Episode 1")).toBeTruthy();
  });

  it("stay out of search, and refresh like the gallery", () => {
    expect(metadata.robots).toEqual({ index: false, follow: true });
    expect(metadata.alternates?.canonical).toBe("/comics/flashcards");
    expect(revalidate).toBe(600);
  });
});
