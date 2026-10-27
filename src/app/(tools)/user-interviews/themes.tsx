"use client";

/**
 * The themes across the interviews, counted per participant (one person
 * tagging "pricing" on five quotes is one voice): each is a toggle that
 * shows the quotes behind it across interviews, with who said them (a
 * pseudonym while anonymising is on) and a way to open that interview.
 */

import { useState } from "react";
import { Hash, X } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { quotesTagged, type ThemeCount } from "@/lib/interviews/model";
import type { Interview } from "@/lib/stores/workspace-types";
import { cn } from "@/lib/utils";
import { themeBadge } from "./view";

/** Themes shown before "Show all". */
export const THEMES_SHOWN = 24;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function ThemePanel({
  themes,
  people,
  active,
  onToggle,
}: {
  themes: readonly ThemeCount[];
  /** Distinct participants across every interview. */
  people: number;
  active: string | null;
  onToggle: (tag: string) => void;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? themes : themes.slice(0, THEMES_SHOWN);
  return (
    <SectionCard
      title="Themes"
      icon={Hash}
      titleSuffix={<span className="text-xs text-sub">by participants who raised them</span>}
    >
      <ul className="flex flex-wrap gap-2" aria-label="Themes, most participants first">
        {shown.map((t) => {
          const on = active === t.tag;
          return (
            <li key={t.tag}>
              <button
                type="button"
                aria-pressed={on}
                // The visible text, plus the quote count it leaves out.
                aria-label={`${t.tag} · ${themeBadge(t, people)} (${plural(t.quotes, "quote")})`}
                onClick={() => onToggle(t.tag)}
                className={cn(
                  "min-touch-coarse inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  on
                    ? "border-accent bg-accent/20 text-text"
                    : "border-accent/30 bg-accent/5 text-accent hover:bg-accent/10"
                )}
              >
                <span className="font-medium">{t.tag}</span>
                <span>· {themeBadge(t, people)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {themes.length > THEMES_SHOWN && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="mt-2"
          onClick={() => setAll((v) => !v)}
        >
          {all ? "Show fewer" : `Show all ${themes.length}`}
        </Button>
      )}
    </SectionCard>
  );
}

/** The quotes tagged `tag`, across interviews, as the page shows them (anonymised or not). */
export function TaggedQuotes({
  tag,
  interviews,
  shownAs,
  onOpen,
  onClear,
}: {
  tag: string;
  interviews: readonly Interview[];
  /** How each interview reads here: anonymised while the toggle is on. */
  shownAs: (i: Interview) => Interview;
  onOpen: (interviewId: string) => void;
  onClear: () => void;
}) {
  const found = quotesTagged(interviews, tag);
  return (
    <section
      aria-label={`Quotes tagged ${tag}`}
      className="space-y-3 rounded-lg border border-accent/30 bg-card p-3 sm:p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-text">
          Quotes tagged “{tag}” ({found.length})
        </h2>
        <Button type="button" size="sm" variant="ghost" className="gap-1" onClick={onClear}>
          <X aria-hidden="true" />
          Clear filter
        </Button>
      </div>
      <ul className="space-y-2">
        {found.map(({ interview, quote }) => {
          const view = shownAs(interview);
          const text = view.quotes.find((q) => q.id === quote.id)?.text ?? "";
          return (
            <li key={quote.id} className="rounded-md border border-border bg-surface-deep p-2.5">
              <blockquote className="whitespace-pre-line break-words text-sm text-text">
                “{text.trim()}”
              </blockquote>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-sub">
                <span>
                  {view.participant || "Unnamed"} · {(interview.date ?? "").slice(0, 10)}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-1 text-xs text-accent hover:bg-accent/10"
                  aria-label={`Open the interview with ${view.participant || "an unnamed participant"}, ${(interview.date ?? "").slice(0, 10)}`}
                  onClick={() => onOpen(interview.id)}
                >
                  Open the interview
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
