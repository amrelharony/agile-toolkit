"use client";

/**
 * Hold-up cards: Quick Vote with no room and no network. Each person opens
 * this on their own phone, picks their answer from the format's cards, and
 * the card fills the screen face down. When the facilitator says "show",
 * everyone taps to flip it and holds the phone up; the facilitator counts
 * (and can type the counts in). Nothing is sent or saved: the card lives
 * in this tab only, so it works offline once the page is open.
 *
 * The feelings wheel picks in two steps here, a core feeling and then a
 * finer word for it. Reduced motion: the card swaps faces without moving.
 */

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { FEELINGS, feelingCore } from "@/lib/quick-vote/presets";

export interface HoldUpCardsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The round's question. */
  title: string;
  /** The answers to pick from, in order (a scale's labels, a poll's options). */
  answers: readonly string[];
  /** The feelings wheel: pick a core feeling, then one of its finer words. */
  feelings?: boolean;
}

/** The text a card shows big: a scale's "3: I can go with it" shows "3", then the rest smaller. */
export function cardFace(answer: string): { big: string; small: string | null } {
  const m = /^([^:]{1,6}):\s*(.+)$/.exec(answer);
  return m ? { big: m[1], small: m[2] } : { big: answer, small: null };
}

export function HoldUpCards({
  open,
  onOpenChange,
  title,
  answers,
  feelings = false,
}: HoldUpCardsProps) {
  const [core, setCore] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
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

  const coreWords = feelingCore(core)?.finer;
  const choices: readonly string[] = feelings
    ? (coreWords ?? FEELINGS.map((f) => f.core))
    : answers;
  const face = picked ? cardFace(picked) : null;

  const pick = (answer: string) => {
    if (feelings && !coreWords) {
      setCore(answer);
      requestAnimationFrame(() => gridRef.current?.querySelector("button")?.focus());
      return;
    }
    setPicked(answer);
    setShown(false);
  };

  const back = () => {
    setPicked(null);
    setShown(false);
    requestAnimationFrame(() => gridRef.current?.querySelector("button")?.focus());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="bottom-0 left-0 right-0 top-0 h-full max-h-none w-full max-w-none translate-x-0 translate-y-0 rounded-none"
        bodyClassName="content-start"
      >
        <div className="space-y-1 pr-10">
          <DialogTitle>Hold-up cards</DialogTitle>
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

        {face ? (
          <div className="flex min-h-0 flex-col items-stretch gap-3">
            <button
              ref={cardRef}
              type="button"
              aria-pressed={shown}
              aria-label={
                shown
                  ? `Your card: ${picked}. Tap to turn it face down.`
                  : "Your card, face down. Tap to show it."
              }
              onClick={() => setShown((s) => !s)}
              className={cn(
                "flex min-h-[60dvh] w-full flex-col items-center justify-center gap-4 rounded-2xl border-4 border-text p-6 text-center shadow-sm focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring",
                shown ? "bg-card text-text" : "bg-accent/10 text-text"
              )}
            >
              {shown ? (
                <span
                  key="up"
                  className="flex flex-col items-center gap-3 motion-safe:animate-in motion-safe:zoom-in-95"
                >
                  <span
                    className={cn(
                      "break-words font-display font-bold leading-none",
                      face.big.length > 10 ? "text-4xl sm:text-6xl" : "text-6xl sm:text-8xl"
                    )}
                  >
                    {face.big}
                  </span>
                  {face.small && (
                    <span className="break-words text-2xl font-semibold sm:text-4xl">
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
                onClick={() => setCore(null)}
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
                const f = cardFace(answer);
                return (
                  <Button
                    key={answer}
                    type="button"
                    variant="outline"
                    onClick={() => pick(answer)}
                    className="h-auto min-h-24 flex-col gap-1 whitespace-normal p-3 text-center"
                  >
                    <span className="font-display text-2xl font-bold">{f.big}</span>
                    {f.small && <span className="text-xs font-normal text-sub">{f.small}</span>}
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
