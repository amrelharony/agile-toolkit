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
 *
 * `canModerate={false}` (a visitor-room participant) keeps only the vote
 * button in the Vote phase. Votes, action items and assignees still show,
 * read-only; delete, group, discuss focus and Send to are gone.
 *
 * Editing: with `onEdit`, the card text is click-to-edit in every phase
 * (Enter saves, Escape cancels, an emptied card reverts). In Discuss, where
 * a click on the card focuses it, an Edit button opens the editor instead.
 * Without `onEdit` (a participant) the text is read-only.
 *
 * An action's owner is picked from the team roster and saved when the field
 * is left (OwnerField). A card another tool sent here (a kudos, a red health
 * check) links back to it ("From kudos"). Example cards can't be sent to
 * another tool: the example must never reach the team's real backlog.
 */

import { motion } from "framer-motion";
import { Heart, Trash2, CheckSquare, Square, Pencil } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { SourceLink } from "@/components/handoff/source-link";
import { isExampleId } from "@/components/tool-frame/example-data";
import { InlineItemEditor, useInlineEdit } from "@/components/shared/inline-item-editor";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { RetroColumn } from "@/lib/constants/retro-formats";
import type { HandoffLink } from "@/lib/handoffs/types";
import { SendToMenu } from "@/components/handoff/send-to-menu";
import { RETRO_CURRENT_ID } from "@/lib/retro/board";
import type { BoardPhase, RetroCard } from "../types";
import { shortText } from "../helpers";
import { OwnerField } from "./owner-field";

/** Where a retro action can be sent. */
export const RETRO_ACTION_ROUTES = ["impediment", "kanban"] as const;

/** In place of "Send to…" on an example card. */
export function ExampleNotSent({ className }: { className?: string }) {
  return (
    <span className={`text-xs text-sub ${className ?? ""}`}>
      Example card: not sent to other tools
    </span>
  );
}

export function RetroCardItem({
  card,
  allCards,
  phase,
  canVote,
  highlighted = false,
  highlightWord,
  onVote,
  onDelete,
  onGroup,
  onToggleAction,
  onAssigneeChange,
  onToggleDiscussing,
  onLinksChange,
  onEdit,
  maxCardLength,
  canModerate = true,
}: {
  card: RetroCard;
  allCards: RetroCard[];
  column: RetroColumn;
  phase: BoardPhase;
  canVote: boolean;
  /** Ringed: the card's group uses the common word picked under "Common words". */
  highlighted?: boolean;
  /** That word, so a ringed card says it to screen readers (the ring is visual only). */
  highlightWord?: string;
  onVote: (id: string) => void;
  onDelete: (id: string) => void;
  onGroup: (id: string, parentId: string | null) => void;
  onToggleAction: (id: string) => void;
  onAssigneeChange: (id: string, val: string) => void;
  onToggleDiscussing: (id: string) => void;
  /** Record where an action was sent; without it the card offers no Send to. */
  onLinksChange?: (
    id: string,
    update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]
  ) => void;
  /** Change the card's text. Without it the text is read-only (a room participant). */
  onEdit?: (id: string, text: string) => void;
  /** Longest card text the editor accepts, as the add box does. */
  maxCardLength?: number;
  /** False for a visitor-room participant: vote in Vote, everything else read-only. */
  canModerate?: boolean;
}) {
  const edit = useInlineEdit();
  const otherCards = allCards.filter(
    (c) => c.id !== card.id && c.columnKey === card.columnKey && c.groupedWith === null
  );

  const isDiscussing = card.discussing;
  // Only top-level cards in the Discuss phase get the click-to-focus affordance.
  // Grouped child cards inherit visual state from the parent and aren't toggled.
  const isDiscussClickable = canModerate && phase === "discuss" && card.groupedWith === null;
  const votesLabel = `${card.votes} ${card.votes === 1 ? "vote" : "votes"}`;
  const isExample = isExampleId(card.id);

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
      }${
        // The common-word ring; the discussing highlight takes priority.
        highlighted && !isDiscussing ? " ring-2 ring-accent/70" : ""
      }`}
      data-highlighted={highlighted || undefined}
    >
      {highlighted && highlightWord && (
        <span className="sr-only">Ringed for “{highlightWord}”.</span>
      )}
      <div className="flex items-start gap-2">
        {/* Action item checkbox in actions phase (a read-only mark for participants) */}
        {phase === "actions" && card.groupedWith === null && !canModerate && card.isActionItem && (
          <span className="-m-1 p-1 mt-0.5 shrink-0">
            <CheckSquare className="w-4 h-4 text-accent" aria-hidden="true" />
            <span className="sr-only">Action item</span>
          </span>
        )}
        {phase === "actions" && card.groupedWith === null && canModerate && (
          <button
            type="button"
            onClick={() => onToggleAction(card.id)}
            aria-label="Action item"
            aria-pressed={card.isActionItem}
            className="min-touch-coarse -m-1 p-1 mt-0.5 shrink-0 text-sub hover:text-accent transition-colors"
          >
            {card.isActionItem ? (
              <CheckSquare className="w-4 h-4 text-accent" aria-hidden="true" />
            ) : (
              <Square className="w-4 h-4" aria-hidden="true" />
            )}
          </button>
        )}

        {edit.editing && onEdit ? (
          <InlineItemEditor
            className="flex-1"
            label="Edit card"
            title={card.text}
            titleLabel="Card text"
            titleMaxLength={maxCardLength}
            onDone={(next, { refocus }) => {
              edit.stop({ refocus });
              if (next) onEdit(card.id, next.title);
            }}
          />
        ) : isDiscussClickable ? (
          <button
            type="button"
            onClick={() => onToggleDiscussing(card.id)}
            aria-pressed={isDiscussing}
            className="flex-1 text-left text-sm leading-relaxed text-text focus-visible:outline-none after:absolute after:inset-0 after:rounded-[inherit] after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-accent"
          >
            {card.text}
          </button>
        ) : onEdit ? (
          <button
            ref={edit.triggerRef}
            type="button"
            onClick={edit.start}
            title="Click to edit"
            className={`flex-1 min-w-0 break-words rounded-sm text-left text-sm leading-relaxed cursor-text transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
              card.isActionItem && phase === "actions" ? "text-accent" : "text-text"
            }`}
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
          {/* Edit, in Discuss: a click on the card text focuses the card there */}
          {isDiscussClickable && onEdit && !edit.editing && (
            <IconButton
              ref={edit.triggerRef}
              label="Edit card"
              icon={<Pencil aria-hidden="true" />}
              tooltip={false}
              onClick={edit.start}
              className="relative z-10 h-6 w-6 md:h-6 md:w-6 p-1 text-sub hover:text-accent opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100 [&_svg]:size-3.5"
            />
          )}

          {/* Vote count, read-only for participants outside the Vote phase */}
          {!canModerate && (phase === "discuss" || phase === "actions") && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 text-xs text-sub">
              <Heart
                className={`w-3.5 h-3.5 ${
                  card.votes > 0 ? "fill-accent-magenta text-accent-magenta" : ""
                }`}
                aria-hidden="true"
              />
              <span aria-hidden="true">{card.votes}</span>
              <span className="sr-only">{votesLabel}</span>
            </span>
          )}

          {/* Vote button */}
          {(phase === "vote" || (canModerate && (phase === "discuss" || phase === "actions"))) && (
            <button
              type="button"
              onClick={() => onVote(card.id)}
              disabled={!canVote && phase === "vote"}
              aria-label={`${votesLabel}, vote for this card`}
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
          {phase === "write" && canModerate && (
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
      {phase === "write" && canModerate && otherCards.length > 0 && (
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

      {/* Assignee, read-only for participants */}
      {phase === "actions" && card.isActionItem && !canModerate && card.assignee && (
        <p className="mt-2 pt-2 border-t border-accent-cyan/20 text-xs text-sub">
          Assigned to {card.assignee}
        </p>
      )}

      {/* Owner, and Send to, in actions phase */}
      {phase === "actions" && card.isActionItem && canModerate && (
        <div className="relative z-10 mt-2 pt-2 border-t border-accent-cyan/20 flex flex-wrap items-start gap-1.5">
          <OwnerField
            value={card.assignee ?? ""}
            label={`Owner of “${shortText(card.text)}”`}
            onCommit={(name) => onAssigneeChange(card.id, name)}
          />
          {onLinksChange &&
            card.groupedWith === null &&
            (isExample ? (
              <ExampleNotSent className="self-center" />
            ) : (
              <SendToMenu
                routes={RETRO_ACTION_ROUTES}
                item={{
                  title: card.text,
                  owner: card.assignee || undefined,
                  sourceRef: { tool: "retro", id: card.id, doc: RETRO_CURRENT_ID },
                }}
                sentTo={card.sentTo}
                onLinksChange={(update) => onLinksChange(card.id, update)}
                className="relative z-10 h-11 shrink-0 md:h-9"
              />
            ))}
        </div>
      )}

      {/* Where a card another tool sent came from */}
      {card.sourceRef && canModerate && (
        <SourceLink sourceRef={card.sourceRef} className="relative z-10 mt-1.5" />
      )}
    </motion.div>
  );
}
