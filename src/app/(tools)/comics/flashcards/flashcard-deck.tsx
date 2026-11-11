"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, RotateCcw, Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import type { StudyCard } from "@/lib/comics/types";
import { ComicCover } from "../components/comic-card";
import { useSwipe } from "../components/use-swipe";

/** A fresh order, without touching the one it came from. */
function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The stories as flashcards: the title first, then the lesson and the question
 * to ask the team. One at a time, turned with a button, so it reads the same to
 * a screen reader as to everyone else. On a touch screen a sideways swipe on
 * the card moves too. Nothing is kept.
 *
 * The story's first panel stays on both sides of the card, and only the card on
 * screen loads its picture. The title names the story, so the picture has no
 * text of its own.
 */
export function FlashcardDeck({ cards }: { cards: readonly StudyCard[] }) {
  const [deck, setDeck] = useState<readonly StudyCard[]>(cards);
  const [at, setAt] = useState(0);
  const [turned, setTurned] = useState(false);
  const previous = useRef<HTMLButtonElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const pressed = useRef<"previous" | "next" | null>(null);

  // At either end the button just pressed is disabled, which drops its focus:
  // hand it to the other one.
  useEffect(() => {
    const was = pressed.current;
    pressed.current = null;
    if (was === "next" && at === deck.length - 1) previous.current?.focus();
    if (was === "previous" && at === 0) next.current?.focus();
  }, [at, deck.length]);

  const go = (to: number, by?: "previous" | "next") => {
    pressed.current = by ?? null;
    setAt(to);
    setTurned(false);
  };

  // A swipe on the card is a shortcut for a touch screen; the buttons below stay
  // the way for everyone, so focus isn't moved, unless it's on a button the
  // swipe is about to disable (a tapped button keeps focus on Android): then it
  // goes to the other one, as a press would hand it.
  const swipe = useSwipe((step) => {
    const to = at + step;
    if (to < 0 || to >= deck.length) return;
    const focused = document.activeElement;
    go(
      to,
      focused === next.current ? "next" : focused === previous.current ? "previous" : undefined
    );
  });

  const card = deck[at];
  if (!card) return null;

  return (
    <section aria-label="Flashcards" className="max-w-2xl space-y-4">
      <Card {...swipe}>
        <CardContent className="min-h-56 space-y-3 p-6 sm:p-8">
          <Eyebrow>
            Card {at + 1} of {deck.length} · Episode {card.ep}
          </Eyebrow>
          <div
            className={card.cover ? "flex flex-col gap-4 sm:flex-row sm:items-start" : undefined}
          >
            {card.cover ? (
              <div className="w-36 shrink-0 overflow-hidden rounded-md border-2 border-border sm:w-44">
                <ComicCover key={card.ep} cover={card.cover} priority />
              </div>
            ) : null}
            {/* Polite, so turning or moving reads out the card's new side. */}
            <div aria-live="polite" className="min-w-0 space-y-3">
              <h2 className="font-display text-xl font-semibold text-text">{card.title}</h2>
              {turned ? (
                <>
                  <div>
                    <h3 className="font-display font-semibold text-text">The lesson</h3>
                    <p className="mt-1 text-sub">{card.lesson}</p>
                  </div>
                  <div>
                    <h3 className="font-display font-semibold text-text">Ask your team:</h3>
                    <p className="mt-1 text-sub">{card.question}</p>
                  </div>
                </>
              ) : (
                <p className="text-sub">What does this story teach?</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
      {/* On a phone a wrapping row split Previous from Next: there the turn
          button and Shuffle take a row each, with the pair side by side between. */}
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <Button
          type="button"
          variant="toolkit"
          className="col-span-2"
          onClick={() => setTurned((t) => !t)}
        >
          <RotateCcw aria-hidden="true" />
          {turned ? "Back to the title" : "Show the lesson"}
        </Button>
        <Button
          ref={previous}
          type="button"
          variant="outline"
          disabled={at === 0}
          onClick={() => go(at - 1, "previous")}
        >
          <ArrowLeft aria-hidden="true" />
          Previous
        </Button>
        <Button
          ref={next}
          type="button"
          variant="outline"
          disabled={at === deck.length - 1}
          onClick={() => go(at + 1, "next")}
        >
          Next
          <ArrowRight aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="col-span-2"
          onClick={() => {
            setDeck(shuffled(cards));
            go(0);
          }}
        >
          <Shuffle aria-hidden="true" />
          Shuffle
        </Button>
      </div>
    </section>
  );
}
