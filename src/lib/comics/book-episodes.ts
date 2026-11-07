/**
 * The 26 episodes of the printed book, as the posters and kudos cards print
 * them. Read from print-campaign.json, the print campaign's own data file, so
 * the site says exactly what the print says: change the wording there, never
 * here. The book's episodes are never put online, so this is all the site has
 * of them.
 */

import campaign from "./print-campaign.json";
import { isPrintThemeName, type PrintThemeName } from "./print-themes";

export interface BookEpisode {
  ep: number;
  title: string;
  lesson: string;
  /** Printed on the poster after "Ask your team:". */
  question: string;
  bookPage: number;
  /** The habit the poster and kudos card are colour-coded by. */
  theme: PrintThemeName;
  /** The episode's kudos card: its headline, and the line quoted under it. */
  kudosHeadline: string;
  kudosQuote: string;
  kudosSpeaker: string;
}

export const BOOK_EPISODES: readonly BookEpisode[] = campaign.episodes.map((e) => {
  if (!isPrintThemeName(e.theme)) {
    throw new Error(`print-campaign.json: episode ${e.ep} has an unknown theme "${e.theme}"`);
  }
  return {
    ep: Number(e.ep),
    title: e.title,
    lesson: e.lesson,
    question: e.ask_your_team,
    bookPage: e.book_page,
    theme: e.theme,
    kudosHeadline: e.kudos_headline,
    kudosQuote: e.kudos_quote,
    kudosSpeaker: e.kudos_speaker,
  };
});

/** A book episode by number, or null outside 1-26. */
export function bookEpisode(ep: number): BookEpisode | null {
  return BOOK_EPISODES[ep - 1] ?? null;
}
