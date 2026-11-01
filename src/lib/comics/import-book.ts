/**
 * Reading the 26 book episodes out of the poster artwork folder. Pure.
 *
 * Title, lesson, question and page come from the canon index and the words from
 * the printed posters. Nothing in the source says what a panel shows, so every
 * description starts empty and waits in the review queue. A story can't be
 * released without them, so printed links stay as text until that's done.
 */

import { BOOK_DIALOGUE } from "./book-dialogue";
import { BOOK_EPISODES } from "./book-episodes";
import { DEFAULT_CREDIT_CORNER, type StoredPanel } from "./story-input";
import type { FolderFile, ImportPlan, ImportPanel, ImportStory } from "./import-weekly";

export const BOOK_PANELS = 104;
const PANELS_PER_EPISODE = 4;

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
        alt: "",
        dialogue: words ? words.dialogue.map((d) => ({ ...d })) : [],
        signs: words ? [...words.signs] : [],
        needsReview: true,
        creditCorner: DEFAULT_CREDIT_CORNER,
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
    });
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, stories };
}
