"use client";

/**
 * One retro column: header (icon/label/count), the card list (top-level cards
 * with their grouped children rendered immediately after), and — in the Write
 * phase — the add-card input. Cards are vote-sorted in Discuss/Actions.
 */

import { useState, useRef } from "react";
import { AnimatePresence } from "framer-motion";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { RetroColumn } from "@/lib/constants/retro-formats";
import type { HandoffLink } from "@/lib/handoffs/types";
import { type BoardPhase, type RetroCard, MAX_VOTES } from "../types";
import { sortedByVotes } from "../helpers";
import { RetroCardItem } from "./retro-card-item";
import { themed, tint } from "@/lib/utils/theme-color";

export function RetroColumnPanel({
  column,
  cards,
  allCards,
  phase,
  userVotes,
  clusterByCardId,
  onAdd,
  onVote,
  onDelete,
  onGroup,
  onToggleAction,
  onAssigneeChange,
  onToggleDiscussing,
  onLinksChange,
  assigneeListId,
}: {
  column: RetroColumn;
  cards: RetroCard[];
  allCards: RetroCard[];
  phase: BoardPhase;
  userVotes: number;
  clusterByCardId?: Record<string, number>;
  onAdd: (columnKey: string, text: string) => void;
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
}) {
  const [inputVal, setInputVal] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const canVote = userVotes < MAX_VOTES;

  const displayCards = phase === "discuss" || phase === "actions" ? sortedByVotes(cards) : cards;

  function handleSubmit() {
    const trimmed = inputVal.trim();
    if (!trimmed) return;
    onAdd(column.key, trimmed);
    setInputVal("");
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
                    assigneeListId={assigneeListId}
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
                      assigneeListId={assigneeListId}
                    />
                  ))}
                </div>
              );
            })}
        </AnimatePresence>

        {/* Add card input — only in write phase */}
        {phase === "write" && (
          <div className="flex gap-1.5 pt-1">
            <Input
              ref={inputRef}
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit();
              }}
              placeholder="Add a card…"
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
