"use client";

import { useEffect, useId, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { usePersistedLocal } from "@/lib/utils/use-persisted";
import {
  EMPTY_COMIC_CONTENT,
  chapterForPage,
  hasComicContent,
  normalizeComicContent,
  pageAlt,
  type ComicChapter,
  type ComicContent,
  type ComicTranscript,
} from "@/lib/comic/content";

/** Per device: whether the Transcript panel is open. Closed by default. */
export const COMIC_TRANSCRIPT_KEY = "agile-toolkit:comic:transcript:v1";

type ContentModule = typeof import("@/lib/comic/agile-at-work-content");

// The module once loaded, so a reader mounted later reads it at once.
let shippedModule: ContentModule | null = null;
let loading: Promise<ContentModule | null> | null = null;

/** The shipped text is its own chunk, fetched while the PDF opens. */
function loadShipped(): Promise<ContentModule | null> {
  loading ??= import("@/lib/comic/agile-at-work-content").then(
    (m) => (shippedModule = m),
    () => {
      // A failed chunk only costs the text this time; the next reader retries.
      loading = null;
      return null;
    }
  );
  return loading;
}

/**
 * The comic's text (the shipped file, or `override` for tests and other
 * editions), read against the PDF's page count. Empty until both are known,
 * so nothing flashes in while the PDF opens.
 */
function useComicContent(override: ComicContent | undefined, numPages: number): ComicContent {
  const [loaded, setLoaded] = useState<unknown>(() => shippedModule?.AGILE_AT_WORK_CONTENT);
  useEffect(() => {
    if (override !== undefined || loaded !== undefined) return;
    let cancelled = false;
    void loadShipped().then((m) => {
      const value = m?.AGILE_AT_WORK_CONTENT;
      // An empty file changes nothing on screen: skip the re-render.
      if (!cancelled && hasComicContent(normalizeComicContent(value))) setLoaded(value);
    });
    return () => {
      cancelled = true;
    };
  }, [override, loaded]);

  const source = override ?? loaded;
  return useMemo(
    () =>
      numPages > 0 && source !== undefined
        ? normalizeComicContent(source, numPages)
        : EMPTY_COMIC_CONTENT,
    [source, numPages]
  );
}

export interface ReaderComic {
  content: ComicContent;
  transcripts: ReadonlyMap<number, ComicTranscript>;
  /** The chapter of the LAST page on screen: a spread can open a new
   * chapter on its right-hand page, and that is where the reader now is.
   * The exception is a chapter just picked in Contents, while its first
   * page is on screen (see `pickChapter`). */
  chapter: ComicChapter | null;
  /** Contents picked the chapter starting on `firstPage`: it is the
   * current chapter until its first page leaves the screen. Otherwise a
   * one-page chapter on a spread's left-hand page, followed straight away
   * by the next chapter, could never be current: picking it would mark,
   * announce and link the next chapter instead. */
  pickChapter: (firstPage: number) => void;
  /** The pages on screen that have a transcript, in view order. */
  viewTranscripts: ComicTranscript[];
  transcriptOpen: boolean;
  setTranscriptOpen: Dispatch<SetStateAction<boolean>>;
  /** The page image's alt text. */
  alt: (page: number) => string;
  /** The id of the page's screen-reader transcript, when it has lines. */
  descriptionId: (page: number) => string | undefined;
}

/** Everything the reader shows from the comic's text, for the current view. */
export function useReaderComic({
  content,
  numPages,
  view,
}: {
  content: ComicContent | undefined;
  numPages: number;
  view: readonly number[];
}): ReaderComic {
  const normalized = useComicContent(content, numPages);
  const transcripts = useMemo(
    () => new Map(normalized.pages.map((t) => [t.page, t] as const)),
    [normalized]
  );
  const [picked, setPicked] = useState<number | null>(null);
  const pinned = picked !== null && view.includes(picked) ? picked : null;
  // "Adjusting state while rendering": once the picked page is off screen,
  // paging back to it follows the usual rule again.
  if (picked !== null && pinned === null) setPicked(null);
  const lastInView = view[view.length - 1] ?? 1;
  const chapter = useMemo(
    () =>
      normalized.chapters.find((c) => c.firstPage === pinned) ??
      chapterForPage(normalized.chapters, lastInView),
    [normalized, lastInView, pinned]
  );
  const viewTranscripts = useMemo(
    () => view.flatMap((p) => transcripts.get(p) ?? []),
    [view, transcripts]
  );
  const [storedOpen, setTranscriptOpen] = usePersistedLocal<boolean>(COMIC_TRANSCRIPT_KEY, false);
  const baseId = useId();

  return {
    content: normalized,
    transcripts,
    chapter,
    pickChapter: setPicked,
    viewTranscripts,
    // Anything but `true` in the slot (a hand edit) reads as closed.
    transcriptOpen: storedOpen === true,
    setTranscriptOpen,
    alt: (page) => pageAlt(page, numPages, transcripts.get(page)),
    descriptionId: (page) =>
      transcripts.get(page)?.lines.length ? `${baseId}page-${page}` : undefined,
  };
}

/**
 * The reader's live-region text: the page label, plus the chapter title
 * when the view has just moved into a chapter, so paging inside one stays
 * as terse as it always was. Without chapters it is exactly the label.
 */
export function useLiveLabel(label: string, chapter: ComicChapter | null): string {
  const chapterStart = chapter?.firstPage ?? null;
  // "Adjusting state while rendering" (React docs): the previous label and
  // chapter live in state, so the announcement is computed once per change.
  const [state, setState] = useState({ label, chapterStart, text: label });
  if (state.label === label && state.chapterStart === chapterStart) return state.text;
  const entered = chapter !== null && chapterStart !== state.chapterStart;
  const text = entered ? `${label} — ${chapter.title}` : label;
  setState({ label, chapterStart, text });
  return text;
}
