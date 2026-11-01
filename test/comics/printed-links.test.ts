// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { BOOK_EPISODES, bookEpisode } from "@/lib/comics/book-episodes";
import { comicRewritePath, isBookEp, parseBuilding, parseEp } from "@/lib/comics/entry";

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => {
    throw new Error("a printed link must not build a Supabase client");
  },
}));

import { middleware } from "@/middleware";

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

async function rewriteOf(href: string): Promise<URL | null> {
  const res = await middleware(new NextRequest(href));
  const target = res.headers.get("x-middleware-rewrite");
  return target ? new URL(target) : null;
}

describe("the printed poster links", () => {
  it("covers every poster", () => {
    expect(new Set(PRINTED_LINKS.map((l) => l.href)).size).toBe(260);
  });

  it("rewrites all 260 to their own episode's poster page, keeping the query", async () => {
    for (const { ep, href } of PRINTED_LINKS) {
      const target = await rewriteOf(href);
      expect(target?.pathname, href).toBe(`/comics/poster/${ep}`);
      expect(target?.search, href).toBe(new URL(href).search);
    }
  });

  it("carries a lesson, a question and a book page for all 26", () => {
    expect(BOOK_EPISODES.map((e) => e.ep)).toEqual(Array.from({ length: 26 }, (_, i) => i + 1));
    for (const e of BOOK_EPISODES) {
      expect(e.title && e.lesson && e.question, `episode ${e.ep}`).toBeTruthy();
      expect(e.bookPage).toBeGreaterThan(0);
      expect(bookEpisode(e.ep)).toBe(e);
    }
    expect(bookEpisode(27)).toBeNull();
  });
});

describe("/comics addresses", () => {
  const BASE = "https://agile.amrelharony.com/comics";

  it.each([
    ["a book episode with no building", "?ep=12", "/comics/ep/12"],
    ["an unpadded book episode", "?ep=7", "/comics/ep/7"],
    ["the first weekly story", "?ep=27", "/comics/ep/27"],
    ["a three-digit weekly story", "?ep=126", "/comics/ep/126"],
    ["a weekly story with a building", "?ep=27&b=01", "/comics/ep/27"],
    ["a book episode with a bad building", "?ep=12&b=11", "/comics/ep/12"],
    ["a book episode with a repeated building", "?ep=12&b=01&b=02", "/comics/ep/12"],
    ["a poster with extra query", "?ep=12&b=01&utm_source=qr", "/comics/poster/12"],
  ])("%s goes to its static page", async (_label, query, pathname) => {
    expect((await rewriteOf(`${BASE}${query}`))?.pathname).toBe(pathname);
  });

  it.each([
    ["no number", ""],
    ["empty", "?ep="],
    ["zero", "?ep=0"],
    ["padded zero", "?ep=00"],
    ["not a number", "?ep=abc"],
    ["a sign", "?ep=-1"],
    ["a plus sign", "?ep=%2B1"],
    ["a decimal", "?ep=1.5"],
    ["too long", "?ep=012"],
    ["past the range", "?ep=1000"],
    ["repeated", "?ep=01&ep=02"],
    ["space padded", "?ep=%2001"],
    ["a building alone", "?b=01"],
  ])("%s stays the normal /comics page", async (_label, query) => {
    expect(await rewriteOf(`${BASE}${query}`)).toBeNull();
  });
});

describe("parsers", () => {
  it("parseEp reads the book and weekly ranges", () => {
    expect(parseEp("01")).toBe(1);
    expect(parseEp("26")).toBe(26);
    expect(parseEp("27")).toBe(27);
    expect(parseEp("999")).toBe(999);
    expect(parseEp(["07"])).toBe(7);
    expect(isBookEp(26)).toBe(true);
    expect(isBookEp(27)).toBe(false);
  });

  it.each([[null], [undefined], [""], ["0"], ["1e1"], ["0x10"], ["1 "], ["٣"], [["1", "2"]], [[]]])(
    "parseEp refuses %j",
    (raw) => {
      expect(parseEp(raw)).toBeNull();
    }
  );

  it("parseBuilding reads 1 to 10, padded or not", () => {
    for (let b = 1; b <= 10; b++) {
      expect(parseBuilding(String(b))).toBe(b);
      expect(parseBuilding(pad(b))).toBe(b);
    }
  });

  it.each([[null], [""], ["0"], ["00"], ["11"], ["-1"], ["1.0"], ["010"], [["01", "02"]]])(
    "parseBuilding refuses %j",
    (raw) => {
      expect(parseBuilding(raw)).toBeNull();
    }
  );

  it("comicRewritePath needs a valid ep before anything else counts", () => {
    expect(comicRewritePath(new URLSearchParams("b=01"))).toBeNull();
    expect(comicRewritePath(new URLSearchParams("ep=01&b=10"))).toBe("/comics/poster/1");
  });
});
