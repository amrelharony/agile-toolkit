import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import ComicsPage, { generateMetadata } from "@/app/(tools)/comics/page";
import { BOOK_EPISODES, bookEpisodeFor } from "@/lib/comics/book-episodes";

/**
 * The building posters are printed, so these links can't change: 26 episodes
 * in 10 buildings, both numbers padded to two digits. Read from the QR links
 * in Agile_At_Work_Building_NN_Revised_26_Posters_A2.pdf.
 */
const pad = (n: number) => String(n).padStart(2, "0");
const PRINTED_LINKS = Array.from({ length: 26 }, (_, e) =>
  Array.from({ length: 10 }, (_, b) => ({
    ep: e + 1,
    href: `https://agile.amrelharony.com/comics?ep=${pad(e + 1)}&b=${pad(b + 1)}`,
  }))
).flat();

describe("the printed poster links", () => {
  it("covers every poster", () => {
    expect(new Set(PRINTED_LINKS.map((l) => l.href)).size).toBe(260);
  });

  it("each opens its own episode", () => {
    for (const { ep, href } of PRINTED_LINKS) {
      const url = new URL(href);
      expect(url.pathname).toBe("/comics");
      expect(bookEpisodeFor(url.searchParams.get("ep") ?? undefined)?.ep, href).toBe(ep);
    }
  });

  it("carries a lesson, a question and a book page for all 26", () => {
    expect(BOOK_EPISODES.map((e) => e.ep)).toEqual(Array.from({ length: 26 }, (_, i) => i + 1));
    for (const e of BOOK_EPISODES) {
      expect(e.title && e.lesson && e.question, `episode ${e.ep}`).toBeTruthy();
      expect(e.bookPage).toBeGreaterThan(0);
    }
  });

  it.each([
    ["no number", undefined],
    ["empty", ""],
    ["zero", "0"],
    ["past the book", "27"],
    ["not a number", "abc"],
    ["a sign", "-1"],
    ["a decimal", "1.5"],
    ["too long", "012"],
    ["repeated", ["01", "02"]],
  ])("treats %s as no episode", (_label, value) => {
    expect(bookEpisodeFor(value)).toBeNull();
  });

  it("accepts an unpadded number", () => {
    expect(bookEpisodeFor("7")?.ep).toBe(7);
  });
});

describe("/comics", () => {
  it("shows what the poster promises for a scanned episode", () => {
    render(<ComicsPage searchParams={{ ep: "12" }} />);
    expect(screen.getByRole("heading", { level: 1, name: "But You Were Closed!" })).toBeTruthy();
    expect(
      screen.getByText("Before speaking for everyone, check whose voices you have not heard.")
    ).toBeTruthy();
    expect(screen.getByText("Book page 73")).toBeTruthy();
    expect(screen.getByText("Borrow the book from your Scrum Master.")).toBeTruthy();
  });

  it("shows the section page for the plain address and for a bad number", () => {
    for (const searchParams of [{}, { ep: "99" }]) {
      const { unmount } = render(<ComicsPage searchParams={searchParams} />);
      expect(screen.getByRole("heading", { level: 1, name: "Agile at Work" })).toBeTruthy();
      expect(screen.getByText("The comics are coming soon")).toBeTruthy();
      unmount();
    }
  });

  it("keeps book episodes out of search, but not the section", () => {
    expect(generateMetadata({ searchParams: { ep: "12" } }).robots).toEqual({
      index: false,
      follow: true,
    });
    expect(generateMetadata({ searchParams: {} }).robots).toBeUndefined();
  });

  it("points every variant at one canonical address", () => {
    for (const searchParams of [{}, { ep: "12" }, { ep: "nope" }]) {
      expect(generateMetadata({ searchParams }).alternates?.canonical).toBe("/comics");
    }
  });
});
