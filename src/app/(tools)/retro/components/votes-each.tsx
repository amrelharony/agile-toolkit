"use client";

/**
 * "Votes each": how many votes each person has on this board (3, 5 or 8),
 * set by the facilitator in Write or Vote. It is saved on the board, and a
 * live room's snapshot carries it to everyone's device.
 */

import { ToggleGroup, type ToggleOption } from "@/components/ui/toggle-group";
import { RETRO_VOTE_OPTIONS, type RetroVotes } from "@/lib/retro/board";

const OPTIONS: ToggleOption<RetroVotes>[] = RETRO_VOTE_OPTIONS.map((n) => ({
  value: n,
  label: `${n} votes`,
}));

export function VotesEach({
  value,
  onChange,
}: {
  value: RetroVotes;
  onChange: (votes: RetroVotes) => void;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="font-semibold text-text" aria-hidden="true">
        Votes each
      </span>
      <ToggleGroup
        label="Votes each person has"
        size="sm"
        options={OPTIONS}
        value={value}
        onValueChange={onChange}
      />
    </span>
  );
}
