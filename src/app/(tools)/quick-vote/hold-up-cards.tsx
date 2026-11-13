"use client";

/**
 * Hold-up cards: Quick Vote with no room and no network. Each person opens
 * this on their own phone, sets up the same format as the facilitator,
 * picks their answer from its cards, and the card fills the screen face
 * down. When the facilitator says "show", everyone taps to flip it and
 * holds the phone up; the facilitator counts (and can type the counts in).
 * Nothing is sent or saved: the card lives in this tab only, so it works
 * offline once the page is open.
 *
 * The feelings wheel picks in two steps here, a core feeling and then a
 * finer word for it. Reduced motion: the card swaps faces without moving.
 * The big text is sized by its longest word, so a word never breaks in the
 * middle on a 375 px phone (only really long typed options wrap anywhere).
 */

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { FEELINGS, feelingCore } from "@/lib/quick-vote/presets";

/** One card: the answer, and the line that says what it means (Roman vote, value poker). */
export interface CardAnswer {
  text: string;
  hint?: string;
}

export interface HoldUpCardsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The format's name, in the title, so a phone set up for another format shows it. */
  formatName: string;
  /** The round's question. */
  title: string;
  /** The answers to pick from, in order (a scale's labels, a poll's options). */
  answers: readonly CardAnswer[];
  /** The feelings wheel: pick a core feeling, then one of its finer words. */
  feelings?: boolean;
}

/**
 * The text a card shows big: a scale's "3: I can go with it" shows "3",
 * then the rest smaller; an option shows its hint smaller, if it has one.
 */
export function cardFace(answer: string, hint?: string): { big: string; small: string | null } {
  const m = /^([^:]{1,6}):\s*(.+)$/.exec(answer);
  return m ? { big: m[1], small: m[2] } : { big: answer, small: hint ?? null };
}

/** The length of the longest word in `text`. */
function longestWord(text: string): number {
  return Math.max(0, ...text.split(/\s+/).map((w) => w.length));
}

/**
 * The picking grid's big text. A card is about 137 px wide inside at
 * 375 px: 24 px type fits nine letters, so a longer word drops to 18 px.
 */
export function gridBigClass(text: string): string {
  return longestWord(text) > 9 ? "text-lg" : "text-2xl";
}

/**
 * The turned-over card's big text. The card is about 283 px wide inside at
 * 375 px: 60 px type fits six letters, 48 px ten, 36 px fourteen; anything
 * longer is typed text, set smaller and allowed to wrap anywhere.
 */
export function faceBigClass(text: string): string {
  const n = longestWord(text);
  if (n <= 6) return "text-6xl sm:text-8xl";
  if (n <= 10) return "text-5xl sm:text-7xl";
  if (n <= 14) return "text-4xl sm:text-6xl";
  return "text-3xl [overflow-wrap:anywhere] sm:text-5xl";
}

export function HoldUpCards({
  open,
  onOpenChange,
  formatName,
  title,
  answers,
  feelings = false,
}: HoldUpCardsProps) {
  const [core, setCore] = useState<string | null>(null);
  const [picked, setPicked] = useState<CardAnswer | null>(null);
  const [shown, setShown] = useState(false);
  const cardRef = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // A fresh pick every time the cards open.
  useEffect(() => {
    if (!open) return;
    setCore(null);
    setPicked(null);
    setShown(false);
  }, [open]);

  // The control that had focus went away: the card, or the grid, takes it.
  useEffect(() => {
    if (picked) cardRef.current?.focus();
  }, [picked]);

  const focusGrid = () =>
    requestAnimationFrame(() => gridRef.current?.querySelector("button")?.focus());

  const coreWords = feelingCore(core)?.finer;
  const choices: readonly CardAnswer[] = feelings
    ? (coreWords ?? FEELINGS.map((f) => f.core)).map((text) => ({ text }))
    : answers;
  const face = picked ? cardFace(picked.text, picked.hint) : null;

  const pick = (answer: CardAnswer) => {
    if (feelings && !coreWords) {
      setCore(answer.text);
      focusGrid();
      return;
    }
    setPicked(answer);
    setShown(false);
  };

  const back = () => {
    setPicked(null);
    setShown(false);
    focusGrid();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // Edge to edge, inside the notch and the home indicator (the site
        // draws under them: viewport-fit=cover).
        className="bottom-0 left-0 right-0 top-0 h-full max-h-none w-full max-w-none translate-x-0 translate-y-0 rounded-none pb-safe pt-safe px-safe"
        closeClassName="right-[calc(0.75rem+env(safe-area-inset-right))] top-[calc(0.75rem+env(safe-area-inset-top))] sm:right-[calc(1rem+env(safe-area-inset-right))] sm:top-[calc(1rem+env(safe-area-inset-top))]"
        bodyClassName="content-start"
      >
        <div className="space-y-1 pr-10">
          <DialogTitle>Hold-up cards: {formatName}</DialogTitle>
          <DialogDescription className="text-sub">
            {picked
              ? "Keep it face down. When the facilitator says show, tap the card and hold your phone up."
              : feelings && !coreWords
                ? `${title} Pick a core feeling first.`
                : feelings
                  ? `Now pick the word that fits your ${core?.toLowerCase()} feeling best.`
                  : `${title} Pick your card.`}
          </DialogDescription>
        </div>

        {/* Inside the dialog: the page behind it is hidden from screen readers. */}
        <p role="status" className="sr-only">
          {picked ? (shown ? `Shown: ${picked.text}.` : "Face down.") : ""}
        </p>

        {face && picked ? (
          <div className="flex min-h-0 flex-col items-stretch gap-3">
            <button
              ref={cardRef}
              type="button"
              aria-label={
                shown
                  ? `Your card: ${picked.text}. Tap to turn it face down.`
                  : "Your card, face down. Tap to show it."
              }
              onClick={() => setShown((s) => !s)}
              className={cn(
                "flex min-h-[60dvh] w-full min-w-0 flex-col items-center justify-center gap-4 rounded-2xl border-4 border-text p-6 text-center shadow-sm focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring",
                shown ? "bg-card text-text" : "bg-accent/10 text-text"
              )}
            >
              {shown ? (
                <span
                  key="up"
                  className="flex max-w-full flex-col items-center gap-3 motion-safe:animate-in motion-safe:zoom-in-95"
                >
                  <span
                    className={cn(
                      "max-w-full break-normal font-display font-bold leading-none",
                      faceBigClass(face.big)
                    )}
                  >
                    {face.big}
                  </span>
                  {face.small && (
                    <span className="max-w-full break-words text-2xl font-semibold sm:text-4xl">
                      {face.small}
                    </span>
                  )}
                </span>
              ) : (
                <span
                  key="down"
                  className="flex flex-col items-center gap-3 motion-safe:animate-in motion-safe:fade-in-0"
                >
                  <span aria-hidden="true" className="font-display text-7xl font-bold leading-none">
                    ?
                  </span>
                  <span className="text-xl font-semibold">Tap to show</span>
                </span>
              )}
            </button>
            <div className="flex flex-wrap justify-center gap-2">
              {shown && (
                <Button
                  type="button"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => setShown(false)}
                >
                  <EyeOff aria-hidden="true" />
                  Face down
                </Button>
              )}
              <Button type="button" variant="ghost" className="gap-1.5" onClick={back}>
                <ArrowLeft aria-hidden="true" />
                Pick another card
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {feelings && coreWords && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  // This button goes with the step: the first core feeling takes focus.
                  setCore(null);
                  focusGrid();
                }}
              >
                <ArrowLeft aria-hidden="true" />
                All core feelings
              </Button>
            )}
            <div
              ref={gridRef}
              role="group"
              aria-label="Cards"
              className="grid grid-cols-2 gap-3 sm:grid-cols-3"
            >
              {choices.map((answer) => {
                const f = cardFace(answer.text, answer.hint);
                return (
                  <Button
                    key={answer.text}
                    type="button"
                    variant="outline"
                    onClick={() => pick(answer)}
                    // The default size is 36 px tall on a desktop with a mouse: md-fine:h-auto lifts it, and
                    // md:min-h-24 (a screen variant, sorted after md-fine:min-h-9) keeps the card size.
                    className="h-auto min-h-24 min-w-0 flex-col gap-1 whitespace-normal p-3 text-center md-fine:h-auto md:min-h-24"
                  >
                    <span
                      className={cn(
                        "max-w-full font-display font-bold [overflow-wrap:anywhere]",
                        gridBigClass(f.big)
                      )}
                    >
                      {f.big}
                    </span>
                    {f.small && (
                      <span className="max-w-full text-xs font-normal text-sub [overflow-wrap:anywhere]">
                        {f.small}
                      </span>
                    )}
                  </Button>
                );
              })}
            </div>
            <p className="text-xs text-sub">
              Nothing leaves this phone: the card is only on your screen, and it works without a
              network once this page is open.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
