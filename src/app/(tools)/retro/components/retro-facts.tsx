"use client";

/**
 * "Facts from Sprint 12": what the rest of the toolkit already knows about
 * the sprint, above the columns, so the retro starts from what happened
 * rather than from memory. Read-only; each fact names the tool it came from
 * and links there to change it. Open in the Write phase, where the team
 * reads it, and folded away after (a click opens it again).
 */

import { useId } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FactLine } from "../facts-text";

const LINK =
  "inline-flex items-center gap-0.5 whitespace-nowrap rounded text-xs text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export function RetroFactsPanel({
  sprintName,
  lines,
  example = false,
  defaultOpen,
}: {
  sprintName: string;
  lines: readonly FactLine[];
  /** The example's facts: said so, and no links out of the example. */
  example?: boolean;
  defaultOpen: boolean;
}) {
  const headingId = useId();
  return (
    <details
      open={defaultOpen}
      aria-labelledby={headingId}
      className="group rounded-lg border border-border bg-card"
    >
      <summary className="flex min-h-11 cursor-pointer select-none list-none flex-wrap items-center gap-x-2 gap-y-0.5 px-4 py-2 text-sm [&::-webkit-details-marker]:hidden">
        <ClipboardList className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
        <span id={headingId} className="font-semibold text-text">
          Facts from {sprintName}
        </span>
        <span className="text-xs text-sub">
          {example ? "The example sprint's" : "Read from the other tools"}
        </span>
        <ChevronDown
          className="ml-auto h-4 w-4 shrink-0 text-sub transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <dl className="divide-y divide-border border-t border-border">
        {lines.map((line) => (
          <div
            key={line.key}
            className="flex flex-col gap-0.5 px-4 py-2 sm:flex-row sm:items-baseline sm:gap-4"
          >
            <dt className="shrink-0 text-xs font-semibold uppercase tracking-wide text-sub sm:w-40">
              {line.label}
            </dt>
            <dd
              className={cn(
                "min-w-0 flex-1 break-words text-sm",
                line.missing ? "text-sub" : "text-text"
              )}
            >
              {line.sentence}{" "}
              {line.href && (
                <Link href={line.href} className={LINK}>
                  {line.tool}
                  <ArrowRight className="h-3 w-3" aria-hidden="true" />
                </Link>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
