"use client";

/**
 * "Common words": the words two or more cards share (themes.ts), once the
 * board has enough cards for that to mean something. Each word is a toggle
 * that rings its cards on the board, so the team can see a theme at a
 * glance and group the cards if they agree; naming the themes is left to
 * the team, or to the AI prompt, which gets these groups.
 */

import { useId } from "react";
import { Tags } from "lucide-react";
import { cn } from "@/lib/utils";
import type { KeywordTheme } from "../themes";

export function CommonWords({
  themes,
  highlighted,
  onToggle,
}: {
  themes: readonly KeywordTheme[];
  /** The word whose cards are ringed, if any. */
  highlighted: string | null;
  onToggle: (keyword: string) => void;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="space-y-2 rounded-lg border border-border bg-card p-3"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Tags className="h-4 w-4 text-accent" aria-hidden="true" />
        <h2 id={headingId} className="text-sm font-semibold text-text">
          Common words
        </h2>
        <span className="text-xs text-sub">
          {themes.length > 0
            ? "Words two or more cards share. Pick one to ring its cards."
            : "No word is shared by two or more cards yet."}
        </span>
      </div>
      {themes.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {themes.map((t) => {
            const on = highlighted === t.keyword;
            const n = t.cardIds.length;
            return (
              <li key={t.keyword}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => onToggle(t.keyword)}
                  className={cn(
                    "min-touch-coarse inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                    on
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border bg-cardH text-text hover:border-accent/40 hover:text-accent"
                  )}
                >
                  <span className="font-medium">{t.keyword}</span>{" "}
                  <span className="text-sub">
                    · {n} {n === 1 ? "card" : "cards"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
