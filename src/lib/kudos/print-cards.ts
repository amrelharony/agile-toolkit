/**
 * The kudos cards the print campaign prints, as the Kudos page offers them:
 * the four habits (Focus, Ownership, Real needs, Trust) and the two open cards
 * ("Thank you!" and "Great teamwork!"), in their printed colours with their
 * fixed ink, and for each book episode the headline and quote its card carries.
 *
 * The wording comes from the campaign's data file through lib/comics, never from
 * here, and a card written from an episode keeps only the episode's number, so
 * it always says what the print says. Pure, and free of client modules: the MCP
 * server reads it too.
 */

import { bookEpisode, type BookEpisode } from "@/lib/comics/book-episodes";
import { OPEN_THEME, printTheme, type PrintThemeName } from "@/lib/comics/print-themes";

/** The ids of the printed cards' themes, in the order the picker shows them. */
export const PRINT_CARD_THEME_IDS = [
  "focus",
  "ownership",
  "real-needs",
  "trust",
  "open-thank-you",
  "open-teamwork",
] as const;
export type PrintCardThemeId = (typeof PRINT_CARD_THEME_IDS)[number];

export interface PrintCardTheme {
  id: PrintCardThemeId;
  /** What the card's coloured band says. */
  title: string;
  /** The printed fill. */
  colour: string;
  /** Text on the fill, as printed: dark on Trust, white on the rest. */
  ink: string;
  /** The habit, for the four that are one; the open cards have none. */
  habit?: PrintThemeName;
}

const HABIT_IDS: Record<PrintThemeName, PrintCardThemeId> = {
  Focus: "focus",
  Ownership: "ownership",
  "Real needs": "real-needs",
  Trust: "trust",
};

function habitCard(habit: PrintThemeName): PrintCardTheme {
  const { colour, ink } = printTheme(habit);
  return { id: HABIT_IDS[habit], title: habit, colour, ink, habit };
}

export const PRINT_CARD_THEMES: readonly PrintCardTheme[] = [
  habitCard("Focus"),
  habitCard("Ownership"),
  habitCard("Real needs"),
  habitCard("Trust"),
  { id: "open-thank-you", title: "Thank you!", colour: OPEN_THEME.colour, ink: OPEN_THEME.ink },
  { id: "open-teamwork", title: "Great teamwork!", colour: OPEN_THEME.colour, ink: OPEN_THEME.ink },
];

/** The card a new kudos starts on when no episode picks one. */
export const DEFAULT_PRINT_CARD_THEME: PrintCardThemeId = "open-thank-you";

export function isPrintCardThemeId(value: unknown): value is PrintCardThemeId {
  return typeof value === "string" && (PRINT_CARD_THEME_IDS as readonly string[]).includes(value);
}

export function printCardTheme(id: PrintCardThemeId): PrintCardTheme {
  return PRINT_CARD_THEMES.find((t) => t.id === id)!;
}

/** A book episode's printed kudos card: its habit's theme, headline and quote. */
export interface EpisodeCard {
  ep: number;
  theme: PrintCardThemeId;
  headline: string;
  quote: string;
  speaker: string;
}

function cardOf(episode: BookEpisode): EpisodeCard {
  return {
    ep: episode.ep,
    theme: HABIT_IDS[episode.theme],
    headline: episode.kudosHeadline,
    quote: episode.kudosQuote,
    speaker: episode.kudosSpeaker,
  };
}

/** The printed card of book episode `ep`, or null for any other number. */
export function episodeCard(ep: number | null | undefined): EpisodeCard | null {
  if (typeof ep !== "number" || !Number.isInteger(ep)) return null;
  const episode = bookEpisode(ep);
  return episode ? cardOf(episode) : null;
}

/** Whether `ep` names a book episode's card, as a stored kudos may carry it. */
export function isCardEpisode(ep: unknown): ep is number {
  return typeof ep === "number" && episodeCard(ep) !== null;
}
