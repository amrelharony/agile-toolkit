"use client";

/**
 * One retro column: header (icon/label/count), the card list (top-level cards
 * with their grouped children rendered immediately after), and the add-card
 * input. The input is always open in the Write phase; in later phases it sits
 * behind an "Add a card" button so a late idea can still land on the board.
 * Cards are vote-sorted in Discuss/Actions.
 *
 * `canModerate={false}` is the visitor-room participant view: cards can be
 * added in Write and voted on in Vote, nothing else (no late cards, no
 * delete, group, action items, assignees or Send to).
 *
 * Pasting several lines into the add box adds one card per non-empty line
 * (up to `pasteCap`, saying so when lines are left out). Cards are
 * click-to-edit when the board passes `onEdit`.
 *
 * Adding a card is draft-then-save (useItemForm): Enter on an empty box says
 * what's missing instead of doing nothing, and a card is only added once it
 * has text.
 */

import { useEffect, useState, useRef, type ClipboardEvent } from "react";
import { AnimatePresence } from "framer-motion";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useItemForm } from "@/components/shared/item-form";
import type { RetroColumn } from "@/lib/constants/retro-formats";
import type { HandoffLink } from "@/lib/handoffs/types";
import type { Validation } from "@/lib/utils/form";
import { PASTE_LINE_CAP, leftOutMessage, splitPastedLines } from "@/lib/utils/paste-lines";
import { toast } from "@/lib/utils/toast";
import { type BoardPhase, type RetroCard, MAX_VOTES } from "../types";
import { sortedByVotes } from "../helpers";
import { RetroCardItem } from "./retro-card-item";
import { themed, tint } from "@/lib/utils/theme-color";

interface CardDraft {
  text: string;
}

const EMPTY_CARD: CardDraft = { text: "" };

/** A new card's text: something written, within the board's limit. */
export function validateCardText(draft: CardDraft, maxLength?: number): Validation<string, "text"> {
  const text = draft.text.trim();
  if (!text) return { ok: false, errors: { text: "Write the card first." } };
  if (maxLength && text.length > maxLength) {
    return { ok: false, errors: { text: `Keep it to ${maxLength} characters.` } };
  }
  return { ok: true, values: text };
}

export function RetroColumnPanel({
  column,
  cards,
  allCards,
  phase,
  votesUsed,
  highlightIds,
  highlightWord,
  onAdd,
  onAddMany,
  onEdit,
  onVote,
  onDelete,
  onGroup,
  onToggleAction,
  onAssigneeChange,
  onToggleDiscussing,
  onLinksChange,
  canModerate = true,
  canAdd = true,
  maxCardLength,
  pasteCap = PASTE_LINE_CAP,
}: {
  column: RetroColumn;
  cards: RetroCard[];
  allCards: RetroCard[];
  phase: BoardPhase;
  /** Votes the current voter ("Me", or the person picked) has cast. */
  votesUsed: number;
  /** Top-level cards to ring (a common word's cards); their grouped cards ring too. */
  highlightIds?: ReadonlySet<string>;
  /** The common word they're ringed for, said to screen readers on each ringed card. */
  highlightWord?: string;
  onAdd: (columnKey: string, text: string) => void;
  /** Add several cards at once (a multi-line paste). Falls back to `onAdd` per card. */
  onAddMany?: (columnKey: string, texts: string[]) => void;
  /** Change a card's text. Without it cards are read-only (a room participant). */
  onEdit?: (id: string, text: string) => void;
  onVote: (id: string) => void;
  onDelete: (id: string) => void;
  onGroup: (id: string, parentId: string | null) => void;
  onToggleAction: (id: string) => void;
  onAssigneeChange: (id: string, val: string) => void;
  onToggleDiscussing: (id: string) => void;
  onLinksChange?: (
    id: string,
    update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]
  ) => void;
  /** False for a visitor-room participant: add in Write, vote in Vote, nothing else. */
  canModerate?: boolean;
  /** False hides the add-card input (e.g. a participant without a seat yet). */
  canAdd?: boolean;
  /** Longest card text the input accepts. */
  maxCardLength?: number;
  /** Most cards one multi-line paste adds. */
  pasteCap?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const form = useItemForm<CardDraft, string, "text">({
    initial: EMPTY_CARD,
    validate: (d) => validateCardText(d, maxCardLength),
    onSave: (text) => {
      onAdd(column.key, text);
      // The box stays ready for the next card, even after a click on "+".
      inputRef.current?.focus();
    },
  });
  const toggleRef = useRef<HTMLButtonElement>(null);
  // Outside Write the input opens on demand, for the phase it was opened in:
  // a phase change closes it again.
  const [addingIn, setAddingIn] = useState<BoardPhase | null>(null);
  if (addingIn !== null && addingIn !== phase) setAddingIn(null);
  const isWrite = phase === "write";
  const showInput = canAdd && (isWrite || (canModerate && addingIn === phase));
  const canVote = votesUsed < MAX_VOTES;

  // Opening the input from the button puts the cursor in it.
  const focusOnOpen = useRef(false);
  useEffect(() => {
    if (showInput && focusOnOpen.current) {
      focusOnOpen.current = false;
      inputRef.current?.focus();
    }
  }, [showInput]);

  function openAdd() {
    focusOnOpen.current = true;
    // A box closed by a phase change may have kept an error; start clean.
    form.reset();
    setAddingIn(phase);
  }

  function closeAdd() {
    setAddingIn(null);
    form.reset();
    toggleRef.current?.focus();
  }

  const displayCards = phase === "discuss" || phase === "actions" ? sortedByVotes(cards) : cards;
  const ringed = (card: RetroCard) =>
    Boolean(
      highlightIds &&
      (highlightIds.has(card.id) || (card.groupedWith && highlightIds.has(card.groupedWith)))
    );

  // Several lines pasted: one card per line. What's typed in the box stays.
  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    const pasted = splitPastedLines(e.clipboardData.getData("text"), pasteCap);
    if (!pasted) return;
    e.preventDefault();
    const texts = maxCardLength
      ? pasted.lines.map((line) => line.slice(0, maxCardLength).trim())
      : pasted.lines;
    if (onAddMany) onAddMany(column.key, texts);
    else for (const text of texts) onAdd(column.key, text);
    if (pasted.dropped > 0) {
      toast.info(`Added ${texts.length} cards.`, {
        description: `${leftOutMessage(pasted.dropped)} One paste adds up to ${pasteCap}.`,
      });
    }
    inputRef.current?.focus();
  }

  return (
    <div className="flex flex-col min-h-0">
      {/* Column header */}
      <div
        className="flex items-center justify-between px-3 py-2 rounded-t-lg border-t-2 border-x border-border mb-0"
        style={{ borderTopColor: themed(column.color) }}
      >
        <div className="flex items-center gap-2">
          <span className="text-base" aria-hidden="true">
            {column.icon}
          </span>
          <span
            className="text-sm font-bold"
            style={{ color: themed(column.color), textShadow: `0 0 8px ${tint(column.color, 33)}` }}
          >
            {column.label}
          </span>
        </div>
        <Badge variant="outline" className="text-xs bg-cardH border-border text-sub">
          {cards.length}
        </Badge>
      </div>

      {/* Cards */}
      <div className="flex-1 bg-card border border-t-0 border-border rounded-b-lg p-2 space-y-2 min-h-[120px]">
        <AnimatePresence initial={false}>
          {displayCards
            .filter((c) => c.groupedWith === null)
            .map((card) => {
              // Include grouped children right after parent
              const children = displayCards.filter((c) => c.groupedWith === card.id);
              return (
                <div key={card.id} className="space-y-1">
                  <RetroCardItem
                    card={card}
                    allCards={allCards}
                    column={column}
                    phase={phase}
                    canVote={canVote}
                    highlighted={ringed(card)}
                    highlightWord={highlightWord}
                    onVote={onVote}
                    onDelete={onDelete}
                    onGroup={onGroup}
                    onToggleAction={onToggleAction}
                    onAssigneeChange={onAssigneeChange}
                    onToggleDiscussing={onToggleDiscussing}
                    onLinksChange={onLinksChange}
                    onEdit={onEdit}
                    maxCardLength={maxCardLength}
                    canModerate={canModerate}
                  />
                  {children.map((child) => (
                    <RetroCardItem
                      key={child.id}
                      card={child}
                      allCards={allCards}
                      column={column}
                      phase={phase}
                      canVote={canVote}
                      highlighted={ringed(child)}
                      highlightWord={highlightWord}
                      onVote={onVote}
                      onDelete={onDelete}
                      onGroup={onGroup}
                      onToggleAction={onToggleAction}
                      onAssigneeChange={onAssigneeChange}
                      onToggleDiscussing={onToggleDiscussing}
                      onLinksChange={onLinksChange}
                      onEdit={onEdit}
                      maxCardLength={maxCardLength}
                      canModerate={canModerate}
                    />
                  ))}
                </div>
              );
            })}
        </AnimatePresence>

        {/* Add a card after Write: a button that opens the input */}
        {!isWrite && canModerate && canAdd && (
          <Button
            ref={toggleRef}
            size="sm"
            variant="ghost"
            onClick={() => (showInput ? closeAdd() : openAdd())}
            aria-expanded={showInput}
            aria-label={`Add a card to ${column.label}`}
            className="min-touch-coarse h-8 w-full justify-start px-2 text-xs text-sub hover:text-accent hover:bg-accent-cyan/10"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Add a card
          </Button>
        )}

        {/* Add card input — always open in Write, on demand after it */}
        {showInput && (
          <form
            ref={form.formRef}
            onSubmit={form.submit}
            noValidate
            className="flex items-start gap-1.5 pt-1"
          >
            <Field
              label={`New card for ${column.label}`}
              hideLabel
              error={form.errors.text}
              className="min-w-0 flex-1 gap-1"
            >
              {(props) => (
                <Input
                  {...props}
                  ref={inputRef}
                  value={form.draft.text}
                  onChange={(e) => form.update({ text: e.target.value })}
                  onPaste={handlePaste}
                  onKeyDown={(e) => {
                    // Handled here rather than by the form's implicit submit,
                    // so a composing IME's Enter never adds a half-typed card.
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      form.submit();
                    } else if (e.key === "Escape" && !isWrite) closeAdd();
                  }}
                  placeholder="Add a card…"
                  maxLength={maxCardLength}
                  className="md:h-8 md:text-xs bg-cardH border-border text-text placeholder:text-sub focus:border-accent-cyan/50"
                />
              )}
            </Field>
            <Button
              type="submit"
              size="sm"
              variant="ghost"
              aria-label={`Add card to ${column.label}`}
              className="min-touch-coarse h-8 w-8 shrink-0 p-0 text-sub hover:text-accent hover:bg-accent-cyan/10"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
