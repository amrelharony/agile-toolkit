"use client";

/**
 * "What's missing": a strategy map's open checks (lib/strategy-map/checks),
 * the no-AI gaps list. The first few show; the rest open on request, so a
 * phone isn't one long list.
 */

import { useId, useState } from "react";
import { CircleCheck, CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MapCheck } from "@/lib/strategy-map/checks";

/** How many checks show before "Show all". */
const SHOWN = 5;

export function ChecksList({ checks }: { checks: readonly MapCheck[] }) {
  const [all, setAll] = useState(false);
  const headingId = useId();
  const shown = all ? checks : checks.slice(0, SHOWN);
  return (
    <section
      aria-labelledby={headingId}
      className="space-y-2 rounded-lg border border-border bg-card p-3"
    >
      <h3 id={headingId} className="text-sm font-semibold text-text">
        What&apos;s missing
      </h3>
      {checks.length === 0 ? (
        <p className="flex items-center gap-1.5 text-sm text-success">
          <CircleCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
          Nothing for now.
        </p>
      ) : (
        <>
          <ul className="space-y-1.5">
            {shown.map((c) => (
              <li key={c.id} className="flex items-start gap-1.5 text-sm text-text">
                <CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                <span className="min-w-0 break-words">{c.text}</span>
              </li>
            ))}
          </ul>
          {checks.length > SHOWN && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-touch-coarse text-xs"
              aria-expanded={all}
              onClick={() => setAll((v) => !v)}
            >
              {all ? "Show fewer" : `Show all ${checks.length}`}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
