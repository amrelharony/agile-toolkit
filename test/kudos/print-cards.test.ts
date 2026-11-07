// @vitest-environment node
/** The Kudos page's cards are the printed ones, word for word and colour for colour. */

import { describe, expect, it } from "vitest";
import campaign from "@/lib/comics/print-campaign.json";
import {
  DEFAULT_PRINT_CARD_THEME,
  PRINT_CARD_THEMES,
  episodeCard,
  isCardEpisode,
  isPrintCardThemeId,
  printCardTheme,
} from "@/lib/kudos/print-cards";
import { parseKudos } from "@/lib/kudos/parse";

/** WCAG contrast of two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("the printed kudos cards", () => {
  it("are the four habits and the two open cards, in the data file's colours", () => {
    const colours = new Map(campaign.kudos.themes.map((t) => [t.name, t.colour]));
    expect(PRINT_CARD_THEMES.map((t) => [t.title, t.colour])).toEqual([
      ["Focus", colours.get("Focus")],
      ["Ownership", colours.get("Ownership")],
      ["Real needs", colours.get("Real needs")],
      ["Trust", colours.get("Trust")],
      ["Thank you!", colours.get("Open")],
      ["Great teamwork!", colours.get("Open")],
    ]);
    const open = campaign.kudos.themes.find((t) => t.name === "Open")!;
    expect(PRINT_CARD_THEMES.slice(4).map((t) => t.title)).toEqual(open.cards);
  });

  it("put dark ink on Trust and white on the rest, each at 4.5:1 or better", () => {
    for (const t of PRINT_CARD_THEMES) {
      expect(t.ink).toBe(t.habit === "Trust" ? "#14252A" : "#ffffff");
      expect(contrast(t.colour, t.ink)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("start on the open Thank you! card", () => {
    expect(printCardTheme(DEFAULT_PRINT_CARD_THEME).title).toBe("Thank you!");
  });

  it("know their own ids and nobody else's", () => {
    for (const t of PRINT_CARD_THEMES) expect(isPrintCardThemeId(t.id)).toBe(true);
    for (const old of ["awesome", "thank-you", "well-done", "Focus", "", 3, null]) {
      expect(isPrintCardThemeId(old)).toBe(false);
    }
  });
});

describe("an episode's card", () => {
  it.each(campaign.episodes.map((e) => [Number(e.ep), e]))(
    "episode %i says what its printed card says",
    (ep, e) => {
      const card = episodeCard(ep)!;
      expect(card).toEqual({
        ep,
        theme: PRINT_CARD_THEMES.find((t) => t.habit === e.theme)!.id,
        headline: e.kudos_headline,
        quote: e.kudos_quote,
        speaker: e.kudos_speaker,
      });
    }
  );

  it("episode 7 is Ownership: Thanks for seeing it through", () => {
    expect(episodeCard(7)).toMatchObject({
      theme: "ownership",
      headline: "Thanks for seeing it through",
    });
  });

  it.each([0, 27, -1, 1.5, Number.NaN, null, undefined])("there is none for %s", (ep) => {
    expect(episodeCard(ep)).toBeNull();
    expect(isCardEpisode(ep)).toBe(false);
  });
});

describe("a stored kudos", () => {
  const base = {
    id: "kud_1",
    toName: "Sara",
    fromName: "Omar",
    message: "for the clear handover",
    sentAt: "2026-11-06T10:00:00.000Z",
  };

  it("takes every printed card's theme and every original one", () => {
    for (const theme of [...PRINT_CARD_THEMES.map((t) => t.id), "awesome", "well-done"]) {
      expect(parseKudos({ ...base, theme }).ok, theme).toBe(true);
    }
  });

  it("keeps a book episode's number, which makes it a v2 card", () => {
    const parsed = parseKudos({ ...base, theme: "ownership", episode: 7 });
    expect(parsed).toMatchObject({ ok: true, kudos: { episode: 7, version: 2 } });
  });

  it("reads a missing episode from the database as none", () => {
    const parsed = parseKudos({ ...base, theme: "focus", episode: null });
    expect(parsed.ok && parsed.kudos).not.toHaveProperty("episode");
  });

  it.each([0, 27, 1.5, "7", -3])("refuses episode %s", (episode) => {
    expect(parseKudos({ ...base, theme: "focus", episode })).toEqual({
      ok: false,
      error: "invalid_episode",
    });
  });
});
