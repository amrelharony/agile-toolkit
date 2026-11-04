/**
 * Reading the 26 book episodes out of the poster artwork folder. Pure.
 *
 * Title, lesson, question and page come from the canon index and the words from
 * the printed posters. Nothing in the source says what a panel shows, so every
 * description is a draft (book-descriptions.ts) that waits in the review queue.
 * A story isn't released until they're approved, so printed links stay as text
 * until that's done.
 *
 * The poster artwork zip's own JPGs have no lettering: use the panels rendered
 * from the finished posters, which carry the balloons (see RUNBOOK).
 */

import { bookDescriptionFor } from "./book-descriptions";
import { BOOK_DIALOGUE } from "./book-dialogue";
import { BOOK_EPISODES } from "./book-episodes";
import { DEFAULT_CREDIT_CORNER, type CreditCorner, type StoredPanel } from "./story-input";
import type { FolderFile, ImportPlan, ImportPanel, ImportStory } from "./import-weekly";

export const BOOK_PANELS = 104;
const PANELS_PER_EPISODE = 4;

/**
 * Where the credit goes on the book panels where the default corner would put it
 * on a balloon or its lettering, by episode:panel. Every panel's corners were
 * checked at the 768 px the site serves. Episode 6 panel 3 has a balloon in each
 * corner, and top-left only grazes one's outline. The review queue can move any.
 */
export const BOOK_CREDIT_CORNERS: Readonly<Record<string, CreditCorner>> = {
  "5:3": "top-right",
  "6:3": "top-left",
  "11:4": "bottom-left",
  "19:3": "bottom-left",
  "20:3": "top-left",
  "22:1": "top-left",
  "22:3": "top-right",
  "23:3": "top-right",
  "24:1": "top-left",
  "24:2": "top-right",
  "26:1": "top-left",
  "26:3": "top-left",
};

/**
 * The share image is a 1200 x 630 strip from the middle of the first panel
 * (shareCrop), so its corners are other parts of the art: its credit has its own
 * corner, checked on every episode's. Bottom-right everywhere but these two,
 * where it would sit on a balloon (3) and a sign (15).
 */
export const BOOK_SHARE_CREDIT_CORNERS: Readonly<Record<number, CreditCorner>> = {
  3: "bottom-left",
  15: "bottom-left",
};

/** Panels/Episode_NN/ENN_Panel_MM.jpg. The zip's Finished_Posters folder is ignored. */
const BOOK_PANEL_FILE = /(?:^|\/)Panels\/Episode_(\d{2})\/E(\d{2})_Panel_(\d{2})\.(?:jpe?g|png)$/i;

export function bookSourceId(ep: number): string {
  return `AAW-E${String(ep).padStart(2, "0")}`;
}

export function planBookImport<F extends FolderFile>(files: readonly F[]): ImportPlan<F> {
  const byPanel = new Map<string, F>();
  for (const file of files) {
    const match = BOOK_PANEL_FILE.exec(file.path);
    if (!match || match[1] !== match[2]) continue;
    byPanel.set(`${Number(match[1])}:${Number(match[3])}`, file);
  }
  if (byPanel.size !== BOOK_PANELS) {
    return {
      ok: false,
      problems: [`Found ${byPanel.size} panel files in Panels/Episode_NN, not ${BOOK_PANELS}.`],
    };
  }

  const problems: string[] = [];
  const stories: ImportStory<F>[] = [];
  for (const episode of BOOK_EPISODES) {
    const text = BOOK_DIALOGUE[episode.ep];
    const panels: ImportPanel<F>[] = [];
    for (let n = 1; n <= PANELS_PER_EPISODE; n += 1) {
      const file = byPanel.get(`${episode.ep}:${n}`);
      if (!file) {
        problems.push(`Episode ${episode.ep} has no panel ${n}.`);
        continue;
      }
      const words = text?.panels[n - 1];
      const stored: StoredPanel = {
        pathFull: "",
        pathSmall: "",
        width: 0,
        height: 0,
        alt: bookDescriptionFor(episode.ep, n),
        dialogue: words ? words.dialogue.map((d) => ({ ...d })) : [],
        signs: words ? [...words.signs] : [],
        needsReview: true,
        creditCorner: BOOK_CREDIT_CORNERS[`${episode.ep}:${n}`] ?? DEFAULT_CREDIT_CORNER,
      };
      panels.push({ file, text: stored });
    }
    stories.push({
      ep: episode.ep,
      sourceId: bookSourceId(episode.ep),
      title: episode.title,
      lesson: episode.lesson,
      squadQuestion: episode.question,
      castNames: text ? [...text.cast] : [],
      themes: [],
      bookPage: episode.bookPage,
      panels,
      shareCorner: BOOK_SHARE_CREDIT_CORNERS[episode.ep] ?? DEFAULT_CREDIT_CORNER,
    });
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, stories };
}
