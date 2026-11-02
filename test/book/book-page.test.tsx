/**
 * /book: the printed book in its own words, its contents, and what search
 * engines and link previews are told about it.
 */

import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({
    title,
    description,
    children,
  }: {
    title: string;
    description: string;
    children: ReactNode;
  }) => (
    <div>
      <h1>{title}</h1>
      <p>{description}</p>
      {children}
    </div>
  ),
}));

import BookPage, { metadata } from "@/app/(tools)/book/page";
import sitemap from "@/app/sitemap";
import { BOOK_SHARE_URL, COVER_SMALL_URL, COVER_URL } from "@/lib/book/art";
import { BOOK } from "@/lib/book/book";
import { BOOK_EPISODES } from "@/lib/comics/book-episodes";

afterEach(cleanup);

describe("/book", () => {
  it("says what the cover says", () => {
    render(<BookPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Agile at Work" })).toBeTruthy();
    expect(
      screen.getByText("26 Stories About Working Better Together, by Amr Elharony")
    ).toBeTruthy();
    expect(screen.getByText("Volume 1")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Every team has its characters." })).toBeTruthy();
    for (const paragraph of BOOK.blurb) expect(screen.getByText(paragraph)).toBeTruthy();
    expect(screen.getByText(BOOK.authorBio)).toBeTruthy();
    expect(screen.getByText("ISBN 978-977-95-9064-6")).toBeTruthy();
  });

  it("shows the front cover first, at the size the screen needs", () => {
    render(<BookPage />);
    const cover = screen.getByRole("img", { name: /^The front cover/ });
    expect(cover).toHaveAttribute("src", COVER_URL);
    expect(cover.getAttribute("srcset")).toContain(`${COVER_SMALL_URL} 540w`);
    expect(cover).toHaveAttribute("fetchpriority", "high");
    expect(cover).not.toHaveAttribute("loading", "lazy");
  });

  it("lists all 26 episodes with the page each starts on, and links to none", () => {
    render(<BookPage />);
    const contents = screen.getByRole("list");
    const items = within(contents).getAllByRole("listitem");
    expect(items).toHaveLength(26);
    BOOK_EPISODES.forEach((episode, i) => {
      expect(items[i].textContent).toBe(`${episode.ep}${episode.title}page ${episode.bookPage}`);
    });
    expect(within(contents).queryAllByRole("link")).toEqual([]);
  });

  it("sends readers on to the comics", () => {
    render(<BookPage />);
    expect(screen.getByRole("link", { name: "Read the comics" })).toHaveAttribute(
      "href",
      "/comics"
    );
  });

  it("describes the book for search engines", () => {
    const { container } = render(<BookPage />);
    const script = container.querySelector('script[type="application/ld+json"]')!;
    const data = JSON.parse(script.textContent!);
    expect(data).toMatchObject({
      "@type": "Book",
      name: "Agile at Work",
      isbn: "9789779590646",
      url: "https://agile.amrelharony.com/book",
      author: { "@type": "Person", name: "Amr Elharony" },
      image: { contentUrl: `https://agile.amrelharony.com${COVER_URL}` },
    });
  });

  it("has its own address, share image and no-AI tag", () => {
    expect(metadata.alternates?.canonical).toBe("/book");
    expect(metadata.openGraph?.images).toEqual([`https://agile.amrelharony.com${BOOK_SHARE_URL}`]);
    expect(metadata.other).toEqual({ robots: "noai, noimageai" });
    expect(metadata.robots).toBeUndefined();
  });

  it("is in the sitemap", () => {
    expect(sitemap().map((entry) => entry.url)).toContain("https://agile.amrelharony.com/book");
  });
});
