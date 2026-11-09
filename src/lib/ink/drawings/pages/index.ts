/**
 * Spot drawings for pages that aren't a tool (or want their own picture): the
 * comic's pages, the meta pages, settings and sign-in. Same pen and grid as the
 * section art (lib/ink/drawings/sections).
 *
 * A server page can use PAGE_ART freely: only the drawing it passes on reaches
 * the browser. A client component imports the one file it shows, so it doesn't
 * download the set.
 */
import { comicsArt } from "./comics";
import { bookArt } from "./book";
import { toolboxArt } from "./toolbox";
import { hourglassArt } from "./hourglass";
import { lightbulbArt } from "./lightbulb";
import { paletteArt } from "./palette";
import { bellArt } from "./bell";
import { balloonArt } from "./balloon";
import { squadArt } from "./squad";
import { keyArt } from "./key";
import { doorArt } from "./door";
import { cardsArt } from "./cards";
import { guestbookArt } from "./guestbook";
import { scrollArt } from "./scroll";
import { earlyArt } from "./early";
import type { InkDrawing } from "../../types";

export const PAGE_ART = {
  comics: comicsArt,
  book: bookArt,
  toolbox: toolboxArt,
  hourglass: hourglassArt,
  lightbulb: lightbulbArt,
  palette: paletteArt,
  bell: bellArt,
  balloon: balloonArt,
  squad: squadArt,
  key: keyArt,
  door: doorArt,
  cards: cardsArt,
  guestbook: guestbookArt,
  scroll: scrollArt,
  early: earlyArt,
} satisfies Record<string, InkDrawing>;

export type PageArtName = keyof typeof PAGE_ART;
