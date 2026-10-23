"use client";

import type { DependencyStatus } from "@/lib/stores/workspace-types";
import { DEPENDENCY_STATUS_LABEL } from "@/lib/dependencies/edges";
import { cn } from "@/lib/utils";

const TONE: Record<DependencyStatus, string> = {
  open: "border-accent/40 text-accent",
  "at-risk": "border-warning/40 text-warning",
  resolved: "border-success/40 text-success",
};

/**
 * A dependency's live status, the same chip on the map, the PI board and
 * the Scrum of Scrums agenda. Text, not colour alone, carries the state.
 */
export function DependencyStatusChip({
  status,
  overdue = false,
  className,
}: {
  status: DependencyStatus;
  overdue?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        overdue ? "border-danger/40 text-danger" : TONE[status],
        className
      )}
    >
      {DEPENDENCY_STATUS_LABEL[status]}
      {overdue && <span>· overdue</span>}
    </span>
  );
}
