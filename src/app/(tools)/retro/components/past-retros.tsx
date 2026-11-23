"use client";

/**
 * Past retros, under the format picker: each finished board's date, format
 * and action items, newest first and open. Checking last time's actions is
 * how a retro should start.
 *
 * Up to two years of them are kept (RETRO_ARCHIVE_LIMIT), so the list shows
 * the latest few and keeps the rest behind "Show all": the page stays short
 * for the retro about to start, and nothing is hidden for good.
 */

import { useState } from "react";
import { ChevronDown, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RetroBoard } from "@/lib/stores/workspace-types";
import { retroActionItems } from "../archive";

/** Past retros listed before "Show all": a quarter of two-week sprints, and a few more. */
export const PAST_RETROS_SHOWN = 8;

function formatRetroDate(iso: string | undefined): string {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime())
    ? d.toLocaleDateString(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "Unknown date";
}

export function PastRetros({
  retros,
  onDelete,
  sprintNames,
}: {
  retros: RetroBoard[];
  onDelete: (retro: RetroBoard) => void;
  /** Sprint id → name, to say which sprint each retro looked back on. */
  sprintNames?: ReadonlyMap<string, string>;
}) {
  const [all, setAll] = useState(false);
  if (retros.length === 0) return null;
  const shown = all ? retros : retros.slice(0, PAST_RETROS_SHOWN);
  const more = retros.length - PAST_RETROS_SHOWN;

  return (
    <section aria-labelledby="past-retros-heading" className="space-y-3">
      <h2 id="past-retros-heading" className="text-lg font-display font-bold text-text">
        Past retros
      </h2>
      <ul id="past-retros-list" className="space-y-2">
        {shown.map((retro, i) => {
          const actions = retroActionItems(retro);
          const date = formatRetroDate(retro.archivedAt);
          const sprint = retro.sprintId ? sprintNames?.get(retro.sprintId) : undefined;
          return (
            <li key={retro.id}>
              <details open={i === 0} className="group rounded-lg border border-border bg-card">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
                  <span className="font-medium text-text">{date}</span>
                  <span className="min-w-0 text-sub">
                    {sprint ? `· ${sprint} ` : ""}· {retro.format.name} · {retro.cards.length} card
                    {retro.cards.length !== 1 ? "s" : ""} · {actions.length} action
                    {actions.length !== 1 ? "s" : ""}
                  </span>
                  <ChevronDown
                    className="ml-auto h-4 w-4 shrink-0 text-sub transition-transform group-open:rotate-180"
                    aria-hidden="true"
                  />
                </summary>
                <div className="border-t border-border px-4 py-3 text-sm">
                  {actions.length > 0 ? (
                    <>
                      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-sub">
                        {i === 0 ? "Actions to check in on" : "Actions"}
                      </h3>
                      <ul className="list-disc space-y-1 pl-5 text-text">
                        {actions.map((a) => (
                          <li key={a.id}>
                            {a.text}
                            {a.assignee && <span className="text-sub"> — {a.assignee}</span>}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p className="text-sub">No action items were recorded.</p>
                  )}
                  <button
                    type="button"
                    onClick={() => onDelete(retro)}
                    aria-label={`Delete the ${date} retro`}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-sub hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Delete
                  </button>
                </div>
              </details>
            </li>
          );
        })}
      </ul>
      {/* One button that stays where it is, so the keyboard keeps its place. */}
      {more > 0 && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={all}
          aria-controls="past-retros-list"
          onClick={() => setAll((v) => !v)}
        >
          {all
            ? `Show the latest ${PAST_RETROS_SHOWN} only`
            : `Show all ${retros.length} past retros`}
        </Button>
      )}
    </section>
  );
}
