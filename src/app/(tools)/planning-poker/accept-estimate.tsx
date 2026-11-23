"use client";

/**
 * Accepting the round's estimate (host only).
 *
 * The host used to get one button per value somebody voted, so a team that
 * talked a 3-and-8 round down to a 5 had no way to record the 5. Every
 * estimate card on the deck is offered now, starting on the suggested one
 * (the middle of the votes by deck position, ./consensus); Accept commits
 * whichever card is picked.
 *
 * Given the round's votes on a numeric deck, it also offers the
 * Three-point check (./three-point-check), whose "Use {card}" picks the
 * card here: the pick is this component's own, so there's one accept path.
 */

import { useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { estimateCards } from "@/lib/estimation/consensus";
import { threePointStart } from "@/lib/estimation/three-point";
import { ThreePointCheck } from "./three-point-check";

export function AcceptEstimate({
  deck,
  suggested,
  onAccept,
  children,
  votes,
  onThreePointUsed,
}: {
  deck: readonly string[];
  /** The card to start on; null when nobody played an estimate card. */
  suggested: string | null;
  onAccept: (value: string) => void;
  /** Rendered under the controls with the picked card (the guide's notes for it). */
  children?: (pick: string | null) => ReactNode;
  /**
   * The revealed votes. With two or more estimates on a numeric deck, the
   * Three-point check starts from them; without them there is no check.
   */
  votes?: readonly string[];
  /** "Use {card}" in the Three-point check was pressed (the page logs it). */
  onThreePointUsed?: (card: string, expected: number) => void;
}) {
  const cards = estimateCards(deck);
  const [pick, setPick] = useState<string | null>(
    suggested !== null && cards.includes(suggested) ? suggested : null
  );
  const [error, setError] = useState<string | null>(null);
  const start = votes ? threePointStart(votes, deck) : null;

  const accept = () => {
    if (pick === null) {
      setError("Pick the card the team agreed on.");
      return;
    }
    onAccept(pick);
  };

  if (cards.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-sub">Accept estimate:</span>
        <ToggleGroup
          label="Estimate to accept"
          size="sm"
          // A mouse keeps the compact chips; on a touch screen each card is a
          // 44px target with the default size's padding and 14px text.
          className="pointer-coarse:[&>button]:min-h-11 pointer-coarse:[&>button]:min-w-11 pointer-coarse:[&>button]:px-3 pointer-coarse:[&>button]:text-sm"
          options={cards.map((c) => ({
            value: c,
            label: c,
            description: c === suggested ? "Suggested: the middle of the votes" : undefined,
          }))}
          value={pick}
          onValueChange={(v) => {
            setPick(v);
            setError(null);
          }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button
          type="button"
          size="sm"
          onClick={accept}
          className="gap-1.5 pointer-coarse:min-h-11"
        >
          <Check aria-hidden="true" />
          {pick === null ? "Accept" : `Accept ${pick}`}
        </Button>
        {suggested !== null && (
          <span className="text-xs text-sub">
            Suggested: <span className="font-data text-text">{suggested}</span>, the middle of the
            votes.
          </span>
        )}
      </div>
      {error && (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
      {start && (
        <ThreePointCheck
          deck={deck}
          start={start}
          onUse={(card, expected) => {
            if (cards.includes(card)) {
              setPick(card);
              setError(null);
            }
            onThreePointUsed?.(card, expected);
          }}
        />
      )}
      {children?.(pick)}
    </div>
  );
}
