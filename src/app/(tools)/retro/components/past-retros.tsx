"use client";

/**
 * Past retros, under the format picker: each finished board's date, format
 * and action items, newest first and open. Checking last time's actions is
 * how a retro should start.
 */

import { ChevronDown, Trash2 } from "lucide-react";
import type { RetroBoard } from "@/lib/stores/workspace-types";
import { retroActionItems } from "../archive";

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
}: {
  retros: RetroBoard[];
  onDelete: (retro: RetroBoard) => void;
}) {
  if (retros.length === 0) return null;

  return (
    <section aria-labelledby="past-retros-heading" className="space-y-3">
      <h2 id="past-retros-heading" className="text-lg font-display font-bold text-text">
        Past retros
      </h2>
      <ul className="space-y-2">
        {retros.map((retro, i) => {
          const actions = retroActionItems(retro);
          const date = formatRetroDate(retro.archivedAt);
          return (
            <li key={retro.id}>
              <details open={i === 0} className="group rounded-lg border border-border bg-card">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
                  <span className="font-medium text-text">{date}</span>
                  <span className="text-sub">
                    · {retro.format.name} · {retro.cards.length} card
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
    </section>
  );
}
