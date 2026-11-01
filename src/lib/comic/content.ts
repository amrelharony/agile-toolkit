/**
 * "Agile at Work" comic: the text that goes with the pages. Each page can
 * have a transcript (one or two sentences describing the page, used as its
 * alt text, plus the lettering in reading order), and the book has a
 * chapter list (each chapter's first page and the 1-3 toolkit tools it
 * shows in use).
 *
 * The owner writes the data, in agile-at-work-content.ts. Nothing here
 * generates, extracts or guesses any text. The file is edited by hand, and
 * the PDF it describes can be re-exported with a different page count, so
 * it is read defensively: a bad entry is dropped rather than shown wrong,
 * and `comicContentProblems` lists every entry that was dropped or trimmed,
 * so a test can fail on a typo before it ships.
 *
 * Pure and isomorphic: no React, safe on the server.
 */

import { getToolById, type ToolDefinition } from "@/lib/constants/tools";
import { COMIC_ID, COMIC_TITLE } from "./agile-at-work";

/** One balloon or caption, in reading order. */
export interface ComicLine {
  /** Who says it. Absent for captions and sound effects. */
  speaker?: string;
  text: string;
}

/** The reviewed text of one page. */
export interface ComicTranscript {
  /** 1-based PDF page index (the cover is page 1). */
  page: number;
  /** One or two sentences on what the page shows: the image's alt text. */
  alt: string;
  /** The lettering in reading order. Empty for a wordless page. */
  lines: ComicLine[];
}

export interface ComicChapter {
  title: string;
  /** 1-based PDF page index of the chapter's first page. The chapter runs
   * to the page before the next chapter starts, or to the last page. */
  firstPage: number;
  /** Ids from the tool catalog (lib/constants/tools), most relevant first. */
  tools: string[];
}

export interface ComicContent {
  /** Sorted by firstPage, one chapter per first page. */
  chapters: ComicChapter[];
  /** Sorted by page, one transcript per page. */
  pages: ComicTranscript[];
}

export const EMPTY_COMIC_CONTENT: ComicContent = { chapters: [], pages: [] };

/** A chapter links to at most this many tools; more would bury the first. */
export const MAX_CHAPTER_TOOLS = 3;

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

const text = (x: unknown): string => (typeof x === "string" ? x.trim() : "");

const isPageIndex = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 1;

/** A tool a chapter can link to: in the catalog, and not this comic itself. */
function isLinkableTool(id: string): boolean {
  return id !== COMIC_ID && getToolById(id) !== undefined;
}

function readChapters(raw: unknown, numPages: number | undefined, problems: string[]) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    problems.push("chapters: should be a list");
    return [];
  }
  const chapters: ComicChapter[] = [];
  const firstPages = new Set<number>();
  let lastStart = 0;
  raw.forEach((entry, i) => {
    const where = `chapters[${i}]`;
    if (!isRecord(entry)) return void problems.push(`${where}: should be an object`);
    const title = text(entry.title);
    if (!title) return void problems.push(`${where}: has no title`);
    const named = `${where} "${title}"`;
    const firstPage = entry.firstPage;
    if (!isPageIndex(firstPage)) {
      return void problems.push(`${named}: firstPage should be a page number (1 or more)`);
    }
    if (numPages !== undefined && firstPage > numPages) {
      return void problems.push(`${named}: starts on page ${firstPage}, past the last page`);
    }
    if (firstPages.has(firstPage)) {
      return void problems.push(`${named}: another chapter already starts on page ${firstPage}`);
    }
    // Kept (the list is sorted below) but flagged: a chapter out of order
    // is usually a mistyped page number.
    if (firstPage < lastStart) problems.push(`${named}: is out of page order`);
    lastStart = Math.max(lastStart, firstPage);

    const tools: string[] = [];
    const rawTools: unknown[] = Array.isArray(entry.tools) ? entry.tools : [];
    if (entry.tools !== undefined && !Array.isArray(entry.tools)) {
      problems.push(`${named}: tools should be a list of tool ids`);
    }
    for (const id of rawTools) {
      const toolId = text(id);
      if (!toolId || tools.includes(toolId)) continue;
      if (!isLinkableTool(toolId)) {
        problems.push(`${named}: "${String(id)}" is not a tool id`);
        continue;
      }
      tools.push(toolId);
    }
    if (tools.length > MAX_CHAPTER_TOOLS) {
      problems.push(
        `${named}: lists ${tools.length} tools; only the first ${MAX_CHAPTER_TOOLS} are shown`
      );
      tools.length = MAX_CHAPTER_TOOLS;
    }
    if (rawTools.length === 0) problems.push(`${named}: lists no tools (give 1-3)`);

    firstPages.add(firstPage);
    chapters.push({ title, firstPage, tools });
  });
  return chapters.sort((a, b) => a.firstPage - b.firstPage);
}

function readLines(raw: unknown, where: string, problems: string[]): ComicLine[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    problems.push(`${where}: lines should be a list`);
    return [];
  }
  const lines: ComicLine[] = [];
  raw.forEach((entry, i) => {
    const words = isRecord(entry) ? text(entry.text) : "";
    if (!isRecord(entry) || !words) return void problems.push(`${where}: lines[${i}] has no text`);
    const speaker = text(entry.speaker);
    lines.push(speaker ? { speaker, text: words } : { text: words });
  });
  return lines;
}

function readPages(raw: unknown, numPages: number | undefined, problems: string[]) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    problems.push("pages: should be a list");
    return [];
  }
  const pages: ComicTranscript[] = [];
  const seen = new Set<number>();
  raw.forEach((entry, i) => {
    const where = `pages[${i}]`;
    if (!isRecord(entry)) return void problems.push(`${where}: should be an object`);
    const page = entry.page;
    if (!isPageIndex(page)) {
      return void problems.push(`${where}: page should be a page number (1 or more)`);
    }
    const named = `${where} (page ${page})`;
    if (numPages !== undefined && page > numPages) {
      return void problems.push(`${named}: is past the last page`);
    }
    if (seen.has(page)) return void problems.push(`${named}: page ${page} is listed twice`);
    const alt = text(entry.alt);
    if (!alt) problems.push(`${named}: has no alt text (the page keeps its generic alt)`);
    const lines = readLines(entry.lines, named, problems);
    // Nothing left to show: leave the page as it is today.
    if (!alt && lines.length === 0) return;
    seen.add(page);
    pages.push({ page, alt, lines });
  });
  return pages.sort((a, b) => a.page - b.page);
}

function readComicContent(raw: unknown, numPages?: number) {
  const problems: string[] = [];
  // 0 or a non-number means the page count isn't known yet: no upper bound.
  const max = typeof numPages === "number" && numPages >= 1 ? Math.floor(numPages) : undefined;
  if (!isRecord(raw)) {
    if (raw !== undefined && raw !== null) problems.push("content: should be an object");
    return { content: EMPTY_COMIC_CONTENT, problems };
  }
  const content: ComicContent = {
    chapters: readChapters(raw.chapters, max, problems),
    pages: readPages(raw.pages, max, problems),
  };
  return { content, problems };
}

/**
 * The content as the reader uses it: invalid entries dropped, unknown tool
 * ids dropped, pages and chapters past `numPages` ignored (when given),
 * duplicates resolved to the first, both lists sorted.
 */
export function normalizeComicContent(raw: unknown, numPages?: number): ComicContent {
  return readComicContent(raw, numPages).content;
}

/** Every entry `normalizeComicContent` drops or trims, in plain words. */
export function comicContentProblems(raw: unknown, numPages?: number): string[] {
  return readComicContent(raw, numPages).problems;
}

/** True when there is anything to show: no chapter and no transcript means
 * the reader looks exactly as it did before transcripts existed. */
export function hasComicContent(content: ComicContent): boolean {
  return content.chapters.length > 0 || content.pages.length > 0;
}

/** The chapter `page` belongs to (the last one starting on or before it);
 * null before the first chapter (the cover, front matter) or with none. */
export function chapterForPage(
  chapters: readonly ComicChapter[],
  page: number
): ComicChapter | null {
  let found: ComicChapter | null = null;
  for (const chapter of chapters) {
    if (chapter.firstPage > page) break;
    found = chapter;
  }
  return found;
}

/** The last page of `chapters[index]`: the page before the next chapter
 * starts, or the book's last page. */
export function chapterLastPage(
  chapters: readonly ComicChapter[],
  index: number,
  numPages: number
): number {
  const next = chapters[index + 1];
  const start = chapters[index]?.firstPage ?? 1;
  return Math.max(start, next ? next.firstPage - 1 : numPages);
}

/** "p. 12–19", or "p. 12" for a one-page chapter. */
export function pageRangeLabel(first: number, last: number): string {
  return first === last ? `p. ${first}` : `p. ${first}–${last}`;
}

/** The tools a chapter links to, resolved through the tool catalog, in its
 * order. An id the catalog no longer knows is skipped. */
export function chapterTools(chapter: ComicChapter): ToolDefinition[] {
  return chapter.tools.flatMap((id) => {
    const tool = isLinkableTool(id) ? getToolById(id) : undefined;
    return tool ? [tool] : [];
  });
}

/** One page's alt text: its description when the owner wrote one, else
 * exactly the generic text every page had before transcripts existed. */
export function pageAlt(page: number, numPages: number, transcript?: ComicTranscript): string {
  return transcript?.alt
    ? `Page ${page} of ${numPages}: ${transcript.alt}`
    : `${COMIC_TITLE} — page ${page} of ${numPages}`;
}

/** A line as it reads aloud: "Sam: Text" or just the text. */
export function lineText(line: ComicLine): string {
  return line.speaker ? `${line.speaker}: ${line.text}` : line.text;
}
