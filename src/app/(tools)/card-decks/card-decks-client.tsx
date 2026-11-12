"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { nanoid } from "nanoid";
import { Pencil, PenLine, Plus, Trash2, WalletCards } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ShowRoomHost } from "@/components/collab/show-room";
import { ActionRow } from "@/components/shared/action-row";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { WorkspaceLoading } from "@/components/shared/workspace-loading";
import {
  ExampleNotice,
  LoadExampleButton,
  hasExampleItems,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { Button } from "@/components/ui/button";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { generateCardDecksPrompts } from "@/lib/ai-prompts/card-decks";
import {
  BUILT_IN_DECKS,
  CARD_DECK_LIMITS,
  activeCards,
  allDecks,
  backOne,
  cardKey,
  dealCards,
  dealChosen,
  dealableCards,
  dealtIds,
  deckMarks,
  findDeck,
  handOf,
  marksOf,
  mergeCards,
  normalizeCardDecks,
  roundProgress,
  toggleMark,
  type CardDecksState,
  type CustomDeck,
  type DeckCard,
  type DeckValues,
} from "@/lib/card-decks/model";
import { ensureCardDecksHydrated, updateCardDecks, useCardDecks } from "@/lib/card-decks/store";
import { cheer } from "@/lib/celebrate/cheer";
import { CARD_DECKS_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { todayLocalISO } from "@/lib/utils/formatters";
import { removeWithUndo, undoable } from "@/lib/utils/undoable";
import { MoodPick, ThemeDeck, type AcceptedCards } from "./components/ask-amr";
import { DeckBrowser } from "./components/deck-browser";
import { DeckForm } from "./components/deck-form";
import { DeckTable } from "./components/deck-table";
import { RoomDeal } from "./components/room-deal";
import { EXAMPLE_DECK_ID, buildExample } from "./example";
import { toMarkdown } from "./markdown";
import { teamMood } from "./mood";

const newDeckId = () => `deck_${nanoid(10)}`;
const newCardId = () => `c_${nanoid(10)}`;

/** A deck name not taken yet: "Trust", then "Trust (2)", "Trust (3)"… */
function freeName(name: string, decks: readonly CustomDeck[]): string {
  const taken = new Set([...BUILT_IN_DECKS, ...decks].map((d) => d.name.toLowerCase()));
  const base = name.slice(0, CARD_DECK_LIMITS.deckName - 4).trim() || "Amr's deck";
  if (!taken.has(name.toLowerCase()) && name.length <= CARD_DECK_LIMITS.deckName) return name;
  for (let i = 2; i < 100; i++) {
    const next = `${base} (${i})`;
    if (!taken.has(next.toLowerCase())) return next;
  }
  return `${base} (${nanoid(3)})`;
}

const setRound = (deckId: string, round: string[][]) =>
  updateCardDecks((s) => ({ rounds: { ...s.rounds, [deckId]: round } }));

const updateDecks = (fn: (list: readonly CustomDeck[]) => CustomDeck[]) =>
  updateCardDecks((s) => ({ decks: fn(s.decks) }));

const updateUsed = (fn: (list: readonly string[]) => string[]) =>
  updateCardDecks((s) => ({ used: fn(s.used) }));

const updateDeckCards = (deckId: string, fn: (list: readonly DeckCard[]) => DeckCard[]) =>
  updateCardDecks((s) => ({
    decks: s.decks.map((d) =>
      d.id === deckId ? { ...d, cards: fn(d.cards), updatedAt: new Date().toISOString() } : d
    ),
  }));

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function CardDecksClient() {
  const { log } = useHistoryLogger("card-decks");
  const announce = useAnnounce();

  // ── Saved state ───────────────────────────────────────────
  const [ready, setReady] = useState(() => useCardDecks.persist?.hasHydrated?.() ?? true);
  useEffect(() => {
    let live = true;
    void ensureCardDecksHydrated().then(() => {
      if (live) setReady(true);
    });
    return () => {
      live = false;
    };
  }, []);

  const rawDecks = useCardDecks((s) => s.decks);
  const rawDeckId = useCardDecks((s) => s.deckId);
  const rawRounds = useCardDecks((s) => s.rounds);
  const rawUsed = useCardDecks((s) => s.used);
  const rawStarred = useCardDecks((s) => s.starred);
  const rawHidden = useCardDecks((s) => s.hidden);
  const rawStarredOnly = useCardDecks((s) => s.starredOnly);
  const state: CardDecksState = useMemo(
    () =>
      normalizeCardDecks({
        decks: rawDecks,
        deckId: rawDeckId,
        rounds: rawRounds,
        used: rawUsed,
        starred: rawStarred,
        hidden: rawHidden,
        starredOnly: rawStarredOnly,
      }),
    [rawDecks, rawDeckId, rawRounds, rawUsed, rawStarred, rawHidden, rawStarredOnly]
  );
  const decks = useMemo(() => allDecks(state.decks), [state.decks]);
  const deck = findDeck(state.decks, state.deckId) ?? BUILT_IN_DECKS[0];
  const marks = useMemo(() => marksOf(state), [state]);
  const round = useMemo(() => state.rounds[deck.id] ?? [], [state.rounds, deck.id]);
  const hand = handOf(deck, round);
  const hasStarred = deckMarks(state.starred, deck.id).length > 0;
  const starredOnly = state.starredOnly && hasStarred;
  const progress = roundProgress(deck, marks, round, starredOnly);
  const dealable = dealableCards(deck, marks, round, starredOnly);
  const ownDeck = state.decks.find((d) => d.id === deck.id) ?? null;

  // ── The team's mood (for "a card for the mood") ──────────
  const moodEntries = useWorkspaceStore((s) => s.moodEntries);
  const moodPulses = useWorkspaceStore((s) => s.moodPulses);
  const mood = useMemo(
    () => teamMood(moodEntries, moodPulses, todayLocalISO()),
    [moodEntries, moodPulses]
  );

  // ── The table ─────────────────────────────────────────────
  const [handSize, setHandSize] = useState(1);
  const [status, setStatus] = useState<string | null>(null);

  const selectDeck = (id: string) => {
    const next = findDeck(state.decks, id);
    if (!next) return;
    updateCardDecks(() => ({ deckId: next.id }));
    setStatus(null);
    announce(`${next.name}: ${plural(next.cards.length, "card")}.`);
  };

  /** Deal onto the table; what was dealt (none when the round is done). */
  const deal = (count: number, forRoom = false): DeckCard[] => {
    const result = dealCards(deck, marks, round, count, Math.random, starredOnly);
    if (result.cards.length === 0) {
      setStatus("No cards left to deal this round. Shuffle to start again.");
      return [];
    }
    setRound(deck.id, result.round);
    const left = dealable.length - result.cards.length;
    const what = result.cards.length === 1 ? `Dealt a card` : `Dealt ${result.cards.length} cards`;
    const line = `${what} from ${deck.name}. ${
      left === 0 ? "That was the last one this round." : `${left} left.`
    }`;
    // The status line says how many are left; the cards themselves are read
    // out here, so a screen-reader user hears them without leaving Deal.
    setStatus(line);
    announce(result.cards.map((c) => c.text).join(" "));
    log(CARD_DECKS_ACTIONS.CARD_DEALT, {
      deckId: deck.id,
      count: result.cards.length,
      forRoom,
      left,
    });
    if (left === 0) cheer("card-decks", "done");
    return result.cards;
  };

  const back = () => {
    if (round.length === 0) return;
    setRound(deck.id, backOne(round));
    const last = round[round.length - 1].length;
    setStatus(`${last === 1 ? "The card is" : `The ${last} cards are`} back in the deck.`);
  };

  const shuffleDeck = () => {
    const dealt = dealtIds(round).length;
    if (dealt === 0) {
      setStatus("The deck is shuffled: every card can be dealt.");
      return;
    }
    const before = round.map((d) => [...d]);
    undoable({
      label: `Shuffled ${deck.name}: ${plural(dealt, "card")} back in the deck`,
      apply: () => setRound(deck.id, []),
      revert: () => setRound(deck.id, before),
    });
    setStatus(
      `Shuffled. All ${plural(activeCards(deck, marks).length, "card")} can be dealt again.`
    );
    log(CARD_DECKS_ACTIONS.DECK_SHUFFLED, { deckId: deck.id, dealt });
  };

  // ── Marks ─────────────────────────────────────────────────
  const toggleStar = (card: DeckCard) => {
    const key = cardKey(deck.id, card.id);
    const starred = !marks.starred.has(key);
    updateCardDecks((s) => ({ starred: toggleMark(s.starred, key) }));
    log(CARD_DECKS_ACTIONS.CARD_STARRED, { deckId: deck.id, cardId: card.id, starred });
  };
  const toggleUsed = (card: DeckCard) =>
    updateCardDecks((s) => ({ used: toggleMark(s.used, cardKey(deck.id, card.id)) }));
  const toggleHidden = (card: DeckCard) =>
    updateCardDecks((s) => ({ hidden: toggleMark(s.hidden, cardKey(deck.id, card.id)) }));
  const bringBackUsed = () => {
    const n = deckMarks(state.used, deck.id).length;
    removeWithUndo<string>({
      label: `Brought back ${plural(n, "used card")} in ${deck.name}`,
      update: updateUsed,
      match: (k) => k.startsWith(`${deck.id}/`),
    });
  };

  // ── The team's own decks ──────────────────────────────────
  const [editing, setEditing] = useState<"new" | string | null>(null);

  const createDeck = (values: DeckValues) => {
    const at = new Date().toISOString();
    const made: CustomDeck = {
      id: newDeckId(),
      name: values.name,
      cards: values.cards.map((text) => ({ id: newCardId(), text })),
      createdAt: at,
      updatedAt: at,
    };
    updateCardDecks((s) => ({ decks: [...s.decks, made], deckId: made.id }));
    setEditing(null);
    setStatus(`Created ${made.name} with ${plural(made.cards.length, "card")}.`);
    log(CARD_DECKS_ACTIONS.DECK_SAVED, { deckId: made.id, cards: made.cards.length, how: "new" });
  };

  const saveDeck = (id: string, values: DeckValues) => {
    const old = state.decks.find((d) => d.id === id);
    if (!old) return;
    const cards = mergeCards(old.cards, values.cards, newCardId);
    const kept = new Set(cards.map((c) => c.id));
    const removed = old.cards.filter((c) => !kept.has(c.id)).length;
    const next: CustomDeck = {
      ...old,
      name: values.name,
      cards,
      updatedAt: new Date().toISOString(),
    };
    const put = (d: CustomDeck) => updateDecks((list) => list.map((x) => (x.id === id ? d : x)));
    if (removed > 0) {
      undoable({
        label: `Saved ${next.name}: ${plural(removed, "card")} taken out`,
        apply: () => put(next),
        revert: () => put(old),
      });
    } else {
      put(next);
    }
    setEditing(null);
    setStatus(`Saved ${next.name}.`);
    log(CARD_DECKS_ACTIONS.DECK_SAVED, { deckId: id, cards: cards.length, how: "edit" });
  };

  const removeDeck = (d: CustomDeck) => {
    removeWithUndo<CustomDeck>({
      label: `Deleted ${d.name}`,
      update: updateDecks,
      match: (x) => x.id === d.id,
    });
    setEditing(null);
    log(CARD_DECKS_ACTIONS.DECK_REMOVED, { deckId: d.id, cards: d.cards.length });
  };

  const addCard = (text: string) => {
    if (!ownDeck) return;
    updateDeckCards(ownDeck.id, (list) => [...list, { id: newCardId(), text }]);
    setStatus(`Added a card to ${ownDeck.name}.`);
  };

  const removeCard = (card: DeckCard) => {
    if (!ownDeck) return;
    removeWithUndo<DeckCard>({
      label: `Removed a card from ${ownDeck.name}`,
      update: (fn) => updateDeckCards(ownDeck.id, fn),
      match: (c) => c.id === card.id,
    });
  };

  // ── Example ───────────────────────────────────────────────
  const loadExample = () => {
    const ex = buildExample(new Date());
    updateCardDecks((s) => ({
      decks: [...s.decks.filter((d) => d.id !== ex.deck.id), ex.deck],
      deckId: ex.deck.id,
      rounds: { ...s.rounds, [ex.deck.id]: ex.round },
    }));
    setStatus(null);
  };
  const clearExample = () => {
    const dropKeys = (list: readonly string[]) => list.filter((k) => !isExampleId(k));
    updateCardDecks((s) => {
      const rounds = { ...s.rounds };
      for (const id of Object.keys(rounds)) if (isExampleId(id)) delete rounds[id];
      return {
        decks: s.decks.filter((d) => !isExampleId(d.id)),
        rounds,
        used: dropKeys(s.used),
        starred: dropKeys(s.starred),
        hidden: dropKeys(s.hidden),
      };
    });
  };

  // ── Ask Amr ───────────────────────────────────────────────
  /** Answer → the deck its cards went into (so one answer fills one deck). */
  const batchDecks = useRef(new Map<number, string>());

  const acceptCards = useCallback(
    ({ cards, name, theme, batch, target }: AcceptedCards) => {
      const current = normalizeCardDecks(useCardDecks.getState());
      const into =
        target !== "new"
          ? current.decks.find((d) => d.id === target)
          : current.decks.find((d) => d.id === batchDecks.current.get(batch));
      const at = new Date().toISOString();
      const fresh = (list: readonly DeckCard[]) => {
        const seen = new Set(list.map((c) => c.text.toLowerCase()));
        const out: DeckCard[] = [];
        for (const raw of cards) {
          const text = raw.trim().slice(0, CARD_DECK_LIMITS.cardText);
          if (!text || seen.has(text.toLowerCase())) continue;
          if (list.length + out.length >= CARD_DECK_LIMITS.deckCards) break;
          seen.add(text.toLowerCase());
          out.push({ id: newCardId(), text });
        }
        return out;
      };

      if (into) {
        const added = fresh(into.cards);
        if (added.length === 0) return;
        const ids = new Set(added.map((c) => c.id));
        undoable({
          kind: "success",
          id: `card-decks-ai-${batch}`,
          label: `Added ${plural(added.length, "card")} to ${into.name}`,
          apply: () => updateDeckCards(into.id, (list) => [...list, ...added]),
          revert: () => updateDeckCards(into.id, (list) => list.filter((c) => !ids.has(c.id))),
        });
        log(CARD_DECKS_ACTIONS.DECK_SAVED, {
          deckId: into.id,
          cards: into.cards.length + added.length,
          how: "ai",
        });
        return;
      }

      const added = fresh([]);
      if (added.length === 0) return;
      const made: CustomDeck = {
        id: newDeckId(),
        name: freeName(name, current.decks),
        cards: added,
        theme: theme.slice(0, CARD_DECK_LIMITS.deckName),
        createdAt: at,
        updatedAt: at,
      };
      batchDecks.current.set(batch, made.id);
      undoable({
        kind: "success",
        id: `card-decks-ai-${batch}`,
        label: `Made ${made.name} with ${plural(added.length, "card")}`,
        apply: () => updateCardDecks((s) => ({ decks: [...s.decks, made], deckId: made.id })),
        revert: () => {
          batchDecks.current.delete(batch);
          updateDecks((list) => list.filter((d) => d.id !== made.id));
        },
      });
      log(CARD_DECKS_ACTIONS.DECK_SAVED, { deckId: made.id, cards: added.length, how: "ai" });
    },
    [log]
  );

  const dealPicked = (cardId: string) => {
    const result = dealChosen(deck, marks, round, cardId);
    if (!result) {
      setStatus("That card can't be dealt any more. Ask again.");
      return;
    }
    const before = round.map((d) => [...d]);
    const deckId = deck.id;
    undoable({
      kind: "success",
      label: "Dealt the card Amr picked",
      apply: () => setRound(deckId, result.round),
      revert: () => setRound(deckId, before),
    });
    setStatus(`Dealt the card for the mood from ${deck.name}.`);
    log(CARD_DECKS_ACTIONS.CARD_DEALT, { deckId, count: 1, forRoom: false, picked: true });
  };

  // ── Export and prompts ────────────────────────────────────
  const markdown = toMarkdown({ deck, marks, round, starredOnly });
  const dealtCards = useMemo(() => {
    const byId = new Map(deck.cards.map((c) => [c.id, c]));
    return dealtIds(round)
      .map((id) => byId.get(id))
      .filter((c): c is DeckCard => Boolean(c));
  }, [deck, round]);
  const promptConfig = useMemo(
    () => ({
      toolName: "Card Decks",
      prompts: generateCardDecksPrompts({ deck, dealt: dealtCards }),
    }),
    [deck, dealtCards]
  );
  const dealtSet = useMemo(() => new Set(dealtIds(round)), [round]);

  const wrapper = (children: ReactNode) => (
    <ToolPageWrapper
      toolId="card-decks"
      title="Card Decks"
      description="Prompt, coaching and story-splitting cards, dealt one at a time on your screen or to everyone's phone."
    >
      {children}
    </ToolPageWrapper>
  );

  if (!ready) {
    return wrapper(<WorkspaceLoading>Loading your decks…</WorkspaceLoading>);
  }

  const editingDeck =
    editing && editing !== "new" ? state.decks.find((d) => d.id === editing) : undefined;

  return wrapper(
    <div className="space-y-8">
      {hasExampleItems(state.decks) && <ExampleNotice onClear={clearExample} />}

      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename={`card-decks-${deck.id}`}
          markdown={markdown}
          jsonData={{
            deck: { id: deck.id, name: deck.name, cards: deck.cards },
            dealt: dealtCards,
            used: deckMarks(state.used, deck.id),
            starred: deckMarks(state.starred, deck.id),
            hidden: deckMarks(state.hidden, deck.id),
          }}
        />
      </ActionRow>

      {/* ── The deck ────────────────────────────────────── */}
      <section aria-labelledby="card-decks-deck" className="space-y-2">
        <h2 id="card-decks-deck" className="font-display text-lg font-bold text-text">
          Deck
        </h2>
        <ToggleGroup
          label="Deck"
          options={decks.map((d) => ({
            value: d.id,
            label: d.name,
            description: d.blurb,
          }))}
          value={deck.id}
          onValueChange={selectDeck}
        />
        <p className="text-sm text-sub">
          {deck.blurb} {plural(deck.cards.length, "card")}.
        </p>
      </section>

      <DeckTable
        deck={deck}
        hand={hand}
        marks={marks}
        progress={progress}
        handSize={handSize}
        onHandSize={setHandSize}
        starredOnly={hasStarred ? starredOnly : null}
        onStarredOnly={(on) => updateCardDecks(() => ({ starredOnly: on }))}
        onDeal={(n) => deal(n)}
        onBack={back}
        onShuffle={shuffleDeck}
        canBack={round.length > 0}
        onToggleStar={toggleStar}
        onToggleUsed={toggleUsed}
        status={status}
      />

      {/* ── The live room ───────────────────────────────── */}
      <section aria-labelledby="card-decks-room" className="space-y-2">
        <h2 id="card-decks-room" className="font-display text-lg font-bold text-text">
          Deal for the room
        </h2>
        <ShowRoomHost
          tool="card-decks"
          toolName="Card Decks"
          description="Everyone opens your link on their phone and sees each card you deal. Only the cards travel; your decks and marks stay here."
        >
          {(room) => (
            <RoomDeal
              room={room}
              deckName={deck.name}
              hand={hand}
              handSize={handSize}
              onDealForRoom={(n) => deal(n, true)}
            />
          )}
        </ShowRoomHost>
      </section>

      {/* ── Ask Amr ─────────────────────────────────────── */}
      <section aria-labelledby="card-decks-ai" className="space-y-4">
        <h2
          id="card-decks-ai"
          className="flex items-center gap-2 font-display text-lg font-bold text-text"
        >
          <PenLine className="h-4 w-4 text-accent" aria-hidden="true" />
          Ask Amr
        </h2>
        <p className="text-sm text-sub">
          Suggestions only: nothing is added or dealt until you choose it.
        </p>
        <MoodPick deck={deck} dealable={dealable} mood={mood} onDeal={dealPicked} />
        <ThemeDeck ownDeck={deck.source === "custom" ? deck : null} onAccept={acceptCards} />
      </section>

      <DeckBrowser
        deck={deck}
        marks={marks}
        dealtThisRound={dealtSet}
        onToggleStar={toggleStar}
        onToggleUsed={toggleUsed}
        onToggleHidden={toggleHidden}
        onBringBackUsed={bringBackUsed}
        onAddCard={addCard}
        onRemoveCard={removeCard}
      />

      {/* ── The team's own decks ────────────────────────── */}
      <section aria-labelledby="card-decks-own" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="card-decks-own" className="font-display text-lg font-bold text-text">
            Your decks
          </h2>
          {editing === null && state.decks.length < CARD_DECK_LIMITS.decks && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setEditing("new")}
              className="gap-1.5"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              New deck
            </Button>
          )}
        </div>

        {editing === "new" && (
          <DeckForm others={state.decks} onSave={createDeck} onCancel={() => setEditing(null)} />
        )}
        {editingDeck && (
          <DeckForm
            key={editingDeck.id}
            deck={editingDeck}
            others={state.decks}
            onSave={(values) => saveDeck(editingDeck.id, values)}
            onCancel={() => setEditing(null)}
          />
        )}

        {state.decks.length === 0 ? (
          editing === null && (
            <EmptyState icon={WalletCards} action={<LoadExampleButton onLoad={loadExample} />}>
              No decks of your own yet. Write one with New deck, ask Amr for one above, or load an
              example.
            </EmptyState>
          )
        ) : (
          <ul className="space-y-2">
            {state.decks.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2"
              >
                <div className="min-w-0 flex-1 basis-40 break-words">
                  <p className="text-sm font-semibold text-text">
                    {d.name}
                    {d.id === deck.id && (
                      <span className="font-normal text-sub"> · on the table</span>
                    )}
                  </p>
                  <p className="text-xs text-sub">{plural(d.cards.length, "card")}</p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {d.id !== deck.id && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => selectDeck(d.id)}
                    >
                      Put on the table
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditing(d.id)}
                    className="gap-1.5"
                    aria-label={`Edit ${d.name}`}
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                    Edit
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => removeDeck(d)}
                    className="gap-1.5"
                    aria-label={`Delete ${d.name}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {state.decks.some((d) => d.id === EXAMPLE_DECK_ID) && (
          <p className="text-xs text-sub">The example deck goes when you clear the example.</p>
        )}
      </section>
    </div>
  );
}
