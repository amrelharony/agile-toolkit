"use client";

import { useId, useState } from "react";
import { BookMarked, Captions, ListOrdered } from "lucide-react";
import { Button } from "@/components/ui/button";
import { chapterLastPage, pageRangeLabel, type ComicTranscript } from "@/lib/comic/content";
import { cn } from "@/lib/utils";
import type { ReaderComic } from "../hooks/use-comic-content";
import { ToolLinks } from "./chapter-tools";

// The toolbar's selected-segment look (--glow tokens tint for the accent in
// every theme; opacity modifiers on var() colours emit nothing here).
const ON = "bg-[var(--glow)] text-accent shadow-[inset_0_0_0_1px_var(--glowS)]";

const TOGGLE = "min-h-11 md:h-11 aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

/**
 * Contents and Transcript, under the toolbar and inside the reader frame,
 * so both also work in native fullscreen and in the iPhone overlay. They
 * are in-frame disclosures, not Radix popovers: those portal into <body>,
 * which isn't rendered in native fullscreen.
 *
 * Renders nothing while the comic has no chapters and no transcripts, so
 * the reader looks as it did before they existed. Contents shows only with
 * chapters, Transcript only with transcripts; on a page without one the
 * Transcript toggle stays (focus never drops to <body> mid-read) but is
 * unavailable and no panel shows.
 */
export function ReaderPanels({
  comic,
  view,
  numPages,
  isFullscreen,
  onJump,
}: {
  comic: ReaderComic;
  view: readonly number[];
  numPages: number;
  isFullscreen: boolean;
  /** Go to a page and hand focus back to the stage. */
  onJump: (page: number) => void;
}) {
  const [contentsOpen, setContentsOpen] = useState(false);
  const contentsId = useId();
  const transcriptId = useId();
  const { content, chapter, viewTranscripts, transcriptOpen, setTranscriptOpen } = comic;
  const hasChapters = content.chapters.length > 0;
  const hasTranscripts = content.pages.length > 0;
  if (!hasChapters && !hasTranscripts) return null;

  const transcriptHere = viewTranscripts.length > 0;
  const transcriptShown = transcriptOpen && transcriptHere;
  const contentsShown = contentsOpen && hasChapters;

  return (
    <div className={cn("flex flex-col gap-2", isFullscreen && "shrink-0")}>
      <div className="flex flex-wrap items-center gap-2">
        {hasChapters && (
          <Button
            variant="outline"
            className={cn(TOGGLE, contentsShown && ON)}
            aria-expanded={contentsShown}
            aria-controls={contentsShown ? contentsId : undefined}
            onClick={() => setContentsOpen((open) => !open)}
          >
            <ListOrdered aria-hidden="true" />
            Contents
          </Button>
        )}
        {hasTranscripts && (
          <Button
            variant="outline"
            className={cn(TOGGLE, transcriptShown && ON)}
            aria-expanded={transcriptShown}
            aria-controls={transcriptShown ? transcriptId : undefined}
            // aria-disabled, not disabled: focus stays on the toggle when
            // the page turns to one without a transcript.
            aria-disabled={!transcriptHere}
            title={transcriptHere ? undefined : "No transcript for this page yet"}
            onClick={() => {
              if (transcriptHere) setTranscriptOpen((open) => !open);
            }}
          >
            <Captions aria-hidden="true" />
            Transcript
          </Button>
        )}
        {chapter && (
          <p className="flex min-w-0 basis-full items-start gap-1.5 text-sm text-sub sm:flex-1 sm:basis-0">
            <BookMarked className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-words">
              <span className="sr-only">Current chapter: </span>
              {chapter.title}
            </span>
          </p>
        )}
      </div>

      {(contentsShown || transcriptShown) && (
        // In fullscreen the stage keeps the rest of the screen.
        <div
          className={cn(
            "flex flex-col gap-2",
            isFullscreen && "max-h-[35vh] overflow-y-auto overscroll-contain"
          )}
        >
          {contentsShown && (
            <ContentsPanel
              id={contentsId}
              comic={comic}
              numPages={numPages}
              onJump={(page) => {
                onJump(page);
                // Like a menu: it closes once a chapter is chosen.
                setContentsOpen(false);
              }}
            />
          )}
          {transcriptShown && (
            <TranscriptPanel id={transcriptId} view={view} transcripts={viewTranscripts} />
          )}
        </div>
      )}
    </div>
  );
}

function ContentsPanel({
  id,
  comic,
  numPages,
  onJump,
}: {
  id: string;
  comic: ReaderComic;
  numPages: number;
  onJump: (page: number) => void;
}) {
  const headingId = useId();
  const { chapters } = comic.content;
  return (
    <nav
      id={id}
      aria-labelledby={headingId}
      className="rounded-xl border border-border bg-[var(--card)] p-2"
    >
      <h2 id={headingId} className="sr-only">
        Contents
      </h2>
      <ol className="flex flex-col gap-1">
        {chapters.map((c, i) => {
          const last = chapterLastPage(chapters, i, numPages);
          const current = comic.chapter?.firstPage === c.firstPage;
          return (
            <li key={c.firstPage} className={cn("min-w-0 rounded-lg", current && ON)}>
              <button
                type="button"
                aria-current={current ? "true" : undefined}
                onClick={() => onJump(c.firstPage)}
                className={cn(
                  "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  !current && "hover:bg-surface-hover"
                )}
              >
                <span className="min-w-0 flex-1 break-words font-medium text-text">{c.title}</span>
                {current && (
                  <span aria-hidden="true" className="shrink-0 text-xs font-semibold text-accent">
                    Reading
                  </span>
                )}
                <span
                  aria-hidden="true"
                  className="shrink-0 font-mono text-xs tabular-nums text-sub"
                >
                  {pageRangeLabel(c.firstPage, last)}
                </span>
                <span className="sr-only">
                  {c.firstPage === last
                    ? `, page ${c.firstPage}`
                    : `, pages ${c.firstPage} to ${last}`}
                </span>
              </button>
              <ToolLinks chapter={c} className="px-3 pb-2" />
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function TranscriptPanel({
  id,
  view,
  transcripts,
}: {
  id: string;
  view: readonly number[];
  transcripts: readonly ComicTranscript[];
}) {
  const headingId = useId();
  const byPage = new Map(transcripts.map((t) => [t.page, t] as const));
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className="rounded-xl border border-border bg-[var(--card)] p-4"
    >
      <h2 id={headingId} className="sr-only">
        Transcript
      </h2>
      <div className="flex flex-col gap-4">
        {view.map((page) => {
          const t = byPage.get(page);
          if (!t) {
            // The other page of a spread, when only one has a transcript.
            return (
              <p key={page} className="text-sm text-sub">
                Page {page} has no transcript yet.
              </p>
            );
          }
          return (
            <article key={page} aria-labelledby={`${headingId}-${page}`} className="min-w-0">
              <h3
                id={`${headingId}-${page}`}
                className="font-mono text-xs uppercase tracking-wide text-sub"
              >
                Page {page}
              </h3>
              {t.alt && <p className="mt-1 break-words text-sm italic text-sub">{t.alt}</p>}
              {t.lines.length > 0 && (
                <div className="mt-2 space-y-1.5 break-words text-sm text-text">
                  {t.lines.map((line, i) => (
                    // Lines have no id of their own, and their order is fixed.
                    <p key={i}>
                      {line.speaker && <span className="font-semibold">{line.speaker}: </span>}
                      {line.text}
                    </p>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
