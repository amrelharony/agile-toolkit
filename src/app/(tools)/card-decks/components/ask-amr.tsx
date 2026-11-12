"use client";

import { useRef, useState } from "react";
import { AiButton, AiSuggestions } from "@/components/ai";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup } from "@/components/ui/toggle-group";
import type { AiSource } from "@/lib/ai/task-types";
import {
  GENERATE_MAX,
  MOOD_CARDS_MAX,
  cardForMoodTask,
  generateCardsTask,
  type CardForMoodInput,
  type CardForMoodOutput,
  type GenerateCardsInput,
} from "@/lib/ai/tasks/card-decks";
import { CARD_DECK_LIMITS, cleanLine, type Deck, type DeckCard } from "@/lib/card-decks/model";
import type { Validation } from "@/lib/utils/form";
import { moodLine, type TeamMood } from "../mood";

// ── A card for the mood ──────────────────────────────────────────────

/**
 * Ask Amr for the card that fits the team's mood, from the cards the deck
 * can still deal. Only the team's average mood goes with them (never a
 * person's). The answer is a suggestion: Deal puts it on the table, with
 * Undo, and a card id that isn't one of the deck's is replaced by the
 * answer without AI.
 */
export function MoodPick({
  deck,
  dealable,
  mood,
  onDeal,
}: {
  deck: Deck;
  dealable: readonly DeckCard[];
  mood: TeamMood;
  onDeal: (cardId: string) => void;
}) {
  const [pick, setPick] = useState<(CardForMoodOutput & { source: AiSource }) | null>(null);
  const input = (): CardForMoodInput => ({
    mood,
    deck: cleanLine(deck.name, CARD_DECK_LIMITS.deckName),
    cards: dealable.slice(0, MOOD_CARDS_MAX).map((c) => ({ id: c.id, text: c.text })),
  });
  const card = pick ? dealable.find((c) => c.id === pick.cardId) : undefined;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-text">A card for the team&apos;s mood</h3>
      <p className="text-sm text-sub">{moodLine(mood)}</p>
      <AiButton
        task={cardForMoodTask}
        input={input}
        label="Ask Amr for a card"
        fallbackLabel="Pick a card for the mood"
        disabledReason={
          dealable.length === 0 ? "No cards left to deal in this deck. Shuffle first." : null
        }
        onResult={(data, meta) => {
          const fits = dealable.some((c) => c.id === data.cardId);
          setPick(
            fits
              ? { ...data, source: meta.source }
              : { ...cardForMoodTask.fallback(input()), source: "fallback" }
          );
        }}
      />
      {pick && card && (
        <AiSuggestions
          items={[pick]}
          render={(p) => ({ title: card.text, detail: p.reason })}
          title="A card for the team's mood"
          acceptLabel="Deal"
          source={pick.source}
          onAccept={(p) => onDeal(p.cardId)}
          onDismiss={() => setPick(null)}
        />
      )}
    </div>
  );
}

// ── A deck on a theme ────────────────────────────────────────────────

export interface ThemeDraft {
  theme: string;
  count: string;
}

/** A theme of 2 to 60 characters and a count of 1 to 30 cards. */
export function validateThemeDraft(
  draft: ThemeDraft
): Validation<{ theme: string; count: number }, keyof ThemeDraft> {
  const theme = cleanLine(draft.theme, Infinity);
  const count = Number(draft.count.trim());
  const errors: Partial<Record<keyof ThemeDraft, string>> = {};
  if (theme.length < 2) errors.theme = "Write a theme, such as “trust in a remote team”.";
  else if (theme.length > 60) errors.theme = "Keep the theme to 60 characters.";
  if (!draft.count.trim() || !Number.isInteger(count) || count < 1 || count > GENERATE_MAX)
    errors.count = `Ask for 1 to ${GENERATE_MAX} cards.`;
  return Object.keys(errors).length > 0
    ? { ok: false, errors }
    : { ok: true, values: { theme, count } };
}

export interface AcceptedCards {
  cards: string[];
  /** The name Amr gave the deck. */
  name: string;
  theme: string;
  /** One per answer: the cards of one answer go into one deck. */
  batch: number;
  /** "new": a deck of their own; else the id of the team's deck on the table. */
  target: string;
}

/**
 * Ask Amr for a deck on a theme. Without AI, the answer is cards from the
 * nearest built-in deck. The person adds the cards they want (one or all),
 * into a new deck or the team's deck on the table, with Undo. When some
 * can't go in (the deck is full, or holds them already), a line says so.
 */
export function ThemeDeck({
  ownDeck,
  newDeckBlocked,
  onAccept,
}: {
  /** The team's own deck on the table, which the cards may go into; null for a built-in one. */
  ownDeck: Deck | null;
  /** Why a new deck can't be made (the team has the most decks it keeps); null when it can. */
  newDeckBlocked: string | null;
  /** Add the cards; a line saying what wasn't added, or null. */
  onAccept: (accepted: AcceptedCards) => string | null;
}) {
  const [draft, setDraft] = useState<ThemeDraft>({ theme: "", count: "12" });
  const [into, setInto] = useState<"new" | "this">("new");
  const [note, setNote] = useState<string | null>(null);
  const [answer, setAnswer] = useState<{
    name: string;
    cards: string[];
    source: AiSource;
    theme: string;
    batch: number;
    target: string;
  } | null>(null);
  const batches = useRef(0);
  const check = validateThemeDraft(draft);
  const target = into === "this" && ownDeck ? ownDeck.id : "new";

  const input = (): GenerateCardsInput => {
    if (!check.ok) throw new Error("not ready");
    return {
      theme: check.values.theme,
      count: check.values.count,
      ...(target !== "new" && ownDeck
        ? { avoid: ownDeck.cards.slice(0, 40).map((c) => c.text) }
        : {}),
    };
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-text">A deck on a theme</h3>
      <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
        <Field label="Theme" error={check.ok || !draft.theme ? undefined : check.errors.theme}>
          {(props) => (
            <Input
              {...props}
              value={draft.theme}
              maxLength={80}
              onChange={(e) => setDraft((d) => ({ ...d, theme: e.target.value }))}
              placeholder="Trust in a remote team"
            />
          )}
        </Field>
        <Field label="How many cards" error={check.ok ? undefined : check.errors.count}>
          {(props) => (
            <Input
              {...props}
              type="number"
              inputMode="numeric"
              min={1}
              max={GENERATE_MAX}
              value={draft.count}
              onChange={(e) => setDraft((d) => ({ ...d, count: e.target.value }))}
            />
          )}
        </Field>
      </div>
      {ownDeck && (
        <ToggleGroup
          label="Where the cards go"
          size="sm"
          options={[
            { value: "new", label: "A new deck" },
            { value: "this", label: `Into ${ownDeck.name}` },
          ]}
          value={into}
          onValueChange={setInto}
        />
      )}
      <AiButton
        task={generateCardsTask}
        input={input}
        label="Ask Amr for cards"
        fallbackLabel="Suggest cards from the built-in decks"
        disabledReason={
          !check.ok
            ? (check.errors.theme ?? check.errors.count ?? "Fill in the theme first.")
            : target === "new"
              ? newDeckBlocked
              : null
        }
        onResult={(data, meta) => {
          batches.current += 1;
          setNote(null);
          setAnswer({
            name: data.name,
            cards: data.cards,
            source: meta.source,
            theme: check.ok ? check.values.theme : data.name,
            batch: batches.current,
            target,
          });
        }}
      />
      {answer && (
        <AiSuggestions
          items={answer.cards}
          title={`Cards for “${answer.name}”`}
          source={answer.source}
          acceptLabel="Add"
          onAccept={(card) => setNote(onAccept({ ...answer, cards: [card] }))}
          onAcceptAll={(cards) => setNote(onAccept({ ...answer, cards }))}
          onDismiss={() => {
            setAnswer(null);
            setNote(null);
          }}
        />
      )}
      <p role="status" className={note ? "text-sm text-sub" : "sr-only"}>
        {note ?? ""}
      </p>
    </div>
  );
}
