"use client";

import type { RaciLetter } from "@/lib/stores/workspace-types";
import { RACI_LETTERS, RACI_LETTER_NAME, toggleLetter } from "@/lib/raci/model";
import { cn } from "@/lib/utils";

/** Each letter's theme colours (tokens only), shared by the chips and the legend. */
export const LETTER_CLASS: Record<RaciLetter, { on: string; text: string }> = {
  R: { on: "border-accent/60 bg-accent/15 text-accent", text: "text-accent" },
  A: {
    on: "border-accent-magenta/60 bg-accent-magenta/15 text-accent-magenta",
    text: "text-accent-magenta",
  },
  C: {
    on: "border-accent-green/60 bg-accent-green/15 text-accent-green",
    text: "text-accent-green",
  },
  I: {
    on: "border-accent-amber/60 bg-accent-amber/15 text-accent-amber",
    text: "text-accent-amber",
  },
};

/**
 * One cell of the matrix as four toggle chips, R, A, C and I, instead of a
 * menu that cycled one letter: a role can be Accountable and Responsible
 * at once (A/R). Pressing C or I replaces what was there (someone
 * consulted isn't doing the work); pressing R or A toggles it alongside
 * the other. Each chip is a toggle button named in full words, and the
 * group is named by its activity and role.
 */
export function CellChips({
  letters,
  label,
  onChange,
  className,
}: {
  letters: readonly RaciLetter[];
  /** "Sprint planning, Sam". */
  label: string;
  onChange: (next: RaciLetter[]) => void;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn("flex flex-wrap gap-1", className)}>
      {RACI_LETTERS.map((l) => {
        const on = letters.includes(l);
        return (
          <button
            key={l}
            type="button"
            aria-pressed={on}
            aria-label={RACI_LETTER_NAME[l]}
            title={RACI_LETTER_NAME[l]}
            onClick={() => onChange(toggleLetter(letters, l))}
            className={cn(
              "min-touch-coarse inline-flex h-7 w-7 items-center justify-center rounded border font-data text-xs font-bold transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              on ? LETTER_CLASS[l].on : "border-border bg-card text-sub hover:text-text"
            )}
          >
            {l}
          </button>
        );
      })}
    </div>
  );
}
