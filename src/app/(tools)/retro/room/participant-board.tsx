"use client";

/**
 * The columns of a visitor room as a participant sees them: the host's
 * board, rendered from its last snapshot through the regular column panels
 * in participant mode (`canModerate={false}`). Adding a card (Write) and
 * voting (Vote) call back to the room; nothing here edits the board itself.
 *
 * While the host hides cards (Write, with "Hide cards while writing" on),
 * `board.cards` holds only this person's own cards and `hiddenCounts` how
 * many of everyone else's each column holds.
 *
 * A participant may delete its own cards in Write (`ownIds`, "Delete my
 * card") and take its own votes back in Vote (`myVotes`, "Take my vote
 * back"). It gets no edit control: only a member promoted to host passes
 * `onEdit`, to fix card text on the board it now hosts.
 *
 * A multi-line paste sends one intent per line, so it's capped at half the
 * host's per-sender burst: the rest of a bigger paste would be dropped
 * silently on the host's side.
 */

import { VISITOR_LIMITS } from "@/lib/realtime/visitor-rooms";
import { DEFAULT_RETRO_VOTES } from "@/lib/retro/board";
import type { BoardState } from "../types";
import { columnGridClass } from "../helpers";
import { RetroColumnPanel } from "../components/retro-column-panel";

const noop = () => {};

/** Most cards one paste sends: half the host's inbound burst per sender. */
export const PARTICIPANT_PASTE_CAP = Math.floor(VISITOR_LIMITS.inbound.perSender.capacity / 2);

export interface ParticipantBoardProps {
  /** The board as this person sees it (only their own cards while cards are hidden). */
  board: BoardState;
  /** Votes each person has (the host's; 3 when not given). */
  votesPerPerson?: number;
  /** Votes this person has left. */
  votesLeft: number;
  /** Whether this person may add cards and vote (has a seat, room open). */
  canAct: boolean;
  /** While cards are hidden: how many each column holds that this person can't see. */
  hiddenCounts?: Readonly<Record<string, number>> | null;
  /** The cards this person added, which it may delete in Write. */
  ownIds?: ReadonlySet<string>;
  /** This person's votes per card. */
  myVotes?: Readonly<Record<string, number>>;
  onAdd: (columnKey: string, text: string) => void;
  onVote: (cardId: string) => void;
  /** "Delete my card". */
  onDeleteOwn?: (cardId: string) => void;
  /** "Take my vote back". */
  onUnvote?: (cardId: string) => void;
  /** Hosting (promoted) only: change a card's text. Participants never get it. */
  onEdit?: (cardId: string, text: string) => void;
}

export function ParticipantBoard({
  board,
  votesPerPerson = DEFAULT_RETRO_VOTES,
  votesLeft,
  canAct,
  hiddenCounts,
  ownIds,
  myVotes,
  onAdd,
  onVote,
  onDeleteOwn,
  onUnvote,
  onEdit,
}: ParticipantBoardProps) {
  const columns = board.format.columns;
  if (columns.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-card p-4 text-sm text-sub">
        The host&apos;s board has no columns yet.
      </p>
    );
  }
  const votesUsed = canAct ? votesPerPerson - votesLeft : votesPerPerson;
  const hiddenIn = (key: string) =>
    hiddenCounts && Object.prototype.hasOwnProperty.call(hiddenCounts, key) ? hiddenCounts[key] : 0;
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
          maxVotes={votesPerPerson}
          hiddenCount={hiddenIn(col.key)}
          onAdd={onAdd}
          onVote={onVote}
          onEdit={onEdit}
          onDelete={canAct && onDeleteOwn ? onDeleteOwn : noop}
          onGroup={noop}
          onToggleAction={noop}
          onAssigneeChange={noop}
          onToggleDiscussing={noop}
          canModerate={false}
          canAdd={canAct}
          ownIds={canAct ? ownIds : undefined}
          myVotes={myVotes}
          onUnvote={canAct ? onUnvote : undefined}
          maxCardLength={VISITOR_LIMITS.maxTextChars}
          pasteCap={PARTICIPANT_PASTE_CAP}
        />
      ))}
    </div>
  );
}
