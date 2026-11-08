"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { StoryGuess } from "@/lib/comics/guess";
import { panelImageUrl } from "@/lib/comics/images";
import type { Panel } from "@/lib/comics/types";
import { PanelOverlay } from "./panel-overlay";
import { PanelTranscript } from "./panel-transcript";
import {
  GUESS_NOSCRIPT,
  GuessCover,
  GuessQuestion,
  GuessResults,
  useStoryGuess,
} from "./story-guess";

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * A story's panels, stacked on a phone. Every page gets the 768 px file, and
 * there is no srcset on purpose: a 3x phone would pick the 1536 px one, and on
 * the free tier that download allowance is shared with sign-in and sync.
 *
 * The transcript is always in the page, because the speech is baked into the
 * art and a screen reader can't get it any other way. The button only shows it
 * to everyone else.
 *
 * With a guess, the last panel waits under a cover of its own size while the
 * reader picks what happens next (story-guess). Its picture still loads with the
 * page, behind the cover, so it's there the moment they choose. Until then its
 * description and transcript stay out of the page and out of full screen, or a
 * screen reader would give the ending away.
 */
export function ComicPanels({
  panels,
  title,
  ep = 0,
  guess = null,
}: {
  panels: readonly Panel[];
  title: string;
  ep?: number;
  guess?: StoryGuess | null;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const close = useCallback(() => setOpen(null), []);
  // A guess needs a panel to hide and at least one to read first.
  const active = guess && panels.length >= 2 ? guess : null;
  const state = useStoryGuess(ep, active);
  const hidden = active && !state.revealed ? panels.length - 1 : null;
  const last = useRef<HTMLElement>(null);
  const chose = useRef(false);

  // Only after the reader's own choice: a reader coming back isn't moved anywhere.
  useEffect(() => {
    if (!state.revealed || !chose.current) return;
    chose.current = false;
    last.current?.focus({ preventScroll: true });
    last.current?.scrollIntoView?.({
      block: "nearest",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }, [state.revealed]);

  if (panels.length === 0) return null;
  const shown = hidden === null ? panels : panels.slice(0, hidden);
  const guessState = {
    ...state,
    choose: (option: number) => {
      chose.current = true;
      state.choose(option);
    },
    skip: () => {
      chose.current = true;
      state.skip();
    },
  };

  return (
    <>
      <section aria-label="Comic panels" className="space-y-3">
        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={() => setShowTranscript((v) => !v)}>
            {showTranscript ? "Hide transcript" : "Show transcript"}
          </Button>
        </div>
        {active ? <noscript dangerouslySetInnerHTML={{ __html: GUESS_NOSCRIPT }} /> : null}
        <ol className="grid list-none gap-3 sm:grid-cols-2">
          {panels.map((panel, i) => {
            const isLast = active !== null && i === panels.length - 1;
            const captionId = `panel-${ep}-${i}-caption`;
            const image = (
              // Plain <img>: the optimiser would add another copy of every
              // panel to the download bill, and the real size stops the page
              // jumping as each one loads.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={panelImageUrl(panel.pathSmall)}
                width={panel.width}
                height={panel.height}
                alt={i === hidden ? "" : panel.alt}
                loading="lazy"
                decoding="async"
                className="h-auto w-full"
              />
            );
            return (
              <li key={panel.pathSmall}>
                <figure
                  ref={isLast ? last : undefined}
                  tabIndex={isLast ? -1 : undefined}
                  aria-labelledby={isLast && i !== hidden ? captionId : undefined}
                  // Scrolled to on a reveal: it stops below the sticky header
                  // (on a phone, html's scroll padding adds Amr's space too),
                  // so the speech at the top of the panel isn't under it.
                  className="scroll-mt-[calc(var(--header-h,56px)+0.5rem)] focus-visible:outline-none"
                >
                  {i === hidden ? (
                    <div className="panel relative block w-full overflow-hidden">
                      {image}
                      <GuessCover panelNumber={i + 1} />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setOpen(i)}
                      aria-label={`Open panel ${i + 1} of ${panels.length} full screen`}
                      className="panel block w-full overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {image}
                    </button>
                  )}
                  {i === hidden ? null : (
                    <figcaption
                      id={captionId}
                      className={showTranscript ? "mt-2 space-y-1 text-sm text-sub" : "sr-only"}
                    >
                      <PanelTranscript panel={panel} />
                    </figcaption>
                  )}
                </figure>
              </li>
            );
          })}
        </ol>
        {open !== null && shown[open] ? (
          <PanelOverlay
            panels={shown}
            index={open}
            title={title}
            onClose={close}
            onMove={setOpen}
          />
        ) : null}
      </section>
      {active && hidden !== null ? (
        <GuessQuestion ep={ep} guess={active} panelNumber={hidden + 1} state={guessState} />
      ) : null}
      {active && state.revealed ? <GuessResults ep={ep} guess={active} state={state} /> : null}
    </>
  );
}
