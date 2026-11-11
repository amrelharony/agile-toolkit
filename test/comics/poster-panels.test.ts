/**
 * The book's 26 posters on the site: every episode's four panels and its link
 * preview, the words that go with them, and nothing where the art can't load.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bookDescriptionFor } from "@/lib/comics/book-descriptions";
import { BOOK_DIALOGUE } from "@/lib/comics/book-dialogue";
import { BOOK_EPISODES } from "@/lib/comics/book-episodes";
import { posterCover, posterPanels, posterShareUrl } from "@/lib/comics/poster-panels";
import { POSTER_ART } from "@/lib/comics/poster-panels.generated";

const STORAGE = "https://ref.supabase.co/storage/v1/object/public/comic-panels/";
const EPS = BOOK_EPISODES.map((e) => e.ep);
const pad = (ep: number) => String(ep).padStart(2, "0");

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the poster art", () => {
  it("has the book's 26 episodes, each with four panels and a preview", () => {
    expect(Object.keys(POSTER_ART).map(Number)).toEqual(EPS);
    for (const ep of EPS) expect(POSTER_ART[ep].panels).toHaveLength(4);
  });

  it("names every file by episode, panel, size and a hash of its bytes, under posters/", () => {
    for (const ep of EPS) {
      POSTER_ART[ep].panels.forEach((files, i) => {
        const stem = `posters/ep-${pad(ep)}\\.p${i + 1}\\.[0-9a-f]{10}`;
        expect(files.small).toMatch(new RegExp(`^${stem}\\.768\\.webp$`));
        expect(files.full).toMatch(new RegExp(`^${stem}\\.1536\\.webp$`));
      });
      expect(POSTER_ART[ep].share).toMatch(
        new RegExp(`^posters/ep-${pad(ep)}\\.share\\.[0-9a-f]{10}\\.jpg$`)
      );
    }
  });

  it("never shares a file between two places", () => {
    const paths = EPS.flatMap((ep) => [
      ...POSTER_ART[ep].panels.flatMap((f) => [f.small, f.full]),
      POSTER_ART[ep].share,
    ]);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toHaveLength(26 * 9);
  });
});

describe("the words with each panel", () => {
  it("describe all 104 for people who can't see the art, in the house style", () => {
    for (const ep of EPS) {
      for (let n = 1; n <= 4; n++) {
        const alt = bookDescriptionFor(ep, n);
        expect(alt.length, `${ep}:${n}`).toBeGreaterThan(60);
        expect(alt.length, `${ep}:${n}`).toBeLessThan(300);
        expect(alt, `${ep}:${n}`).not.toMatch(/—/);
      }
    }
  });

  it("carry each poster's speech, four panels an episode", () => {
    for (const ep of EPS) {
      const text = BOOK_DIALOGUE[ep];
      expect(text.panels, `${ep}`).toHaveLength(4);
      expect(text.panels.flatMap((p) => p.dialogue).length, `${ep}`).toBeGreaterThan(0);
    }
  });
});

describe("posterPanels", () => {
  it("gives an episode's four panels in reading order, described, with their words", () => {
    const panels = posterPanels(12);
    expect(panels.map((p) => p.pathSmall)).toEqual(POSTER_ART[12].panels.map((f) => f.small));
    expect(panels.map((p) => p.pathFull)).toEqual(POSTER_ART[12].panels.map((f) => f.full));
    expect(panels.map((p) => p.alt)).toEqual([1, 2, 3, 4].map((n) => bookDescriptionFor(12, n)));
    expect(panels.map((p) => p.dialogue)).toEqual(BOOK_DIALOGUE[12].panels.map((p) => p.dialogue));
    expect(panels.map((p) => p.signs)).toEqual(BOOK_DIALOGUE[12].panels.map((p) => p.signs));
    for (const panel of panels) expect([panel.width, panel.height]).toEqual([1536, 1536]);
  });

  it("hands out copies, so a page can't change the words for the next", () => {
    const [first] = posterPanels(1);
    first.dialogue.push({ speaker: "Nobody", line: "Changed" });
    first.signs.push("CHANGED");
    expect(posterPanels(1)[0].dialogue).toEqual(BOOK_DIALOGUE[1].panels[0].dialogue);
    expect(posterPanels(1)[0].signs).toEqual(BOOK_DIALOGUE[1].panels[0].signs);
  });

  it("gives a weekly story's number nothing", () => {
    expect(posterPanels(27)).toEqual([]);
    expect(posterCover(27)).toBeNull();
    expect(posterShareUrl(27)).toBeNull();
  });
});

describe("posterCover and posterShareUrl", () => {
  it("give the first panel's small file and the preview's full address", () => {
    expect(posterCover(7)).toEqual({
      pathSmall: POSTER_ART[7].panels[0].small,
      width: 1536,
      height: 1536,
    });
    expect(posterShareUrl(7)).toBe(`${STORAGE}${POSTER_ART[7].share}`);
  });
});

describe("with no Supabase address", () => {
  it.each(["", "   "])("gives nothing, so pages show the words alone (%j)", (value) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", value);
    expect(posterPanels(12)).toEqual([]);
    expect(posterCover(12)).toBeNull();
    expect(posterShareUrl(12)).toBeNull();
  });
});
