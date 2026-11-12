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
import { POSTER_ART } from "@/lib/comics/poster-panels.generated";

const STORAGE = "https://ref.supabase.co/storage/v1/object/public/comic-panels/";

const WEEKLY: StudyCard = {
  ep: 27,
  title: "The Unread Handover",
  lesson: "Hand work over in words the next person can act on.",
  question: "What would the next person need to know?",
};

const deck = () => screen.getByRole("region", { name: "Flashcards" });

beforeEach(() => {
  h.weekly = [WEEKLY];
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("the flashcards", () => {
  it("start on the book's first episode, its title only", async () => {
    render(await FlashcardsPage());
    expect(within(deck()).getByText("Card 1 of 27 · Episode 1")).toBeTruthy();
    expect(within(deck()).getByRole("heading", { name: BOOK_EPISODES[0].title })).toBeTruthy();
    expect(within(deck()).queryByText(BOOK_EPISODES[0].lesson)).toBeNull();
  });

  it("show the story's first panel, the poster's for the book, on both sides", async () => {
    render(await FlashcardsPage());
    const picture = () => within(deck()).getByRole("presentation");
    const first = `${STORAGE}${POSTER_ART[1].panels[0].small}`;
    expect(picture().getAttribute("src")).toBe(first);
    expect(picture().getAttribute("alt")).toBe("");
    expect(picture().getAttribute("loading")).toBe("eager");
    fireEvent.click(within(deck()).getByRole("button", { name: "Show the lesson" }));
    expect(picture().getAttribute("src")).toBe(first);
    fireEvent.click(within(deck()).getByRole("button", { name: /^Next/ }));
    expect(picture().getAttribute("src")).toBe(`${STORAGE}${POSTER_ART[2].panels[0].small}`);
  });

  it("give a weekly story its own cover, and a card with none shows words alone", async () => {
    h.weekly = [
      { ...WEEKLY, cover: { pathSmall: "w/27-768.webp", width: 1536, height: 1024 } },
      { ...WEEKLY, ep: 28, title: "No Art Yet", cover: null },
    ];
    render(await FlashcardsPage());
    for (let i = 0; i < 26; i++) {
      fireEvent.click(within(deck()).getByRole("button", { name: /^Next/ }));
    }
    expect(within(deck()).getByRole("presentation").getAttribute("src")).toBe(
      `${STORAGE}w/27-768.webp`
    );
    fireEvent.click(within(deck()).getByRole("button", { name: /^Next/ }));
    expect(within(deck()).getByRole("heading", { name: "No Art Yet" })).toBeTruthy();
    expect(within(deck()).queryByRole("presentation")).toBeNull();
  });

  it("show the book's cards as words alone where the art can't load", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    render(await FlashcardsPage());
    expect(within(deck()).getByRole("heading", { name: BOOK_EPISODES[0].title })).toBeTruthy();
    expect(within(deck()).queryByRole("presentation")).toBeNull();
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

  it("keep Previous and Next side by side on a phone, with a row each for the others", async () => {
    render(await FlashcardsPage());
    const previous = within(deck()).getByRole("button", { name: "Previous" });
    const next = within(deck()).getByRole("button", { name: /^Next/ });
    const row = previous.parentElement!.className.split(/\s+/);
    expect(row).toEqual(expect.arrayContaining(["grid", "grid-cols-2", "sm:flex", "sm:flex-wrap"]));
    expect(previous.nextElementSibling).toBe(next);
    expect(previous.className).not.toContain("col-span-2");
    expect(next.className).not.toContain("col-span-2");
    for (const name of ["Show the lesson", "Shuffle"]) {
      expect(within(deck()).getByRole("button", { name }).className.split(/\s+/)).toContain(
        "col-span-2"
      );
    }
  });

  it("move with a sideways swipe on the card, each starting on its title", async () => {
    render(await FlashcardsPage());
    const card = within(deck()).getByText("Card 1 of 27 · Episode 1").closest(".panel")!;
    const swipe = (dx: number) => {
      fireEvent.touchStart(card, { touches: [{ clientX: 200, clientY: 300 }] });
      fireEvent.touchEnd(card, {
        touches: [],
        changedTouches: [{ clientX: 200 + dx, clientY: 300 }],
      });
    };
    swipe(100);
    expect(within(deck()).getByText("Card 1 of 27 · Episode 1")).toBeTruthy();
    fireEvent.click(within(deck()).getByRole("button", { name: "Show the lesson" }));
    swipe(-100);
    expect(within(deck()).getByText("Card 2 of 27 · Episode 2")).toBeTruthy();
    expect(within(deck()).queryByText(BOOK_EPISODES[1].lesson)).toBeNull();
    swipe(-20);
    expect(within(deck()).getByText("Card 2 of 27 · Episode 2")).toBeTruthy();
    swipe(100);
    expect(within(deck()).getByText("Card 1 of 27 · Episode 1")).toBeTruthy();
  });

  it("hand focus on when a swipe disables the button that has it, and leave it be otherwise", async () => {
    h.weekly = [];
    render(await FlashcardsPage());
    const card = within(deck()).getByText("Card 1 of 26 · Episode 1").closest(".panel")!;
    const swipe = (dx: number) => {
      fireEvent.touchStart(card, { touches: [{ clientX: 200, clientY: 300 }] });
      fireEvent.touchEnd(card, {
        touches: [],
        changedTouches: [{ clientX: 200 + dx, clientY: 300 }],
      });
    };
    const previous = within(deck()).getByRole("button", { name: "Previous" });
    const next = within(deck()).getByRole("button", { name: /^Next/ });
    const shuffle = within(deck()).getByRole("button", { name: "Shuffle" });

    // A tapped Next keeps focus (Android): swiping to the last card disables it.
    for (let i = 0; i < 24; i++) fireEvent.click(next);
    next.focus();
    swipe(-100);
    expect(within(deck()).getByText("Card 26 of 26 · Episode 26")).toBeTruthy();
    expect(next).toBeDisabled();
    expect(document.activeElement).toBe(previous);

    // And back at the start, Previous hands it to Next.
    for (let i = 0; i < 24; i++) fireEvent.click(previous);
    previous.focus();
    swipe(100);
    expect(within(deck()).getByText("Card 1 of 26 · Episode 1")).toBeTruthy();
    expect(previous).toBeDisabled();
    expect(document.activeElement).toBe(next);

    // Focus anywhere else stays put.
    shuffle.focus();
    swipe(-100);
    expect(within(deck()).getByText("Card 2 of 26 · Episode 2")).toBeTruthy();
    expect(document.activeElement).toBe(shuffle);
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
    expect(revalidate).toBe(86400);
  });
});
