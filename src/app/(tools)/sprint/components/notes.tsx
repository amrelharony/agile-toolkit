"use client";

import Link from "@/components/motion/transition-link";
import { AlertTriangle, ArrowRight, Lightbulb } from "lucide-react";
import { TOUCH_LINK } from "@/components/ui/touch-target";
import { cn } from "@/lib/utils";
import type { CockpitNote } from "../view";

/**
 * The cockpit's notes, each a card with one link to where it is dealt with:
 * a closed sprint whose goal has no answer yet, how many of the last
 * retro's actions are in the sprint, or that no improvement item is. They
 * stay on the page until what they point at is done; nothing here pops up.
 */
export function CockpitNotes({ notes }: { notes: readonly CockpitNote[] }) {
  if (notes.length === 0) return null;
  return (
    <ul aria-label="Worth a look" className="space-y-2">
      {notes.map((note) => {
        const warning = note.tone === "warning";
        const Icon = warning ? AlertTriangle : Lightbulb;
        return (
          <li
            key={note.id}
            data-note={note.id}
            className={cn(
              "flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:gap-3",
              warning ? "border-warning/40 bg-warning/5" : "border-accent/30 bg-accent/5"
            )}
          >
            <Icon
              className={cn(
                "hidden h-4 w-4 shrink-0 sm:block",
                warning ? "text-warning" : "text-accent"
              )}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className="break-words text-sm font-medium text-text">{note.title}</p>
              <p className="break-words text-sm text-sub">{note.detail}</p>
            </div>
            <Link
              href={note.href}
              className={cn(
                "inline-flex shrink-0 items-center gap-1 self-start text-sm font-medium text-accent hover:underline sm:self-center",
                TOUCH_LINK
              )}
            >
              {note.cta}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
