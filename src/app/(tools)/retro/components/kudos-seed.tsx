"use client";

/**
 * "Kudos from Sprint 12", in the Write phase: the kudos the team gave
 * during the sprint, and one button that adds the ones not on the board yet
 * as cards in the appreciations column (with Undo). A kudos already added
 * says so, and is never added twice.
 */

import { useId } from "react";
import { Check, HeartHandshake } from "lucide-react";
import { Button } from "@/components/ui/button";
import { kudosOnBoard, type SprintKudos } from "../kudos";
import type { RetroCard } from "../types";

/** Kudos listed before the rest fold into "and N more". */
const SHOWN = 5;

export function KudosSeed({
  sprintName,
  kudos,
  cards,
  columnLabel,
  onAdd,
}: {
  sprintName: string;
  kudos: readonly SprintKudos[];
  cards: readonly RetroCard[];
  /** The column they go in (retroColumnFor's appreciation column). */
  columnLabel: string;
  /** Add these kudos as cards. */
  onAdd: (kudos: SprintKudos[]) => void;
}) {
  const headingId = useId();
  if (kudos.length === 0) return null;
  const onBoard = kudosOnBoard(cards);
  const pending = kudos.filter((k) => !onBoard.has(k.id));
  const shown = kudos.slice(0, SHOWN);
  const rest = kudos.length - shown.length;

  return (
    <section
      aria-labelledby={headingId}
      className="space-y-2 rounded-lg border border-border bg-card p-3"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <HeartHandshake className="h-4 w-4 text-accent" aria-hidden="true" />
        <h2 id={headingId} className="text-sm font-semibold text-text">
          Kudos from {sprintName}
        </h2>
        <span className="text-xs text-sub">
          {kudos.length} given during the sprint: appreciations the team already wrote.
        </span>
      </div>
      <ul className="space-y-1.5">
        {shown.map((k) => (
          <li
            key={k.id}
            className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-md border border-border bg-cardH px-2.5 py-1.5 text-sm"
          >
            <span className="min-w-0 flex-1 break-words text-text">
              <span className="font-medium">To {k.toName}</span>
              <span className="text-sub"> from {k.fromName}: </span>
              {k.message}
            </span>
            {onBoard.has(k.id) && (
              <span className="inline-flex items-center gap-1 text-xs text-success">
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                On the board
              </span>
            )}
          </li>
        ))}
      </ul>
      {rest > 0 && <p className="text-xs text-sub">And {rest} more.</p>}
      {pending.length > 0 ? (
        <Button type="button" variant="outline" size="sm" onClick={() => onAdd(pending)}>
          Add {pending.length} kudos as {pending.length === 1 ? "a card" : "cards"} in {columnLabel}
        </Button>
      ) : (
        <p className="text-xs text-sub">Every kudos is on the board, in {columnLabel}.</p>
      )}
    </section>
  );
}
