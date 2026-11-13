"use client";

import { useId, useRef } from "react";
import { CheckCheck, Layers, Shuffle, Star, Undo2, WalletCards } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ToggleGroup } from "@/components/ui/toggle-group";
import {
  CARD_DECK_LIMITS,
  cardKey,
  type Deck,
  type DeckCard,
  type Marks,
  type RoundProgress,
} from "@/lib/card-decks/model";
import { cn } from "@/lib/utils";
import { useFocusAfter } from "../use-focus-after";

const HAND_SIZES = Array.from({ length: CARD_DECK_LIMITS.hand }, (_, i) => i + 1);

/**
 * One dealt card, large, with its star and "used" toggles. Each toggle keeps
 * one name ("Star", "Mark used") and says its state with aria-pressed; the
 * card's text describes both, so a hand of several tells them apart.
 */
export function DealtCard({
  card,
  deckId,
  marks,
  big,
  onToggleStar,
  onToggleUsed,
}: {
  card: DeckCard;
  deckId: string;
  marks: Marks;
  big: boolean;
  onToggleStar: (card: DeckCard) => void;
  onToggleUsed: (card: DeckCard) => void;
}) {
  const key = cardKey(deckId, card.id);
  const starred = marks.starred.has(key);
  const used = marks.used.has(key);
  const textId = useId();
  return (
    <li className={cn("panel space-y-3", big ? "p-5 sm:p-8" : "p-4")}>
      {card.title && <p className="break-words text-sm font-semibold text-accent">{card.title}</p>}
      <p
        id={textId}
        className={cn(
          "break-words font-display font-bold text-text",
          big ? "text-2xl sm:text-3xl" : "text-lg"
        )}
      >
        {card.text}
      </p>
      {card.hint && <p className="break-words text-sm text-sub">{card.hint}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-pressed={starred}
          aria-describedby={textId}
          onClick={() => onToggleStar(card)}
          className={cn("gap-1.5", starred && "border-accent bg-accent/15")}
        >
          <Star
            className={cn("h-4 w-4", starred && "fill-current text-accent")}
            aria-hidden="true"
          />
          Star
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-pressed={used}
          aria-describedby={textId}
          onClick={() => onToggleUsed(card)}
          className={cn("gap-1.5", used && "border-accent bg-accent/15")}
        >
          <CheckCheck className={cn("h-4 w-4", used && "text-accent")} aria-hidden="true" />
          Mark used
        </Button>
        {used && <p className="text-sm text-sub">Used: skipped in later rounds.</p>}
      </div>
    </li>
  );
}

export interface DeckTableProps {
  deck: Deck;
  hand: readonly DeckCard[];
  marks: Marks;
  progress: RoundProgress;
  handSize: number;
  onHandSize: (n: number) => void;
  /** Deals from the starred cards only; null when the deck has none starred. */
  starredOnly: boolean | null;
  onStarredOnly: (on: boolean) => void;
  onDeal: (count: number) => void;
  onBack: () => void;
  onShuffle: () => void;
  canBack: boolean;
  onToggleStar: (card: DeckCard) => void;
  onToggleUsed: (card: DeckCard) => void;
  /** What just happened, said under the controls. */
  status: string | null;
}

/**
 * The table: deal one card or a hand, go back one deal, shuffle for a new
 * round, and the cards dealt last, large. Focus stays on Deal, so dealing
 * again is one more press; the page reads the new cards out. Deal and Back
 * one deal never use `disabled`, which would drop focus to the page on the
 * deal that ends the round: they are aria-disabled, and a press then says
 * why in the status line.
 */
export function DeckTable({
  deck,
  hand,
  marks,
  progress,
  handSize,
  onHandSize,
  starredOnly,
  onStarredOnly,
  onDeal,
  onBack,
  onShuffle,
  canBack,
  onToggleStar,
  onToggleUsed,
  status,
}: DeckTableProps) {
  const done = progress.left === 0;
  const rootRef = useRef<HTMLElement>(null);
  const focusAfter = useFocusAfter(rootRef);
  const { inPlay } = progress;
  const pool = starredOnly
    ? `${inPlay} starred ${inPlay === 1 ? "card" : "cards"}`
    : `${inPlay} ${inPlay === 1 ? "card" : "cards"}`;
  return (
    <section ref={rootRef} aria-labelledby="card-decks-table" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2
          id="card-decks-table"
          tabIndex={-1}
          data-focus-key="table"
          className="rounded-sm font-display text-lg font-bold text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          On the table
        </h2>
        <p className="text-sm text-sub">
          {progress.dealt} of {pool} dealt this round · {progress.left} left
          {progress.setAside > 0 && ` · ${progress.setAside} set aside`}
        </p>
      </div>

      <div className="space-y-3">
        <ToggleGroup
          label="Cards per deal"
          size="sm"
          options={HAND_SIZES.map((n) => ({
            value: n,
            // Words, not a bare digit: a one-digit chip is too narrow to tap.
            label: n === 1 ? "1 card" : `${n} cards`,
          }))}
          value={handSize}
          onValueChange={onHandSize}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="toolkit"
            onClick={() => onDeal(handSize)}
            data-focus-key="deal"
            aria-disabled={done || undefined}
            className={cn("gap-1.5", done && "opacity-60")}
          >
            {handSize === 1 ? (
              <WalletCards className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Layers className="h-4 w-4" aria-hidden="true" />
            )}
            {handSize === 1 ? "Deal a card" : `Deal ${handSize} cards`}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onBack}
            aria-disabled={!canBack || undefined}
            className={cn("gap-1.5", !canBack && "opacity-60")}
          >
            <Undo2 className="h-4 w-4" aria-hidden="true" />
            Back one deal
          </Button>
          <Button type="button" variant="outline" onClick={onShuffle} className="gap-1.5">
            <Shuffle className="h-4 w-4" aria-hidden="true" />
            Shuffle
          </Button>
        </div>
        {starredOnly !== null && (
          <div className="flex items-center gap-2">
            <Switch
              id="card-decks-starred-only"
              checked={starredOnly}
              onCheckedChange={onStarredOnly}
            />
            <Label htmlFor="card-decks-starred-only" className="text-sm text-text">
              Deal from starred cards only
            </Label>
          </div>
        )}
        <p role="status" className={cn("text-sm text-sub", !status && "sr-only")}>
          {status ?? ""}
        </p>
      </div>

      {hand.length > 0 ? (
        <ul
          aria-label={hand.length === 1 ? "The card dealt" : `The ${hand.length} cards dealt`}
          className={cn("gap-3", hand.length === 1 ? "grid" : "grid sm:grid-cols-2")}
        >
          {hand.map((card) => (
            <DealtCard
              key={card.id}
              card={card}
              deckId={deck.id}
              marks={marks}
              big={hand.length === 1}
              onToggleStar={onToggleStar}
              onToggleUsed={onToggleUsed}
            />
          ))}
        </ul>
      ) : progress.total === 0 ? (
        <EmptyState icon={WalletCards}>
          This deck has no cards yet. Add one in the card list below.
        </EmptyState>
      ) : inPlay === 0 ? (
        <EmptyState icon={WalletCards}>
          {starredOnly
            ? "Every starred card in this deck is used or hidden. Bring some back in the card list below, or deal from every card."
            : "Every card in this deck is used or hidden. Bring some back in the card list below."}
        </EmptyState>
      ) : done ? (
        <EmptyState
          icon={Shuffle}
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                // This button goes once the round is new: Deal is next.
                focusAfter("deal");
                onShuffle();
              }}
            >
              Shuffle the deck
            </Button>
          }
        >
          Every card has been dealt this round. Shuffle to start again.
        </EmptyState>
      ) : (
        <EmptyState icon={WalletCards}>
          {`Nothing dealt yet. Deal a card from ${deck.name}, or deal a hand for small groups.`}
        </EmptyState>
      )}
    </section>
  );
}
