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
 */

import { useEffect, useState, useRef, type ClipboardEvent } from "react";
import { AnimatePresence } from "framer-motion";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { RetroColumn } from "@/lib/constants/retro-formats";
import type { HandoffLink } from "@/lib/handoffs/types";
import { PASTE_LINE_CAP, leftOutMessage, splitPastedLines } from "@/lib/utils/paste-lines";
import { toast } from "@/lib/utils/toast";
import { type BoardPhase, type RetroCard, MAX_VOTES } from "../types";
import { sortedByVotes } from "../helpers";
import { RetroCardItem } from "./retro-card-item";
import { themed, tint } from "@/lib/utils/theme-color";

export function RetroColumnPanel({
  column,
  cards,
  allCards,
  phase,
  votesUsed,
  clusterByCardId,
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
  assigneeListId,
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
  clusterByCardId?: Record<string, number>;
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
  assigneeListId?: string;
  /** False for a visitor-room participant: add in Write, vote in Vote, nothing else. */
  canModerate?: boolean;
  /** False hides the add-card input (e.g. a participant without a seat yet). */
  canAdd?: boolean;
  /** Longest card text the input accepts. */
  maxCardLength?: number;
  /** Most cards one multi-line paste adds. */
  pasteCap?: number;
}) {
  const [inputVal, setInputVal] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
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
    setAddingIn(phase);
  }

  function closeAdd() {
    setAddingIn(null);
    toggleRef.current?.focus();
  }

  const displayCards = phase === "discuss" || phase === "actions" ? sortedByVotes(cards) : cards;

  function handleSubmit() {
    const trimmed = inputVal.trim();
    if (!trimmed) return;
    onAdd(column.key, trimmed);
    setInputVal("");
    inputRef.current?.focus();
  }

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
                    clusterId={clusterByCardId?.[card.id]}
                    onVote={onVote}
                    onDelete={onDelete}
                    onGroup={onGroup}
                    onToggleAction={onToggleAction}
                    onAssigneeChange={onAssigneeChange}
                    onToggleDiscussing={onToggleDiscussing}
                    onLinksChange={onLinksChange}
                    onEdit={onEdit}
                    maxCardLength={maxCardLength}
                    assigneeListId={assigneeListId}
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
                      clusterId={clusterByCardId?.[child.id]}
                      onVote={onVote}
                      onDelete={onDelete}
                      onGroup={onGroup}
                      onToggleAction={onToggleAction}
                      onAssigneeChange={onAssigneeChange}
                      onToggleDiscussing={onToggleDiscussing}
                      onLinksChange={onLinksChange}
                      onEdit={onEdit}
                      maxCardLength={maxCardLength}
                      assigneeListId={assigneeListId}
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
          <div className="flex gap-1.5 pt-1">
            <Input
              ref={inputRef}
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              onPaste={handlePaste}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) handleSubmit();
                else if (e.key === "Escape" && !isWrite) closeAdd();
              }}
              placeholder="Add a card…"
              maxLength={maxCardLength}
              aria-label={`New card for ${column.label}`}
              className="h-8 text-xs bg-cardH border-border text-text placeholder:text-sub focus:border-accent-cyan/50"
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={handleSubmit}
              disabled={!inputVal.trim()}
              aria-label={`Add card to ${column.label}`}
              className="min-touch-coarse h-8 w-8 p-0 text-sub hover:text-accent hover:bg-accent-cyan/10"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
