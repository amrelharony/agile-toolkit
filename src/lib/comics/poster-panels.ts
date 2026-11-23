/**
 * The book's 26 episodes as their posters print them: each one's four lettered
 * panels and its link-preview image. The files live in the public `comic-panels`
 * bucket under `posters/`, never in git (poster-panels.generated.ts holds their
 * names, written by scripts/cut-poster-panels.py). Only the posters go online:
 * the full story stays in the book, and the episode's page points to its page.
 *
 * Without a Supabase address (tests, a local-only run) there is nowhere to load
 * the art from, so these give nothing and the pages show what they did before
 * the art, rather than broken relative links. Pure, and free of client modules:
 * the MCP server may read it too.
 */

import { bookDescriptionFor } from "./book-descriptions";
import { BOOK_DIALOGUE } from "./book-dialogue";
import { panelImageUrl } from "./images";
import { POSTER_ART, POSTER_PANEL_HEIGHT, POSTER_PANEL_WIDTH } from "./poster-panels.generated";
import type { Panel, StoryCover } from "./types";

function artOnline(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim());
}

/** The episode's four panels, in reading order, or none for a weekly story. */
export function posterPanels(ep: number): Panel[] {
  const art = POSTER_ART[ep];
  if (!art || !artOnline()) return [];
  const text = BOOK_DIALOGUE[ep];
  return art.panels.map((files, i) => {
    const words = text?.panels[i];
    return {
      pathFull: files.full,
      pathSmall: files.small,
      width: POSTER_PANEL_WIDTH,
      height: POSTER_PANEL_HEIGHT,
      alt: bookDescriptionFor(ep, i + 1),
      dialogue: words ? words.dialogue.map((d) => ({ ...d })) : [],
      signs: words ? [...words.signs] : [],
    };
  });
}

/** The first panel, where a list or a flashcard shows the episode. */
export function posterCover(ep: number): StoryCover | null {
  const first = POSTER_ART[ep]?.panels[0];
  if (!first || !artOnline()) return null;
  return { pathSmall: first.small, width: POSTER_PANEL_WIDTH, height: POSTER_PANEL_HEIGHT };
}

/** The 1200 x 630 link preview: the top of the poster, its title and first two panels. */
export function posterShareUrl(ep: number): string | null {
  const share = POSTER_ART[ep]?.share;
  if (!share || !artOnline()) return null;
  return panelImageUrl(share);
}
