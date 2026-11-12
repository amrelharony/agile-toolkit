"use client";

import { useRef, useState } from "react";
import { CheckCheck, EyeOff, Plus, RotateCcw, Star, Trash2 } from "lucide-react";
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
import { neighbourKeys, useFocusAfter } from "../use-focus-after";

type Filter = "all" | "starred" | "used" | "hidden";

/** What the list says when the filter shows no card. */
const NONE_SHOWN: Record<Filter, string> = {
  all: "This deck has no cards yet.",
  starred: "No starred cards in this deck.",
  used: "No used cards in this deck.",
  hidden: "No hidden cards in this deck.",
};

/** A card's text, short enough to name its buttons. */
function short(text: string, max = 60): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** A pressed toggle's look; its state is aria-pressed, never the label. */
const PRESSED = "bg-accent/15 text-accent";

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
 *
 * Each toggle keeps one name, with the card's text ("Star: ..."), and says
 * its state with aria-pressed. When a press takes its row out of the list
 * (a filter, Remove) or its button away, focus goes to the same control on
 * the next row, else the one before, else the list's heading.
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
  const rootRef = useRef<HTMLElement>(null);
  const focusAfter = useFocusAfter(rootRef);
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
  const shownIds = shown.map((c) => c.id);
  /** Press `control` on `card`: focus stays on it, else the next row's, the one before, the heading. */
  const press = (control: string, card: DeckCard, act: (card: DeckCard) => void) => {
    focusAfter(
      `${control}:${card.id}`,
      ...neighbourKeys(shownIds, card.id, `${control}:`),
      "browser-heading"
    );
    act(card);
  };

  return (
    <section ref={rootRef} aria-labelledby="card-decks-browser" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id="card-decks-browser"
          tabIndex={-1}
          data-focus-key="browser-heading"
          className="rounded-sm font-display text-lg font-bold text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Cards in {deck.name}
        </h2>
        {counts.used > 0 && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              focusAfter("browser-heading");
              onBringBackUsed();
            }}
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
          {NONE_SHOWN[filter]}
          {filter === "all" && own && " Add one below."}
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
                    label={`Star: ${short(card.text)}`}
                    aria-pressed={starred}
                    data-focus-key={`star:${card.id}`}
                    className={cn(starred && PRESSED)}
                    icon={
                      <Star
                        className={cn("h-4 w-4", starred && "fill-current")}
                        aria-hidden="true"
                      />
                    }
                    onClick={() => press("star", card, onToggleStar)}
                  />
                  <IconButton
                    label={`Mark used: ${short(card.text)}`}
                    aria-pressed={used}
                    data-focus-key={`used:${card.id}`}
                    className={cn(used && PRESSED)}
                    icon={<CheckCheck className="h-4 w-4" aria-hidden="true" />}
                    onClick={() => press("used", card, onToggleUsed)}
                  />
                  <IconButton
                    label={`Hide: ${short(card.text)}`}
                    aria-pressed={hidden}
                    data-focus-key={`hide:${card.id}`}
                    className={cn(hidden && PRESSED)}
                    icon={<EyeOff className="h-4 w-4" aria-hidden="true" />}
                    onClick={() => press("hide", card, onToggleHidden)}
                  />
                  {own && (
                    <IconButton
                      label={`Remove: ${short(card.text)}`}
                      data-focus-key={`remove:${card.id}`}
                      icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                      onClick={() => {
                        focusAfter(
                          ...neighbourKeys(shownIds, card.id, "remove:"),
                          "browser-heading"
                        );
                        onRemoveCard(card);
                      }}
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
