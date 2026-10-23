"use client";

import { ArrowDownUp } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * "Scores changed — Re-sort", shown while a `useStableOrder` list is out of
 * date. A polite status, so screen readers hear that the order on screen no
 * longer matches the scores without focus being moved.
 */
export function ResortChip({
  isStale,
  onResort,
  what = "Scores",
}: {
  isStale: boolean;
  onResort: () => void;
  /** What changed, plural: "Scores", "Ratings". */
  what?: string;
}) {
  return (
    // Always mounted (an empty live region takes no space), so the message
    // is announced when it appears.
    <div
      role="status"
      aria-live="polite"
      className={isStale ? "mb-2 flex items-center" : undefined}
    >
      {isStale && (
        <span className="inline-flex flex-wrap items-center gap-2 text-xs text-sub">
          {what} changed since the last sort.
          <Button type="button" size="sm" variant="outline" className="gap-1" onClick={onResort}>
            <ArrowDownUp aria-hidden="true" />
            Re-sort
          </Button>
        </span>
      )}
    </div>
  );
}
