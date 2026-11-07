/**
 * The 28 printed kudos cards, as the site draws them: one per book episode (26),
 * then the two open cards, "Thank you!" and "Great teamwork!". Each design
 * carries what its two printed faces say: the band's headline, the panel's
 * quote, the episode's title, lesson and book page, and the habit's colour with
 * its fixed ink.
 *
 * The words come from the print campaign's data file through lib/comics, and a
 * stored kudos keeps only its theme id and episode number, so a card always
 * says what the print says. `designFor` is the one rule for drawing a stored
 * kudos, whatever it holds. Pure, and free of client modules: the MCP server
 * reads it too.
 */

import { BOOK_EPISODES, bookEpisode, type BookEpisode } from "@/lib/comics/book-episodes";
import { OPEN_THEME, PRINT_THEMES, type PrintThemeName } from "@/lib/comics/print-themes";
import { PRINT_CARD_THEMES, printCardTheme, type PrintCardThemeId } from "./print-cards";

type EpNumber =
  | "01"
  | "02"
  | "03"
  | "04"
  | "05"
  | "06"
  | "07"
  | "08"
  | "09"
  | "10"
  | "11"
  | "12"
  | "13"
  | "14"
  | "15"
  | "16"
  | "17"
  | "18"
  | "19"
  | "20"
  | "21"
  | "22"
  | "23"
  | "24"
  | "25"
  | "26";

export type CardDesignKey = `ep-${EpNumber}` | "open-thank-you" | "open-teamwork";

/** The four habits, and "Open" for the two open cards. */
export type CardHabit = PrintThemeName | "Open";

export interface CardDesign {
  key: CardDesignKey;
  kind: "episode" | "open";
  /** The theme id a kudos drawn with this card is stored under. */
  theme: PrintCardThemeId;
  /** 1-26 for an episode's card, null for an open card. */
  ep: number | null;
  habit: CardHabit;
  /** The episode's title, or the open card's words ("Thank you!"). */
  title: string;
  /** What the front's band says: "Thanks for seeing it through", or the open card's words. */
  headline: string;
  quote: string | null;
  speaker: string | null;
  lesson: string | null;
  bookPage: number | null;
  /** The band's printed fill, and the ink printed on it. */
  colour: string;
  ink: string;
  /**
   * Small labels on the white or cream paper: the habit's colour, except
   * Trust's mustard, which is too light for text and prints in the dark ink,
   * as the open cards do.
   */
  accent: string;
}

/** "07" for episode 7, as the cards print it. */
export function padEp(ep: number): string {
  return String(ep).padStart(2, "0");
}

/** The episode chip's words: "EP 07". */
export function epLabel(ep: number): string {
  return `EP ${padEp(ep)}`;
}

function accentOf(habit: PrintThemeName | null, colour: string, ink: string): string {
  return habit === "Trust" ? ink : colour;
}

function episodeOf(e: BookEpisode): CardDesign {
  const theme = PRINT_CARD_THEMES.find((t) => t.habit === e.theme)!;
  return {
    key: `ep-${padEp(e.ep)}` as CardDesignKey,
    kind: "episode",
    theme: theme.id,
    ep: e.ep,
    habit: e.theme,
    title: e.title,
    headline: e.kudosHeadline,
    quote: e.kudosQuote,
    speaker: e.kudosSpeaker,
    lesson: e.lesson,
    bookPage: e.bookPage,
    colour: theme.colour,
    ink: theme.ink,
    accent: accentOf(e.theme, theme.colour, theme.ink),
  };
}

function openOf(id: "open-thank-you" | "open-teamwork"): CardDesign {
  const theme = printCardTheme(id);
  return {
    key: id,
    kind: "open",
    theme: id,
    ep: null,
    habit: "Open",
    title: theme.title,
    headline: theme.title,
    quote: null,
    speaker: null,
    lesson: null,
    bookPage: null,
    colour: theme.colour,
    ink: theme.ink,
    accent: accentOf(null, theme.colour, theme.ink),
  };
}

/** Episodes 1-26 in order, then "Thank you!" and "Great teamwork!". */
export const CARD_DESIGNS: readonly CardDesign[] = [
  ...BOOK_EPISODES.map(episodeOf),
  openOf("open-thank-you"),
  openOf("open-teamwork"),
];

const BY_KEY = new Map<string, CardDesign>(CARD_DESIGNS.map((d) => [d.key, d]));

/** The card a kudos is drawn as when nothing else names one. */
const THANK_YOU = BY_KEY.get("open-thank-you")!;

export function cardDesign(key: string): CardDesign | null {
  return BY_KEY.get(key) ?? null;
}

/** Book episode `ep`'s card, for a whole number 1-26, else null. */
export function episodeDesign(ep: unknown): CardDesign | null {
  if (typeof ep !== "number" || !Number.isInteger(ep)) return null;
  return ep >= 1 && ep <= BOOK_EPISODES.length ? CARD_DESIGNS[ep - 1] : null;
}

type Stored = { theme?: unknown; episode?: unknown } | null | undefined;

/**
 * How a stored kudos is DRAWN. Tolerates any shape (raw API rows):
 *   1. an open card's id ("open-thank-you", "open-teamwork") draws that card;
 *      an episode alongside it is the one it "reminds of";
 *   2. else a book episode (1-26) draws that episode's card, whatever the theme
 *      says (another habit, one of the original ids, a custom theme);
 *   3. anything else (a habit with no episode, an original id, a custom-theme
 *      object, garbage, nothing) draws the "Thank you!" card.
 * A custom theme is an object and never matches by its id: `{ id: "trust" }`
 * is someone's own theme, not the Trust card.
 */
export function designFor(k: Stored): CardDesign {
  const theme = k?.theme;
  if (theme === "open-thank-you" || theme === "open-teamwork") return BY_KEY.get(theme)!;
  return episodeDesign(k?.episode) ?? THANK_YOU;
}

/** For an open card: the book episode it "reminds of" (kept in kudos.episode), else null. */
export function remindsOf(k: Stored): BookEpisode | null {
  if (designFor(k).kind !== "open") return null;
  const ep = episodeDesign(k?.episode)?.ep;
  return ep ? bookEpisode(ep) : null;
}

/** The card's name in words: "Thanks for seeing it through (EP 07)", or "Thank you!". */
export function cardName(d: CardDesign): string {
  return d.ep === null ? d.title : `${d.headline} (${epLabel(d.ep)})`;
}

const LEAD = "Thanks for ";

/**
 * The front band's two lines: "Thanks for" small, then the rest large. Every
 * printed headline starts with it; one that didn't would be shown whole.
 */
export function splitHeadline(headline: string): { lead: string | null; rest: string } {
  return headline.startsWith(LEAD) && headline.length > LEAD.length
    ? { lead: LEAD.trim(), rest: headline.slice(LEAD.length) }
    : { lead: null, rest: headline };
}

export interface HabitDesigns {
  habit: CardHabit;
  colour: string;
  ink: string;
  designs: CardDesign[];
}

/** The cards by habit: Focus, Ownership, Real needs, Trust, then Open; episodes in order. */
export function designsByHabit(): HabitDesigns[] {
  const groups: { habit: CardHabit; colour: string; ink: string }[] = [
    ...PRINT_THEMES.map((t) => ({ habit: t.name, colour: t.colour, ink: t.ink })),
    { habit: "Open", colour: OPEN_THEME.colour, ink: OPEN_THEME.ink },
  ];
  return groups.map((g) => ({ ...g, designs: CARD_DESIGNS.filter((d) => d.habit === g.habit) }));
}
