/**
 * Multi-line paste into an "add" box: one item per non-empty line.
 *
 * The add boxes in Retro, Kanban and Planning Poker are single-line inputs,
 * which drop a paste's line breaks and run the lines together. Each box
 * calls this from `onPaste`: a paste of two or more lines comes back split
 * (and capped) for the tool to add, anything else is left to the input.
 *
 * A box made for pasting a list (Sprint Planning's "Paste stories") reads
 * its text with `pastedLines`, where one line is a list of one, and passes
 * its own, larger cap.
 *
 * Pure, no browser globals.
 */

/** Most items one paste adds, unless the caller passes its own cap. */
export const PASTE_LINE_CAP = 30;

/**
 * A list marker people paste from notes or Markdown: "- ", "* ", "• ",
 * "1. ", "2) ". Needs the space (or the end of the line), so "-5%" and
 * "1.5 days" stay as they are.
 */
const LIST_MARKER = /^(?:[-*•‣◦]|\d{1,3}[.)])(?:\s+|$)/;

export interface PastedLines {
  /** The lines to add, trimmed, list markers removed, at most `cap`. */
  lines: string[];
  /** Non-empty lines left out because of the cap. */
  dropped: number;
}

/**
 * Every non-empty line of `text` as an item: trimmed, list markers removed,
 * at most `cap`. One line gives one item, none gives none.
 */
export function pastedLines(text: string, cap: number = PASTE_LINE_CAP): PastedLines {
  const all = text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim().replace(LIST_MARKER, "").trim())
    .filter(Boolean);
  const max = Math.max(0, Math.floor(cap));
  return { lines: all.slice(0, max), dropped: Math.max(0, all.length - max) };
}

/**
 * Split pasted text into one item per non-empty line. Returns null for a
 * paste of one line (or none), so the input handles it as usual.
 */
export function splitPastedLines(text: string, cap: number = PASTE_LINE_CAP): PastedLines | null {
  const pasted = pastedLines(text, cap);
  return pasted.lines.length + pasted.dropped < 2 ? null : pasted;
}

/** "3 more lines were left out." */
export function leftOutMessage(dropped: number): string {
  return `${dropped} more ${dropped === 1 ? "line was" : "lines were"} left out.`;
}
