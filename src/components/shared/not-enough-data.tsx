"use client";

import { needMore, type SampleKind } from "@/lib/analytics/min-sample";
import { cn } from "@/lib/utils";
import { InkArt } from "@/components/ink/ink-art";
import { NO_DATA } from "@/lib/ink/drawings/marks";

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
        "flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-sub",
        className
      )}
    >
      {/* An empty chart with a pencil about to plot its next point. */}
      <InkArt drawing={NO_DATA} className="-my-1.5 h-8 w-8 shrink-0" pace={700} />
      <span>
        {action} {more} more {more === 1 ? unit[0] : unit[1]} to see {what}.
      </span>
    </p>
  );
}
