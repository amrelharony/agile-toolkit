"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight, History, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { usePersistedLocal } from "@/lib/utils/use-persisted";
import { emit } from "@/lib/sonification/emit";
import { COMIC_ID, COMIC_LAYOUT_KEY, COMIC_TITLE } from "@/lib/comic/agile-at-work";
import type { ComicContent } from "@/lib/comic/content";
import { resumablePage } from "@/lib/comic/last-page";
import {
  clampPage,
  fitScale,
  nextView,
  pageHash,
  pageLabel,
  parsePageHash,
  prefetchPages,
  prevView,
  readerKeyAction,
  shouldUseSpread,
  viewFor,
  widthBucket,
  type ReaderKeyAction,
} from "@/lib/comic/reader-math";
import { cn } from "@/lib/utils";
import { usePdfDocument, type PdfDocumentState } from "../hooks/use-pdf-document";
import { useRenderedPages } from "../hooks/use-rendered-page";
import { usePageSwipe, useIsZoomed, useSettledZoom } from "../hooks/use-page-swipe";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import { useInertSiblings } from "@/hooks/use-inert-siblings";
import { useFullscreen } from "../hooks/use-fullscreen";
import { useElementSize } from "../hooks/use-element-size";
import { useLastPage } from "../hooks/use-last-page";
import { useLiveLabel, useReaderComic } from "../hooks/use-comic-content";
import { ReaderToolbar, type LayoutMode } from "./reader-toolbar";
import { ComicComingSoon, ComicErrorPanel } from "./comic-status";
import { ReaderPanels } from "./reader-panels";
import { PageDescriptions } from "./page-descriptions";
import { ChapterToolsCard } from "./chapter-tools";

const LAYOUT_MODES: readonly LayoutMode[] = ["auto", "single", "spread"];
/** Space between the stage edge and the pages (includes the 1 px border). */
const STAGE_PAD = 12;
/** Gutter between the two pages of a spread. */
const SPREAD_GAP = 4;
/** Comic pages are usually 2:3 portrait; used until page 1 is measured. */
const DEFAULT_ASPECT = 2 / 3;

// Fixed height so nothing below jumps when page 1 arrives, sized so the
// header, title and toolbar still fit on screen: ~17rem of chrome when the
// toolbar is one row (xl, next to the sidebar), ~19rem when it wraps.
// 100vh first: browsers without dvh (Safari < 15.4) would drop the height.
const STAGE_HEIGHT = [
  "min-h-[420px] h-[calc(100vh-19rem)] supports-[height:100dvh]:h-[calc(100dvh-19rem)]",
  "xl:h-[calc(100vh-17rem)] xl:supports-[height:100dvh]:h-[calc(100dvh-17rem)]",
].join(" ");

/** Largest w × h (CSS px) of the given aspect ratio that fits the box. */
function containSize(aspect: number, boxW: number, boxH: number): { w: number; h: number } {
  if (!(aspect > 0) || !(boxW > 0) || !(boxH > 0)) return { w: 0, h: 0 };
  const h = Math.min(boxH, boxW / aspect);
  return { w: Math.floor(h * aspect), h: Math.floor(h) };
}

/**
 * The "Agile at Work" reader: opens the PDF, then hands a loading or ready
 * document to the view. A missing file falls back to "coming soon"; any
 * other failure shows Retry + Download.
 *
 * `content` (transcripts and chapters) defaults to the shipped file,
 * lib/comic/agile-at-work-content.ts, loaded on demand.
 */
export function ComicReader({
  src,
  size,
  content,
}: {
  src: string;
  size: number | null;
  content?: ComicContent;
}) {
  const pdf = usePdfDocument(src);
  if (pdf.status === "error") {
    if (pdf.kind === "missing") return <ComicComingSoon />;
    return <ComicErrorPanel kind={pdf.kind} onRetry={pdf.retry} src={src} size={size} />;
  }
  // Same element for loading and ready, so the stage never remounts.
  return <ReaderView pdf={pdf} src={src} size={size} content={content} />;
}

function ReaderView({
  pdf,
  src,
  size,
  content,
}: {
  pdf: Exclude<PdfDocumentState, { status: "error" }>;
  src: string;
  size: number | null;
  content: ComicContent | undefined;
}) {
  const doc = pdf.status === "ready" ? pdf.doc : null;
  const numPages = pdf.status === "ready" ? pdf.numPages : 0;
  const pageSize = pdf.status === "ready" ? pdf.pageSize : null;
  const aspect = pageSize ? pageSize.width / pageSize.height : DEFAULT_ASPECT;

  // ── Elements ─────────────────────────────────────────────────────────
  // The frame (stage + toolbar) is the fullscreen element. In the
  // immersive overlay it re-mounts inside a portal, so the stage is held
  // in state as well as a ref: size and swipe hooks must follow it.
  const frameRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null);
  const setStage = useCallback((el: HTMLDivElement | null) => {
    stageRef.current = el;
    setStageEl(el);
  }, []);
  const dialogRef = useRef<HTMLDivElement>(null);
  const fullscreenButtonRef = useRef<HTMLButtonElement>(null);
  const resumeChipRef = useRef<HTMLDivElement>(null);
  const hintId = useId();

  // ── Layout ───────────────────────────────────────────────────────────
  const [storedMode, setMode] = usePersistedLocal<LayoutMode>(COMIC_LAYOUT_KEY, "auto");
  const mode: LayoutMode = LAYOUT_MODES.includes(storedMode) ? storedMode : "auto";
  const stage = useElementSize(stageEl);
  const innerW = Math.max(0, stage.width - 2 * STAGE_PAD);
  const innerH = Math.max(0, stage.height - 2 * STAGE_PAD);
  const spread = mode === "spread" || (mode === "auto" && shouldUseSpread(innerW, innerH, aspect));

  // ── Page state ───────────────────────────────────────────────────────
  // `page` anchors the view; switching layout recomputes the view around
  // it, so the page being read always stays on screen.
  const [page, setPage] = useState(1);
  const total = Math.max(1, numPages);
  const view = useMemo(() => viewFor(page, total, spread), [page, total, spread]);
  const viewKey = view.join("-");
  const atStart = view[0] <= 1;
  const atEnd = view[view.length - 1] >= total;
  const [resumePage, setResumePage] = useState<number | null>(null);
  const [savedPage, saveLastPage] = useLastPage();
  const [hashReady, setHashReady] = useState(false);
  const navigatedRef = useRef(false);
  const comic = useReaderComic({ content, numPages, view });

  const goTo = useCallback(
    (target: number) => {
      const next = clampPage(target, numPages);
      // No-op at either end (or on the current page): the resume chip
      // stays, and nothing is recorded as a navigation.
      if (!numPages || next === page) return;
      navigatedRef.current = true;
      // The resume chip disappears on navigation; don't strand focus on it.
      if (resumeChipRef.current?.contains(document.activeElement)) stageRef.current?.focus();
      setResumePage(null);
      setPage(next);
    },
    [numPages, page]
  );
  const goNext = useCallback(() => {
    if (!atEnd) goTo(nextView(page, total, spread)[0]);
  }, [atEnd, goTo, page, total, spread]);
  const goPrev = useCallback(() => {
    if (!atStart) goTo(prevView(page, total, spread)[0]);
  }, [atStart, goTo, page, total, spread]);
  // From the contents: the chosen entry closes, so focus goes to the stage.
  const jumpTo = useCallback(
    (target: number) => {
      goTo(target);
      stageRef.current?.focus();
    },
    [goTo]
  );

  // ── Deep link (#page=N) and resume ───────────────────────────────────
  useEffect(() => {
    if (!numPages || hashReady) return;
    const fromHash = parsePageHash(window.location.hash, numPages);
    if (fromHash !== null) {
      navigatedRef.current = true;
      setPage(fromHash);
    } else {
      // Offer, don't jump: a fresh visit should open on the cover. The saved
      // page is read in a mount effect, which runs before the PDF can open.
      const saved = resumablePage(savedPage, numPages);
      if (saved !== null) setResumePage(saved);
    }
    setHashReady(true);
  }, [numPages, hashReady, savedPage]);

  useEffect(() => {
    if (!hashReady) return;
    const hash = pageHash(page);
    const current = window.location.hash;
    // Keep the URL clean on the cover unless a hash is already there.
    if (current === hash || (page === 1 && current === "")) return;
    try {
      // `null`, not history.state: Next's patched replaceState then copies
      // its own entry state over AND records the new URL, so a later router
      // update can't rewrite the address back to a stale hash. replaceState
      // never fires hashchange, so this can't loop with the listener below.
      window.history.replaceState(null, "", hash);
    } catch {
      // Sandboxed iframe or a throttled replaceState — the hash is a nicety.
    }
  }, [page, hashReady]);

  useEffect(() => {
    if (!hashReady) return;
    const onHashChange = () => {
      const target = parsePageHash(window.location.hash, numPages);
      if (target !== null) goTo(target);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [hashReady, numPages, goTo]);

  useEffect(() => {
    if (!navigatedRef.current || !numPages) return;
    const timer = setTimeout(() => saveLastPage(page), 500);
    return () => clearTimeout(timer);
  }, [page, numPages, saveLastPage]);

  // Gamification hook (tool:agile-at-work:finished), once per visit.
  const finishedRef = useRef(false);
  useEffect(() => {
    if (!numPages || finishedRef.current || !navigatedRef.current || !atEnd) return;
    finishedRef.current = true;
    emit(COMIC_ID, "finished");
  }, [numPages, atEnd]);

  // ── Rendering ────────────────────────────────────────────────────────
  const boxW = spread ? (innerW - SPREAD_GAP) / 2 : innerW;
  const slot = containSize(aspect, boxW, innerH);
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const zoom = useSettledZoom();
  const fit = pageSize
    ? { pageW: pageSize.width, pageH: pageSize.height, boxW, boxH: innerH, dpr }
    : null;
  // Pinch-zoomed, the pages on screen re-render for the zoom so lettering
  // stays sharp; neighbours prefetch at the zoomed-out size.
  const bucket = fit ? widthBucket(fit.pageW * fitScale({ ...fit, zoom })) : 0;
  const prefetchBucket = fit ? widthBucket(fit.pageW * fitScale(fit)) : 0;
  const prefetch = useMemo(
    () => (numPages ? prefetchPages(page, numPages, spread) : []),
    [page, numPages, spread]
  );
  const { urls, failed, retry } = useRenderedPages({
    doc,
    visible: view,
    prefetch,
    bucket,
    prefetchBucket,
  });
  const [firstShown, setFirstShown] = useState(false);
  const reducedMotion = useReducedMotion();

  // ── Input ────────────────────────────────────────────────────────────
  const { isFullscreen, immersive, toggle, exitImmersive } = useFullscreen(frameRef);
  const zoomed = useIsZoomed();
  const { recentlySwiped } = usePageSwipe(stageEl, {
    onSwipeLeft: goNext,
    onSwipeRight: goPrev,
    enabled: numPages > 0 && !zoomed,
  });

  // One window listener for the whole reader; the latest state is read
  // through a ref so the listener never needs re-binding.
  const keyState = { isFullscreen, immersive, goNext, goPrev, goTo, toggle, exitImmersive, total };
  const keyStateRef = useRef(keyState);
  keyStateRef.current = keyState;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const s = keyStateRef.current;
      const stageNode = stageRef.current;
      const active = document.activeElement;
      const action: ReaderKeyAction | null = readerKeyAction(e, {
        focused: Boolean(stageNode && active && stageNode.contains(active)),
        fullscreen: s.isFullscreen,
        boundary: frameRef.current,
      });
      if (!action || (action === "exit-immersive" && !s.immersive)) return;
      e.preventDefault();
      switch (action) {
        case "prev":
          return s.goPrev();
        case "next":
          return s.goNext();
        case "first":
          return s.goTo(1);
        case "last":
          return s.goTo(s.total);
        case "toggle-fullscreen":
          return s.toggle();
        case "exit-immersive":
          return s.exitImmersive();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // ── Immersive overlay (no Fullscreen API, e.g. iPhone) ───────────────
  useBodyScrollLock(immersive);
  useInertSiblings(dialogRef, immersive);
  useFocusTrap(dialogRef, { active: immersive, initialFocusRef: stageRef });
  // The toggle that opened the overlay was unmounted with the inline
  // frame; on close, land on its replacement rather than <body>.
  const wasImmersiveRef = useRef(false);
  useEffect(() => {
    if (wasImmersiveRef.current && !immersive) fullscreenButtonRef.current?.focus();
    wasImmersiveRef.current = immersive;
  }, [immersive]);

  // ── View ─────────────────────────────────────────────────────────────
  const label = numPages ? pageLabel(view, numPages) : "";
  const liveLabel = useLiveLabel(label, comic.chapter);
  const loadProgress = pdf.status === "loading" ? 5 + Math.round(70 * (pdf.progress ?? 0)) : 85;
  // Off while a page shows its "Try again" button, which a zone could cover.
  const tapZonesOn = numPages > 0 && !zoomed && failed.size === 0;

  const frame = (
    <div
      ref={frameRef}
      className={cn(
        "flex flex-col",
        isFullscreen
          ? "h-full w-full gap-2 bg-bg pb-[max(0.5rem,env(safe-area-inset-bottom))] pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))] pt-[max(0.5rem,env(safe-area-inset-top))]"
          : "gap-3"
      )}
    >
      <div
        ref={setStage}
        tabIndex={0}
        role="region"
        aria-roledescription="comic reader"
        aria-label={`${COMIC_TITLE} comic`}
        aria-describedby={hintId}
        className={cn(
          "relative select-none overflow-hidden rounded-xl border border-border bg-bg2",
          "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
          isFullscreen ? "min-h-0 flex-1" : STAGE_HEIGHT
        )}
        // Vertical scroll and pinch-zoom stay with the browser; horizontal
        // drags are ours (page swipes).
        style={{ touchAction: "pan-y pinch-zoom" }}
      >
        <p id={hintId} className="sr-only">
          Use the left and right arrow keys to turn pages. While the reader has focus, Home and End
          jump to the first and last page, and F toggles fullscreen.
        </p>

        <AnimatePresence initial={false}>
          <motion.div
            key={viewKey}
            className="absolute inset-0 flex items-center justify-center"
            style={{ padding: STAGE_PAD, gap: SPREAD_GAP }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.15, ease: "easeOut" }}
          >
            {view.map((p, i) => {
              const url = urls.get(p);
              // Spread pages meet at the gutter; lone pages centre.
              const align =
                view.length === 2 ? (i === 0 ? "object-right" : "object-left") : "object-center";
              return (
                <div
                  key={p}
                  className="relative flex shrink-0 items-center justify-center"
                  style={{ width: slot.w, height: slot.h }}
                >
                  {url ? (
                    // Blob URLs from pdf.js renders: next/image can't optimise them.
                    // onLoad is a load event, not a user interaction.
                    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/no-noninteractive-element-interactions
                    <img
                      src={url}
                      alt={comic.alt(p)}
                      aria-describedby={comic.descriptionId(p)}
                      decoding="async"
                      draggable={false}
                      onLoad={() => setFirstShown(true)}
                      className={cn("h-full w-full object-contain", align)}
                    />
                  ) : failed.has(p) ? (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-sm border border-border bg-[var(--card)] p-3 text-center text-sm text-sub">
                      <p>Page {p} didn&apos;t load.</p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          // The button unmounts (skeleton) on retry: keep focus
                          // in the reader rather than dropping it to <body>.
                          stageRef.current?.focus();
                          retry(p);
                        }}
                      >
                        <RotateCcw aria-hidden="true" />
                        Try again
                      </Button>
                    </div>
                  ) : (
                    // Skeleton. --border is a faint tint in every theme (bg2
                    // and surface are both white in the light theme).
                    <div
                      aria-hidden="true"
                      className="h-full w-full rounded-sm bg-[var(--border)] motion-safe:animate-pulse"
                    />
                  )}
                </div>
              );
            })}
          </motion.div>
        </AnimatePresence>
        <PageDescriptions comic={comic} />

        {/* Tap zones: left/right 30% turn pages. Hidden from AT — the toolbar
            buttons and arrow keys are the accessible route. Off while
            pinch-zoomed so panning around a panel never flips the page. */}
        {tapZonesOn && (
          <>
            <div
              aria-hidden="true"
              onClick={() => !recentlySwiped() && goPrev()}
              className={cn(
                "group/prev absolute inset-y-0 left-0 z-[2] flex w-[30%] items-center justify-start pl-2",
                atStart ? "cursor-default" : "cursor-w-resize"
              )}
            >
              {!atStart && (
                <ChevronLeft className="h-8 w-8 rounded-full bg-[var(--card)] p-1 text-text opacity-0 shadow transition-opacity [@media(hover:hover)]:group-hover/prev:opacity-80" />
              )}
            </div>
            <div
              aria-hidden="true"
              onClick={() => !recentlySwiped() && goNext()}
              className={cn(
                "group/next absolute inset-y-0 right-0 z-[2] flex w-[30%] items-center justify-end pr-2",
                atEnd ? "cursor-default" : "cursor-e-resize"
              )}
            >
              {!atEnd && (
                <ChevronRight className="h-8 w-8 rounded-full bg-[var(--card)] p-1 text-text opacity-0 shadow transition-opacity [@media(hover:hover)]:group-hover/next:opacity-80" />
              )}
            </div>
          </>
        )}

        {resumePage !== null && page === 1 && (
          <div
            ref={resumeChipRef}
            className="absolute left-1/2 top-3 z-[3] flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-[var(--card)] p-1 shadow-lg backdrop-blur"
          >
            <Button
              variant="toolkit"
              size="sm"
              className="rounded-full"
              onClick={() => goTo(resumePage)}
            >
              <History aria-hidden="true" />
              Continue from p. {resumePage}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full md:h-9 md:w-9"
              onClick={() => {
                // The chip unmounts: hand focus to the stage, as goTo does.
                stageRef.current?.focus();
                setResumePage(null);
              }}
              aria-label="Dismiss, start from the cover"
              title="Start from the cover"
            >
              <X aria-hidden="true" />
            </Button>
          </div>
        )}

        {!firstShown && failed.size === 0 && (
          <div className="absolute inset-x-0 bottom-0 z-[3] flex flex-col items-center gap-2 p-4">
            <p className="font-mono text-xs text-sub">Opening the comic…</p>
            <Progress
              value={loadProgress}
              aria-label="Loading the comic"
              className="h-1.5 max-w-xs"
            />
          </div>
        )}

        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {liveLabel}
        </p>
      </div>

      <ReaderToolbar
        ref={fullscreenButtonRef}
        numPages={numPages}
        view={view}
        spread={spread}
        onPrev={goPrev}
        onNext={goNext}
        onGoTo={goTo}
        mode={mode}
        onModeChange={setMode}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggle}
        src={src}
        size={size}
      />
      <ReaderPanels
        comic={comic}
        view={view}
        numPages={numPages}
        isFullscreen={isFullscreen}
        onJump={jumpTo}
      />
      {!isFullscreen && <ChapterToolsCard chapter={comic.chapter} />}
    </div>
  );

  if (!immersive) return frame;

  return (
    <>
      {/* Holds the frame's place under the overlay so the page doesn't jump. */}
      <div aria-hidden="true" className={cn("rounded-xl bg-bg2", STAGE_HEIGHT)} />
      {createPortal(
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={`${COMIC_TITLE} reader`}
          className="fixed inset-0 z-modal bg-bg"
        >
          {frame}
        </div>,
        document.body
      )}
    </>
  );
}
