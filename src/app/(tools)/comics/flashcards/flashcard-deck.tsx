"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, RotateCcw, Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import type { StudyCard } from "@/lib/comics/types";

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
 * a screen reader as to everyone else. Nothing is kept.
 */
export function FlashcardDeck({ cards }: { cards: readonly StudyCard[] }) {
  const [deck, setDeck] = useState<readonly StudyCard[]>(cards);
  const [at, setAt] = useState(0);
  const [turned, setTurned] = useState(false);
  const card = deck[at];
  if (!card) return null;

  const go = (to: number) => {
    setAt(to);
    setTurned(false);
  };

  return (
    <section aria-label="Flashcards" className="max-w-2xl space-y-4">
      <Card>
        <CardContent className="min-h-56 space-y-3 p-6 sm:p-8">
          <Eyebrow>
            Card {at + 1} of {deck.length} · Episode {card.ep}
          </Eyebrow>
          {/* Polite, so turning or moving reads out the card's new side. */}
          <div aria-live="polite" className="space-y-3">
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
        </CardContent>
      </Card>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="toolkit" onClick={() => setTurned((t) => !t)}>
          <RotateCcw aria-hidden="true" />
          {turned ? "Back to the title" : "Show the lesson"}
        </Button>
        <Button type="button" variant="outline" disabled={at === 0} onClick={() => go(at - 1)}>
          <ArrowLeft aria-hidden="true" />
          Previous
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={at === deck.length - 1}
          onClick={() => go(at + 1)}
        >
          Next
          <ArrowRight aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
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
