"use client";

import { useState } from "react";
import { CheckCheck, Eye, EyeOff, Plus, RotateCcw, Star, Trash2 } from "lucide-react";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { ToggleGroup } from "@/components/ui/toggle-group";
import {
  CARD_DECK_LIMITS,
  cardKey,
  validateCardDraft,
  type CardDraft,
  type Deck,
  type DeckCard,
  type Marks,
} from "@/lib/card-decks/model";
import { cn } from "@/lib/utils";

type Filter = "all" | "starred" | "used" | "hidden";

function AddCardForm({ deck, onAdd }: { deck: Deck; onAdd: (text: string) => void }) {
  const form = useItemForm<CardDraft, { text: string }, "text">({
    initial: { text: "" },
    validate: (draft) => validateCardDraft(draft, deck),
    onSave: ({ text }) => onAdd(text),
  });
  return (
    <ItemForm
      form={form}
      submitLabel="Add the card"
      submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
    >
      <Field
        label={`New card for ${deck.name}`}
        hint={`Up to ${CARD_DECK_LIMITS.cardText} characters.`}
        error={form.errors.text}
      >
        {(props) => (
          <Input
            {...props}
            value={form.draft.text}
            maxLength={CARD_DECK_LIMITS.cardText + 40}
            onChange={(e) => form.update({ text: e.target.value })}
            placeholder="What would you like the team to try next?"
          />
        )}
      </Field>
    </ItemForm>
  );
}

/**
 * Every card in the deck on the table, with its marks: star it, mark it
 * used (skipped in later rounds), hide it (never dealt), or, in the team's
 * own deck, remove it (with Undo) and add new ones.
 */
export function DeckBrowser({
  deck,
  marks,
  dealtThisRound,
  onToggleStar,
  onToggleUsed,
  onToggleHidden,
  onBringBackUsed,
  onAddCard,
  onRemoveCard,
}: {
  deck: Deck;
  marks: Marks;
  dealtThisRound: ReadonlySet<string>;
  onToggleStar: (card: DeckCard) => void;
  onToggleUsed: (card: DeckCard) => void;
  onToggleHidden: (card: DeckCard) => void;
  onBringBackUsed: () => void;
  onAddCard: (text: string) => void;
  onRemoveCard: (card: DeckCard) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const own = deck.source === "custom";
  const has = (set: ReadonlySet<string>, c: DeckCard) => set.has(cardKey(deck.id, c.id));
  const count = (set: ReadonlySet<string>) => deck.cards.filter((c) => has(set, c)).length;
  const counts = {
    all: deck.cards.length,
    starred: count(marks.starred),
    used: count(marks.used),
    hidden: count(marks.hidden),
  };
  const shown = deck.cards.filter((c) =>
    filter === "all"
      ? true
      : has(filter === "starred" ? marks.starred : filter === "used" ? marks.used : marks.hidden, c)
  );
  const label: Record<Filter, string> = {
    all: `All (${counts.all})`,
    starred: `Starred (${counts.starred})`,
    used: `Used (${counts.used})`,
    hidden: `Hidden (${counts.hidden})`,
  };

  return (
    <section aria-labelledby="card-decks-browser" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="card-decks-browser" className="font-display text-lg font-bold text-text">
          Cards in {deck.name}
        </h2>
        {counts.used > 0 && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onBringBackUsed}
            className="gap-1.5"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Bring back the {counts.used === 1 ? "used card" : `${counts.used} used cards`}
          </Button>
        )}
      </div>
      <p className="text-sm text-sub">
        {deck.source === "icebreaker"
          ? "These come from the Ice Breaker's activities. Star the ones you like; hide the ones that don't fit."
          : "Star the cards you like to find them again. A used card is skipped in later rounds; a hidden one is never dealt."}
      </p>
      <ToggleGroup
        label="Show cards"
        size="sm"
        options={(Object.keys(label) as Filter[]).map((f) => ({ value: f, label: label[f] }))}
        value={filter}
        onValueChange={setFilter}
      />

      {shown.length === 0 ? (
        <p role="status" className="text-sm text-sub">
          No {filter} cards in this deck.
        </p>
      ) : (
        <ul className="space-y-2">
          {shown.map((card) => {
            const starred = has(marks.starred, card);
            const used = has(marks.used, card);
            const hidden = has(marks.hidden, card);
            return (
              <li
                key={card.id}
                className={cn(
                  "flex flex-wrap items-start justify-between gap-2 rounded-md border border-border bg-card px-3 py-2",
                  hidden && "border-dashed bg-surface"
                )}
              >
                <div className="min-w-0 flex-1 basis-48 break-words">
                  {card.title && <p className="text-xs font-semibold text-accent">{card.title}</p>}
                  <p className="text-sm text-text">{card.text}</p>
                  {card.hint && <p className="mt-0.5 text-xs text-sub">{card.hint}</p>}
                  {(used || hidden || dealtThisRound.has(card.id)) && (
                    <p className="mt-0.5 text-xs text-sub">
                      {[
                        dealtThisRound.has(card.id) && "Dealt this round",
                        used && "Used",
                        hidden && "Hidden",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap gap-1">
                  <IconButton
                    label={starred ? "Unstar the card" : "Star the card"}
                    aria-pressed={starred}
                    icon={
                      <Star
                        className={cn("h-4 w-4", starred && "fill-current text-accent")}
                        aria-hidden="true"
                      />
                    }
                    onClick={() => onToggleStar(card)}
                  />
                  <IconButton
                    label={used ? "Not used after all" : "Mark the card used"}
                    aria-pressed={used}
                    icon={
                      <CheckCheck
                        className={cn("h-4 w-4", used && "text-accent")}
                        aria-hidden="true"
                      />
                    }
                    onClick={() => onToggleUsed(card)}
                  />
                  <IconButton
                    label={hidden ? "Show the card again" : "Hide the card"}
                    aria-pressed={hidden}
                    icon={
                      hidden ? (
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <EyeOff className="h-4 w-4" aria-hidden="true" />
                      )
                    }
                    onClick={() => onToggleHidden(card)}
                  />
                  {own && (
                    <IconButton
                      label="Remove the card"
                      icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                      onClick={() => onRemoveCard(card)}
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {own && <AddCardForm deck={deck} onAdd={onAddCard} />}
    </section>
  );
}
