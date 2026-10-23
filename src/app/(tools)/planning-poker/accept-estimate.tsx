"use client";

/**
 * Accepting the round's estimate (host only).
 *
 * The host used to get one button per value somebody voted, so a team that
 * talked a 3-and-8 round down to a 5 had no way to record the 5. Every
 * estimate card on the deck is offered now, starting on the suggested one
 * (the middle of the votes by deck position, ./consensus); Accept commits
 * whichever card is picked.
 */

import { useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { estimateCards } from "./consensus";

export function AcceptEstimate({
  deck,
  suggested,
  onAccept,
  children,
}: {
  deck: readonly string[];
  /** The card to start on; null when nobody played an estimate card. */
  suggested: string | null;
  onAccept: (value: string) => void;
  /** Rendered under the controls with the picked card (the guide's notes for it). */
  children?: (pick: string | null) => ReactNode;
}) {
  const cards = estimateCards(deck);
  const [pick, setPick] = useState<string | null>(
    suggested !== null && cards.includes(suggested) ? suggested : null
  );
  const [error, setError] = useState<string | null>(null);

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
        <Button type="button" size="sm" onClick={accept} className="gap-1.5">
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
      {children?.(pick)}
    </div>
  );
}
