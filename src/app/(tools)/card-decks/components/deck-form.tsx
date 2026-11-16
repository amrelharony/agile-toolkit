"use client";

import { Save } from "lucide-react";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  CARD_DECK_LIMITS,
  validateDeckDraft,
  type CustomDeck,
  type DeckDraft,
  type DeckValues,
} from "@/lib/card-decks/model";

const EMPTY: DeckDraft = { name: "", cards: "" };

/**
 * A deck of the team's own: a name and its cards, one per line. New decks
 * start empty; an edit starts from the deck as it is. Nothing is saved until
 * the draft passes `validateDeckDraft`: a missing name, no cards, too many,
 * or a card over 140 characters is an error at its field.
 */
export function DeckForm({
  deck,
  others,
  onSave,
  onCancel,
}: {
  /** The deck being edited; absent for a new one. */
  deck?: CustomDeck;
  /** The team's decks, to keep names apart. */
  others: readonly CustomDeck[];
  onSave: (values: DeckValues) => void;
  onCancel: () => void;
}) {
  const form = useItemForm<DeckDraft, DeckValues, keyof DeckDraft>({
    initial: deck ? { name: deck.name, cards: deck.cards.map((c) => c.text).join("\n") } : EMPTY,
    validate: (draft) => validateDeckDraft(draft, others, deck?.id),
    onSave,
    resetOnSave: !deck,
  });
  const count = form.draft.cards.split(/\r?\n/).filter((l) => l.trim()).length;

  return (
    <ItemForm
      form={form}
      submitLabel={deck ? "Save the deck" : "Create the deck"}
      submitIcon={<Save className="h-4 w-4" aria-hidden="true" />}
      onCancel={onCancel}
    >
      <Field label="Deck name" error={form.errors.name} required>
        {(props) => (
          <Input
            {...props}
            value={form.draft.name}
            maxLength={CARD_DECK_LIMITS.deckName + 20}
            onChange={(e) => form.update({ name: e.target.value })}
            placeholder="Offsite openers"
          />
        )}
      </Field>
      <Field
        label="Cards"
        hint={`One card per line, up to ${CARD_DECK_LIMITS.deckCards} cards of ${CARD_DECK_LIMITS.cardText} characters. ${count} so far.`}
        error={form.errors.cards}
        required
      >
        {(props) => (
          <Textarea
            {...props}
            value={form.draft.cards}
            rows={8}
            onChange={(e) => form.update({ cards: e.target.value })}
            placeholder={"What made you smile at work this week?\nWhat would you change first?"}
          />
        )}
      </Field>
    </ItemForm>
  );
}
