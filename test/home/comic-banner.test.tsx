/**
 * The comic's card on the home page: this week's story once one is out, the
 * book before that, and never a broken home page when the stories can't be read.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { StorySummary } from "@/lib/comics/types";

const h = vi.hoisted(() => ({
  list: (async () => []) as (limit?: number) => Promise<StorySummary[]>,
  limits: [] as (number | undefined)[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/comics/store", () => ({
  listReleasedWeekly: (limit?: number) => {
    h.limits.push(limit);
    return h.list(limit);
  },
}));
vi.mock("@/components/home/home-page", () => ({
  HomePage: ({ comicBanner }: { comicBanner: React.ReactNode }) => <main>{comicBanner}</main>,
}));

import Home, { revalidate } from "@/app/page";
import { ComicBanner } from "@/components/home/comic-banner";
import { COVER_SMALL_URL } from "@/lib/book/art";
import { BOOK } from "@/lib/book/book";

const STORY: StorySummary = {
  ep: 30,
  title: "The Unread Handover",
  lesson: "Hand work over in words the next person can act on.",
  castNames: ["Amr"],
  themes: ["T01"],
  cover: { pathSmall: "stories/30/one-768.webp", width: 1536, height: 1024 },
  releaseAt: "2026-11-02T07:00:00.000Z",
  updatedAt: "2026-11-02T07:00:00.000Z",
};

afterEach(() => {
  cleanup();
  h.list = async () => [];
  h.limits = [];
  vi.unstubAllEnvs();
});

function card() {
  return screen.getByRole("region", { name: /./ });
}

describe("the home page's comic card", () => {
  it("leads with this week's story, and its first panel", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
    render(<ComicBanner latest={STORY} />);
    const region = screen.getByRole("region", { name: STORY.title });
    expect(within(region).getByText("Agile at Work, this week's story")).toBeTruthy();
    expect(within(region).getByText(STORY.lesson)).toBeTruthy();
    expect(within(region).getByRole("link", { name: "Read the story" })).toHaveAttribute(
      "href",
      "/comics?ep=30"
    );
    expect(within(region).getByRole("link", { name: "About the book" })).toHaveAttribute(
      "href",
      "/book"
    );
    const img = region.querySelector("img")!;
    expect(img.getAttribute("src")).toContain("stories/30/one-768.webp");
    expect(img).toHaveAttribute("loading", "lazy");
  });

  it("shows the book before any story is out", () => {
    render(<ComicBanner latest={null} />);
    const region = screen.getByRole("region", { name: "Agile at Work" });
    expect(within(region).getByText(BOOK.blurb[0])).toBeTruthy();
    const links = within(region).getAllByRole("link");
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["About the book", "/book"],
      ["Read the comics", "/comics"],
    ]);
    const cover = region.querySelector("img")!;
    expect(cover).toHaveAttribute("src", COVER_SMALL_URL);
    expect(cover).toHaveAttribute("alt", "");
    expect(cover).toHaveAttribute("loading", "lazy");
  });

  it("asks the store for the newest story only, and refreshes like /comics", async () => {
    h.list = async () => [STORY];
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
    render(await Home());
    expect(h.limits).toEqual([1]);
    expect(card()).toHaveAccessibleName(STORY.title);
    expect(revalidate).toBe(600);
  });

  it("shows the book, not an error, when the stories can't be read", async () => {
    h.list = async () => {
      throw new Error("comics: read failed");
    };
    render(await Home());
    expect(card()).toHaveAccessibleName("Agile at Work");
  });
});
