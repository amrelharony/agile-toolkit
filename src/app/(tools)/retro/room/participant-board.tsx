"use client";

/**
 * The columns of a visitor room as a participant sees them: the host's
 * board, rendered from its last snapshot through the regular column panels
 * in participant mode (`canModerate={false}`). Adding a card (Write) and
 * voting (Vote) call back to the room; nothing here edits the board itself.
 */

import { VISITOR_LIMITS } from "@/lib/realtime/visitor-rooms";
import { MAX_VOTES, type BoardState } from "../types";
import { columnGridClass } from "../helpers";
import { RetroColumnPanel } from "../components/retro-column-panel";

const noop = () => {};

export interface ParticipantBoardProps {
  board: BoardState;
  /** Votes this person has left. */
  votesLeft: number;
  /** Whether this person may add cards and vote (has a seat, room open). */
  canAct: boolean;
  onAdd: (columnKey: string, text: string) => void;
  onVote: (cardId: string) => void;
}

export function ParticipantBoard({
  board,
  votesLeft,
  canAct,
  onAdd,
  onVote,
}: ParticipantBoardProps) {
  const columns = board.format.columns;
  if (columns.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-card p-4 text-sm text-sub">
        The host&apos;s board has no columns yet.
      </p>
    );
  }
  const votesUsed = canAct ? MAX_VOTES - votesLeft : MAX_VOTES;
  return (
    <div className={`grid ${columnGridClass(columns.length)} gap-4`}>
      {columns.map((col) => (
        <RetroColumnPanel
          key={col.key}
          column={col}
          cards={board.cards.filter((c) => c.columnKey === col.key)}
          allCards={board.cards}
          phase={board.phase}
          votesUsed={votesUsed}
          onAdd={onAdd}
          onVote={onVote}
          onDelete={noop}
          onGroup={noop}
          onToggleAction={noop}
          onAssigneeChange={noop}
          onToggleDiscussing={noop}
          canModerate={false}
          canAdd={canAct}
          maxCardLength={VISITOR_LIMITS.maxTextChars}
        />
      ))}
    </div>
  );
}
