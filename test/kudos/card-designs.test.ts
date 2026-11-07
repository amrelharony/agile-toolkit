// @vitest-environment node
/**
 * The 28 printed kudos cards as the site draws them, the one rule that says
 * which card a stored kudos is drawn as (whatever it holds), and where each
 * card's comic panel lives.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { BOOK_EPISODES, bookEpisode } from "@/lib/comics/book-episodes";
import {
  CARD_DESIGNS,
  cardDesign,
  cardName,
  designFor,
  designsByHabit,
  epLabel,
  episodeDesign,
  remindsOf,
  splitHeadline,
} from "@/lib/kudos/card-designs";
import { CARD_PANEL_PATHS, cardPanelUrl } from "@/lib/kudos/card-panels";

const FOCUS = "#12676B";
const OWNERSHIP = "#C2461F";
const REAL_NEEDS = "#2F5BB7";
const TRUST = "#E3A21A";
const DARK = "#14252A";
const WHITE = "#ffffff";

const keyOf = (ep: number) => `ep-${String(ep).padStart(2, "0")}`;

describe("the card designs", () => {
  it("are the 26 episodes in order, then Thank you! and Great teamwork!", () => {
    expect(CARD_DESIGNS).toHaveLength(28);
    expect(CARD_DESIGNS.map((d) => d.key)).toEqual([
      ...BOOK_EPISODES.map((e) => keyOf(e.ep)),
      "open-thank-you",
      "open-teamwork",
    ]);
    expect(CARD_DESIGNS.slice(0, 26).every((d) => d.kind === "episode")).toBe(true);
    expect(CARD_DESIGNS.slice(26).map((d) => [d.kind, d.title, d.headline])).toEqual([
      ["open", "Thank you!", "Thank you!"],
      ["open", "Great teamwork!", "Great teamwork!"],
    ]);
  });

  it("say what each episode's printed card says, word for word", () => {
    for (const e of BOOK_EPISODES) {
      const d = episodeDesign(e.ep)!;
      expect(d).toMatchObject({
        key: keyOf(e.ep),
        kind: "episode",
        ep: e.ep,
        habit: e.theme,
        title: e.title,
        headline: e.kudosHeadline,
        quote: e.kudosQuote,
        speaker: e.kudosSpeaker,
        lesson: e.lesson,
        bookPage: e.bookPage,
      });
      expect(cardDesign(d.key)).toBe(d);
    }
  });

  it("give the open cards no episode, quote or lesson", () => {
    for (const key of ["open-thank-you", "open-teamwork"]) {
      expect(cardDesign(key)).toMatchObject({
        kind: "open",
        theme: key,
        ep: null,
        habit: "Open",
        quote: null,
        speaker: null,
        lesson: null,
        bookPage: null,
      });
    }
  });

  it("store each card under its habit's theme id", () => {
    expect(episodeDesign(7)!.theme).toBe("ownership");
    expect(episodeDesign(1)!.theme).toBe("focus");
    expect(episodeDesign(3)!.theme).toBe("real-needs");
    expect(episodeDesign(4)!.theme).toBe("trust");
    const ids = {
      Focus: "focus",
      Ownership: "ownership",
      "Real needs": "real-needs",
      Trust: "trust",
    };
    for (const d of CARD_DESIGNS.slice(0, 26)) {
      expect(d.theme).toBe(ids[d.habit as keyof typeof ids]);
    }
  });

  it("print in the habit's colour and ink, with dark labels where mustard would be too light", () => {
    const byHabit = (habit: string) => CARD_DESIGNS.find((d) => d.habit === habit)!;
    expect(byHabit("Focus")).toMatchObject({ colour: FOCUS, ink: WHITE, accent: FOCUS });
    expect(byHabit("Ownership")).toMatchObject({
      colour: OWNERSHIP,
      ink: WHITE,
      accent: OWNERSHIP,
    });
    expect(byHabit("Real needs")).toMatchObject({
      colour: REAL_NEEDS,
      ink: WHITE,
      accent: REAL_NEEDS,
    });
    expect(byHabit("Trust")).toMatchObject({ colour: TRUST, ink: DARK, accent: DARK });
    for (const key of ["open-thank-you", "open-teamwork"]) {
      expect(cardDesign(key)).toMatchObject({ colour: DARK, ink: WHITE, accent: DARK });
    }
  });

  it("finds no card for an unknown key or a number outside 1-26", () => {
    expect(cardDesign("ep-27")).toBeNull();
    expect(cardDesign("thank-you")).toBeNull();
    expect(cardDesign("constructor")).toBeNull();
    for (const ep of [0, 27, -1, 1.5, Number.NaN, "7", null, undefined, {}]) {
      expect(episodeDesign(ep)).toBeNull();
    }
  });

  it("are grouped Focus, Ownership, Real needs, Trust, then Open, each in episode order", () => {
    const groups = designsByHabit();
    expect(groups.map((g) => [g.habit, g.colour, g.ink])).toEqual([
      ["Focus", FOCUS, WHITE],
      ["Ownership", OWNERSHIP, WHITE],
      ["Real needs", REAL_NEEDS, WHITE],
      ["Trust", TRUST, DARK],
      ["Open", DARK, WHITE],
    ]);
    expect(groups.flatMap((g) => g.designs)).toHaveLength(28);
    for (const g of groups.slice(0, 4)) {
      const eps = g.designs.map((d) => d.ep!);
      expect(eps).toEqual([...eps].sort((a, b) => a - b));
      expect(g.designs.every((d) => d.habit === g.habit)).toBe(true);
    }
    expect(groups[4].designs.map((d) => d.key)).toEqual(["open-thank-you", "open-teamwork"]);
  });

  it("are named by headline and EP, or by the open card's words", () => {
    expect(cardName(episodeDesign(7)!)).toBe("Thanks for seeing it through (EP 07)");
    expect(cardName(episodeDesign(26)!)).toBe("Thanks for speaking up (EP 26)");
    expect(cardName(cardDesign("open-teamwork")!)).toBe("Great teamwork!");
    expect(epLabel(7)).toBe("EP 07");
  });

  it("split every headline into its small Thanks for and the rest", () => {
    for (const d of CARD_DESIGNS.slice(0, 26)) {
      const { lead, rest } = splitHeadline(d.headline);
      expect(lead).toBe("Thanks for");
      expect(`${lead} ${rest}`).toBe(d.headline);
    }
    expect(splitHeadline("Thanks for seeing it through")).toEqual({
      lead: "Thanks for",
      rest: "seeing it through",
    });
    expect(splitHeadline("Well done")).toEqual({ lead: null, rest: "Well done" });
  });
});

describe("designFor: how a stored kudos is drawn", () => {
  const key = (k: Parameters<typeof designFor>[0]) => designFor(k).key;

  it("draws an open card by its id, an episode alongside it being only what it reminds of", () => {
    expect(key({ theme: "open-thank-you" })).toBe("open-thank-you");
    expect(key({ theme: "open-teamwork" })).toBe("open-teamwork");
    expect(key({ theme: "open-teamwork", episode: 7 })).toBe("open-teamwork");
  });

  it("draws an episode's card from its number, whatever the theme says", () => {
    expect(key({ theme: "ownership", episode: 7 })).toBe("ep-07");
    expect(key({ episode: 7 })).toBe("ep-07");
    // Another habit, an original id, or a custom theme: the episode wins.
    expect(key({ theme: "focus", episode: 7 })).toBe("ep-07");
    expect(key({ theme: "well-done", episode: 12 })).toBe("ep-12");
    expect(
      key({ theme: { id: "ship", title: "Ship", emoji: "🚀", hex: "#123456" }, episode: 4 })
    ).toBe("ep-04");
  });

  it("draws Thank you! for a habit with no episode", () => {
    for (const theme of ["focus", "ownership", "real-needs", "trust"]) {
      expect(key({ theme })).toBe("open-thank-you");
    }
  });

  it("draws Thank you! for the original themes", () => {
    for (const theme of [
      "awesome",
      "thank-you",
      "great-job",
      "congratulations",
      "very-happy",
      "you-rock",
      "well-done",
    ]) {
      expect(key({ theme })).toBe("open-thank-you");
    }
  });

  it("draws Thank you! for a custom theme, even one whose id is a card's", () => {
    expect(key({ theme: { id: "trust" } })).toBe("open-thank-you");
    expect(key({ theme: { id: "open-teamwork", title: "Mine", emoji: "🎉", hex: "#000" } })).toBe(
      "open-thank-you"
    );
  });

  it("ignores an episode that isn't a whole number 1-26", () => {
    for (const episode of ["7", 0, 27, 1.5, -3, Number.NaN, null]) {
      expect(key({ theme: "ownership", episode })).toBe("open-thank-you");
    }
  });

  it("takes raw garbage without throwing", () => {
    for (const k of [
      null,
      undefined,
      {},
      { theme: 42 },
      { theme: null, episode: "x" },
      { theme: ["open-teamwork"] },
      { theme: "constructor" },
      { theme: "__proto__", episode: {} },
    ]) {
      expect(key(k as Parameters<typeof designFor>[0])).toBe("open-thank-you");
    }
  });
});

describe("remindsOf", () => {
  it("is the episode an open card reminds its sender of", () => {
    expect(remindsOf({ theme: "open-thank-you", episode: 7 })).toBe(bookEpisode(7));
    expect(remindsOf({ theme: "open-teamwork", episode: 26 })).toBe(bookEpisode(26));
  });

  it("is nothing for an open card without a valid episode", () => {
    expect(remindsOf({ theme: "open-thank-you" })).toBeNull();
    expect(remindsOf({ theme: "open-thank-you", episode: "7" })).toBeNull();
    expect(remindsOf({ theme: "open-thank-you", episode: 27 })).toBeNull();
  });

  it("is nothing for an episode's card, which is that episode", () => {
    expect(remindsOf({ theme: "ownership", episode: 7 })).toBeNull();
    expect(remindsOf({ theme: { id: "trust" }, episode: 4 })).toBeNull();
  });

  it("is nothing for a card drawn as Thank you! from something else", () => {
    expect(remindsOf({ theme: "well-done" })).toBeNull();
    expect(remindsOf(null)).toBeNull();
  });
});

describe("the cards' panels", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("are one small and one large WebP per card, under kudos-cards/", () => {
    expect(Object.keys(CARD_PANEL_PATHS)).toEqual(CARD_DESIGNS.map((d) => d.key));
    const paths = Object.values(CARD_PANEL_PATHS).flatMap((p) => [p.small, p.large]);
    expect(paths).toHaveLength(56);
    expect(new Set(paths).size).toBe(56);
    for (const [key, { small, large }] of Object.entries(CARD_PANEL_PATHS)) {
      expect(Object.keys(CARD_PANEL_PATHS[key as keyof typeof CARD_PANEL_PATHS])).toEqual([
        "small",
        "large",
      ]);
      expect(small).toMatch(new RegExp(`^kudos-cards/${key}\\.[0-9a-f]+\\.360\\.webp$`));
      expect(large).toMatch(new RegExp(`^kudos-cards/${key}\\.[0-9a-f]+\\.720\\.webp$`));
    }
  });

  it("are full public addresses in the comic-panels bucket", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co/");
    expect(cardPanelUrl("ep-07", "large")).toBe(
      `https://ref.supabase.co/storage/v1/object/public/comic-panels/${CARD_PANEL_PATHS["ep-07"].large}`
    );
    expect(cardPanelUrl("open-thank-you", "small")).toBe(
      `https://ref.supabase.co/storage/v1/object/public/comic-panels/${CARD_PANEL_PATHS["open-thank-you"].small}`
    );
  });

  it("have no address when the site has no Supabase address", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(cardPanelUrl("ep-07", "large")).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", undefined);
    expect(cardPanelUrl("ep-07", "small")).toBeNull();
  });
});
