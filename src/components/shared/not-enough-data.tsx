"use client";

import { BarChart3 } from "lucide-react";
import { needMore, type SampleKind } from "@/lib/analytics/min-sample";
import { cn } from "@/lib/utils";

/**
 * In place of a chart or statistic that needs more data:
 * "Log 3 more sprints to see the trend." Says what to add and how many,
 * so the empty space is an instruction rather than a mystery.
 */
export function NotEnoughData({
  have,
  need,
  unit,
  action = "Add",
  what,
  className,
}: {
  have: number;
  /** A sample kind from MIN_SAMPLE, or a count. */
  need: SampleKind | number;
  /** Singular and plural: ["sprint", "sprints"]. */
  unit: readonly [string, string];
  /** The verb: "Log", "Add", "Collect". */
  action?: string;
  /** What appears once there's enough: "the trend". */
  what: string;
  className?: string;
}) {
  const more = needMore(have, need);
  if (more === 0) return null;
  return (
    <p
      role="status"
      className={cn(
        "flex items-start gap-2 rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-sub",
        className
      )}
    >
      <BarChart3 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        {action} {more} more {more === 1 ? unit[0] : unit[1]} to see {what}.
      </span>
    </p>
  );
}
