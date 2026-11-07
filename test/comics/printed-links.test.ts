// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { BOOK_EPISODES, bookEpisode } from "@/lib/comics/book-episodes";
import {
  PRINT_SOURCES,
  arrivalSource,
  comicRewritePath,
  isBookEp,
  parseEp,
  thankSomeoneHref,
} from "@/lib/comics/entry";
import { OPEN_THEME, PRINT_THEMES, printTheme } from "@/lib/comics/print-themes";
import campaign from "@/lib/comics/print-campaign.json";

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => {
    throw new Error("a printed link must not build a Supabase client");
  },
}));

import { middleware } from "@/middleware";

/**
 * Every QR code the print campaign prints, as the campaign's data file gives
 * them (lib/comics/print-campaign.json). They can never change, so neither can
 * where they go.
 */
const SITE = "https://agile.amrelharony.com";
const POSTERS = campaign.episodes.map((e) => ({ ep: Number(e.ep), href: e.qr_poster }));
const KUDOS_CARDS = campaign.episodes.map((e) => ({ ep: Number(e.ep), href: e.qr_kudos }));

async function run(href: string) {
  return middleware(new NextRequest(href));
}

async function rewriteOf(href: string): Promise<URL | null> {
  const target = (await run(href)).headers.get("x-middleware-rewrite");
  return target ? new URL(target) : null;
}

describe("the printed links", () => {
  it("are the ones the spec lists, 26 posters and 26 kudos cards among them", () => {
    expect(POSTERS).toHaveLength(26);
    expect(new Set(POSTERS.map((l) => l.href)).size).toBe(26);
    for (const { ep, href } of POSTERS) {
      expect(href).toBe(`${SITE}/comics?ep=${String(ep).padStart(2, "0")}&src=poster`);
    }
    for (const { ep, href } of KUDOS_CARDS) {
      expect(href).toBe(`${SITE}/comics?ep=${String(ep).padStart(2, "0")}&src=kudos`);
    }
    expect(campaign.book.qr_book).toBe(`${SITE}/comics?src=book`);
    expect(campaign.kudos.qr_open_cards).toBe(`${SITE}/comics?src=kudos`);
    expect(campaign.kudos.qr_wall_sign).toBe(`${SITE}/kudos?src=sign`);
    expect(campaign.kudos.qr_guide).toBe(`${SITE}/kudos?src=guide`);
  });

  it("open each poster's and kudos card's own episode, keeping the query", async () => {
    for (const { ep, href } of [...POSTERS, ...KUDOS_CARDS]) {
      const target = await rewriteOf(href);
      expect(target?.pathname, href).toBe(`/comics/ep/${ep}`);
      expect(target?.search, href).toBe(new URL(href).search);
    }
  });

  it("open the episode list for the book and the open kudos cards", async () => {
    for (const href of [campaign.book.qr_book, campaign.kudos.qr_open_cards]) {
      const res = await run(href);
      expect(res.headers.get("x-middleware-rewrite"), href).toBeNull();
      expect(res.headers.get("location"), href).toBeNull();
    }
  });

  it("open the kudos page for the wall sign and the guide", async () => {
    for (const href of [campaign.kudos.qr_wall_sign, campaign.kudos.qr_guide]) {
      const res = await run(href);
      expect(res.headers.get("x-middleware-rewrite"), href).toBeNull();
      expect(res.headers.get("location"), href).toBeNull();
      expect(res.status, href).toBe(200);
    }
  });

  it("each say which printed piece they're on", () => {
    const sourceOf = (href: string) => arrivalSource(new URL(href).searchParams);
    for (const { href } of POSTERS) expect(sourceOf(href)).toBe("poster");
    for (const { href } of KUDOS_CARDS) expect(sourceOf(href)).toBe("kudos");
    expect(sourceOf(campaign.book.qr_book)).toBe("book");
    expect(sourceOf(campaign.kudos.qr_open_cards)).toBe("kudos");
    expect(sourceOf(campaign.kudos.qr_wall_sign)).toBe("sign");
    expect(sourceOf(campaign.kudos.qr_guide)).toBe("guide");
  });

  it("never carry the VIP key: the data file's VIP link stays out of the repo", () => {
    const raw = readFileSync(
      path.join(process.cwd(), "src/lib/comics/print-campaign.json"),
      "utf8"
    );
    expect(raw).not.toMatch(/\/vip\//);
    expect(Object.keys(campaign.book)).toEqual(["title", "author", "qr_book"]);
  });
});

describe("the book's episodes, as printed", () => {
  it("are all 26, in order, word for word from the data file", () => {
    expect(BOOK_EPISODES.map((e) => e.ep)).toEqual(Array.from({ length: 26 }, (_, i) => i + 1));
    campaign.episodes.forEach((printed, i) => {
      const e = BOOK_EPISODES[i];
      expect(e.ep, printed.ep).toBe(Number(printed.ep));
      expect(e.title, printed.ep).toBe(printed.title);
      expect(e.lesson, printed.ep).toBe(printed.lesson);
      expect(e.question, printed.ep).toBe(printed.ask_your_team);
      expect(e.bookPage, printed.ep).toBe(printed.book_page);
      expect(e.theme, printed.ep).toBe(printed.theme);
      expect(e.kudosHeadline, printed.ep).toBe(printed.kudos_headline);
      expect(e.kudosQuote, printed.ep).toBe(printed.kudos_quote);
      expect(e.kudosSpeaker, printed.ep).toBe(printed.kudos_speaker);
      expect(printTheme(e.theme).colour, printed.ep).toBe(printed.theme_colour);
      expect(bookEpisode(e.ep)).toBe(e);
    });
    expect(bookEpisode(27)).toBeNull();
  });

  it("are colour-coded by the four printed habits, with the open cards' colour besides", () => {
    expect(PRINT_THEMES.map((t) => [t.name, t.colour])).toEqual([
      ["Focus", "#12676B"],
      ["Ownership", "#C2461F"],
      ["Real needs", "#2F5BB7"],
      ["Trust", "#E3A21A"],
    ]);
    expect(OPEN_THEME.colour).toBe("#14252A");
  });

  it("put readable ink on every printed colour, dark on Trust as the spec says", () => {
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => {
        const v = parseInt(hex.slice(i, i + 2), 16) / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a: string, b: string) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    for (const t of [...PRINT_THEMES, OPEN_THEME]) {
      expect(contrast(t.ink, t.colour), t.name).toBeGreaterThanOrEqual(4.5);
    }
    expect(printTheme("Trust").ink).not.toBe("#ffffff");
  });
});

describe("/comics addresses", () => {
  const BASE = `${SITE}/comics`;

  it.each([
    ["a book episode", "?ep=12", "/comics/ep/12"],
    ["an unpadded book episode", "?ep=7", "/comics/ep/7"],
    ["a padded book episode", "?ep=07", "/comics/ep/7"],
    ["the first weekly story", "?ep=27", "/comics/ep/27"],
    ["a three-digit weekly story", "?ep=126", "/comics/ep/126"],
    ["an old building poster", "?ep=12&b=01", "/comics/ep/12"],
    ["an old building poster with a bad building", "?ep=12&b=11", "/comics/ep/12"],
    ["a poster with extra query", "?ep=12&src=poster&utm_source=qr", "/comics/ep/12"],
    ["an unknown source", "?ep=12&src=billboard", "/comics/ep/12"],
  ])("%s goes to its episode page", async (_label, query, pathname) => {
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
    ["a source alone", "?src=poster"],
    ["a building alone", "?b=01"],
  ])("%s stays the episode list", async (_label, query) => {
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

  it.each([
    ["src=poster", "poster"],
    ["src=kudos", "kudos"],
    ["src=book", "book"],
    ["src=sign", "sign"],
    ["src=guide", "guide"],
    ["src=comics", "comics"],
    ["", "none"],
    ["src=", "none"],
    ["src=Poster", "none"],
    ["src=billboard", "none"],
    ["src=poster&src=kudos", "none"],
    ["utm_source=qr", "none"],
    // The building posters printed `b` and no `src`.
    ["ep=12&b=01", "poster"],
    ["b=99", "poster"],
    ["src=kudos&b=01", "kudos"],
    ["src=billboard&b=01", "none"],
  ])("arrivalSource(%j) is %s", (query, source) => {
    expect(arrivalSource(new URLSearchParams(query))).toBe(source);
  });

  it("knows exactly the printed sources, plus the comic pages' own links", () => {
    expect([...PRINT_SOURCES]).toEqual(["poster", "kudos", "book", "sign", "guide", "comics"]);
  });

  it("comicRewritePath needs only a valid ep", () => {
    expect(comicRewritePath(new URLSearchParams("b=01"))).toBeNull();
    expect(comicRewritePath(new URLSearchParams("src=poster"))).toBeNull();
    expect(comicRewritePath(new URLSearchParams("ep=01&b=10"))).toBe("/comics/ep/1");
    expect(comicRewritePath(new URLSearchParams("ep=01&src=kudos"))).toBe("/comics/ep/1");
  });

  it("links an episode's kudos to its printed card, padded like the print", () => {
    expect(thankSomeoneHref(7)).toBe("/kudos?ep=07&src=comics");
    expect(thankSomeoneHref(26)).toBe("/kudos?ep=26&src=comics");
  });
});
