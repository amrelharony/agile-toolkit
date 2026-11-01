import type { ComicContent } from "./content";

/**
 * The "Agile at Work" transcripts and chapter list, written by the owner.
 *
 * EMPTY until the owner supplies the script and the chapter list: never
 * invent, generate or extract text for this file (no placeholder prose).
 * While both lists are empty the reader looks exactly as it did before:
 * no Contents or Transcript controls, the generic alt text on every page.
 *
 * The format, and how to check an edit, is in RUNBOOK.md ("Transcripts and
 * contents", under "Publishing the Agile at Work comic"). Page numbers are
 * PDF page indexes (the cover is page 1) and must match the published PDF.
 * This one file serves every edition of the comic, whose pages are assumed
 * to match.
 *
 * Loaded on demand by the reader (a separate chunk), so the text never
 * weighs on the page's first load.
 */
export const AGILE_AT_WORK_CONTENT: ComicContent = {
  chapters: [],
  pages: [],
};
