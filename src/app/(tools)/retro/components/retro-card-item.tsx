"use client";

/**
 * A single retro card. Adapts its affordances to the current phase: delete +
 * group-with in Write, vote heart in Vote/Discuss/Actions, click-to-focus in
 * Discuss, and the action-item checkbox + assignee input in Actions. Grouped
 * child cards render indented under their parent and inherit its visual state.
 *
 * Click-to-focus: in Discuss the card text is a button whose ::after stretches
 * over the whole card, so the card stays clickable while the vote button sits
 * above it (a role="button" card can't contain the vote button).
 */

import { motion } from "framer-motion";
import { Heart, Trash2, CheckSquare, Square } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { RetroColumn } from "@/lib/constants/retro-formats";
import type { BoardPhase, RetroCard } from "../types";
import { CLUSTER_COLORS } from "../helpers";

export function RetroCardItem({
  card,
  allCards,
  phase,
  canVote,
  clusterId,
  onVote,
  onDelete,
  onGroup,
  onToggleAction,
  onAssigneeChange,
  onToggleDiscussing,
}: {
  card: RetroCard;
  allCards: RetroCard[];
  column: RetroColumn;
  phase: BoardPhase;
  canVote: boolean;
  clusterId?: number;
  onVote: (id: string) => void;
  onDelete: (id: string) => void;
  onGroup: (id: string, parentId: string | null) => void;
  onToggleAction: (id: string) => void;
  onAssigneeChange: (id: string, val: string) => void;
  onToggleDiscussing: (id: string) => void;
}) {
  const otherCards = allCards.filter(
    (c) => c.id !== card.id && c.columnKey === card.columnKey && c.groupedWith === null
  );

  const isDiscussing = card.discussing;
  // Only top-level cards in the Discuss phase get the click-to-focus affordance.
  // Grouped child cards inherit visual state from the parent and aren't toggled.
  const isDiscussClickable = phase === "discuss" && card.groupedWith === null;
  const clusterColor =
    clusterId !== undefined && clusterId >= 0
      ? CLUSTER_COLORS[clusterId % CLUSTER_COLORS.length]
      : undefined;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className={`group relative rounded-lg border p-3 transition-all duration-200 ${
        isDiscussClickable ? "cursor-pointer" : ""
      } ${
        isDiscussing
          ? "border-accent-cyan bg-accent-cyan/10 shadow-neon-cyan"
          : card.groupedWith !== null
            ? "border-border bg-cardH ml-6 opacity-80"
            : "border-border bg-card hover:border-border"
      }`}
      // Cluster theme accent — a 3-px left rule. Don't override the discussing
      // ring; that visual takes priority during the discuss phase.
      style={
        clusterColor && !isDiscussing
          ? { borderLeftColor: clusterColor, borderLeftWidth: 3 }
          : undefined
      }
    >
      <div className="flex items-start gap-2">
        {/* Action item checkbox in actions phase */}
        {phase === "actions" && card.groupedWith === null && (
          <button
            type="button"
            onClick={() => onToggleAction(card.id)}
            aria-label="Action item"
            aria-pressed={card.isActionItem}
            className="mt-0.5 shrink-0 text-sub hover:text-accent transition-colors"
          >
            {card.isActionItem ? (
              <CheckSquare className="w-4 h-4 text-accent" aria-hidden="true" />
            ) : (
              <Square className="w-4 h-4" aria-hidden="true" />
            )}
          </button>
        )}

        {isDiscussClickable ? (
          <button
            type="button"
            onClick={() => onToggleDiscussing(card.id)}
            aria-pressed={isDiscussing}
            className="flex-1 text-left text-sm leading-relaxed text-text focus-visible:outline-none after:absolute after:inset-0 after:rounded-[inherit] after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-accent"
          >
            {card.text}
          </button>
        ) : (
          <p
            className={`flex-1 text-sm leading-relaxed ${
              card.isActionItem && phase === "actions" ? "text-accent" : "text-text"
            }`}
          >
            {card.text}
          </p>
        )}

        <div className="flex items-center gap-1 shrink-0">
          {/* Vote button */}
          {(phase === "vote" || phase === "discuss" || phase === "actions") && (
            <button
              type="button"
              onClick={() => onVote(card.id)}
              disabled={!canVote && phase === "vote"}
              aria-label={`${card.votes} ${card.votes === 1 ? "vote" : "votes"}, vote for this card`}
              className={`relative z-10 flex items-center gap-1 px-1.5 py-0.5 rounded text-xs transition-all ${
                phase === "vote" && canVote
                  ? "text-sub hover:text-accent-magenta hover:bg-accent-magenta/10 cursor-pointer"
                  : phase === "vote" && !canVote
                    ? "text-sub cursor-not-allowed opacity-50"
                    : "text-sub cursor-default"
              }`}
            >
              <Heart
                className={`w-3.5 h-3.5 ${
                  card.votes > 0 ? "fill-accent-magenta text-accent-magenta" : ""
                }`}
                aria-hidden="true"
              />
              <span>{card.votes}</span>
            </button>
          )}

          {/* Delete */}
          {phase === "write" && (
            <button
              type="button"
              onClick={() => onDelete(card.id)}
              aria-label="Delete card"
              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100 p-1 text-sub hover:text-status-red transition-all"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {/* Group with selector */}
      {phase === "write" && otherCards.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border">
          <Select
            value={card.groupedWith ?? "__none__"}
            onValueChange={(val) => onGroup(card.id, val === "__none__" ? null : val)}
          >
            <SelectTrigger
              aria-label="Group with another card"
              className="min-touch-coarse h-6 text-xs bg-cardH border-border text-sub"
            >
              <SelectValue placeholder="Group with…" />
            </SelectTrigger>
            <SelectContent className="bg-card border-border">
              <SelectItem value="__none__" className="text-xs text-sub">
                No group
              </SelectItem>
              {otherCards.map((c) => (
                <SelectItem key={c.id} value={c.id} className="text-xs text-text">
                  {c.text.length > 40 ? c.text.slice(0, 40) + "…" : c.text}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Assignee input in actions phase */}
      {phase === "actions" && card.isActionItem && (
        <div className="mt-2 pt-2 border-t border-accent-cyan/20">
          <Input
            value={card.assignee}
            onChange={(e) => onAssigneeChange(card.id, e.target.value)}
            placeholder="Assign to…"
            aria-label="Assignee"
            className="h-6 text-xs bg-cardH border-border text-sub placeholder:text-sub"
          />
        </div>
      )}
    </motion.div>
  );
}
