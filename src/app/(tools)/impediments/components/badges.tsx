"use client";

/**
 * Small badges for the Impediment Tracker: severity, status, age, due and
 * overdue. Each says its state in words and takes its colour from a theme
 * token (constants.ts), so it reads on both themes and without colour.
 */

import type { ReactNode } from "react";
import { AlarmClock, CalendarClock, Clock } from "lucide-react";
import type { ImpedimentSeverity } from "@/lib/stores/workspace-types";
import { IMPEDIMENT_STATUS_LABEL, type ImpedimentStatus } from "@/lib/impediments/model";
import { cn } from "@/lib/utils";
import { SEVERITY_TONE, STATUS_TONE, ageTone } from "../constants";
import { dayLabel, daysText, isSeverity, severityLabel } from "../helpers";

function Chip({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
        className
      )}
    >
      {children}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: ImpedimentSeverity | string }) {
  return (
    <Chip className={isSeverity(severity) ? SEVERITY_TONE[severity] : "border-border text-sub"}>
      <span className="sr-only">Severity: </span>
      {severityLabel(severity)}
    </Chip>
  );
}

export function StatusBadge({ status }: { status: ImpedimentStatus }) {
  return (
    <Chip className={cn("font-medium", STATUS_TONE[status])}>
      {IMPEDIMENT_STATUS_LABEL[status]}
    </Chip>
  );
}

/**
 * "5 days old", graded by how long it has been in the way; "Took 3 days"
 * once resolved. Not "Open 5 days": next to an "Escalated" chip that read
 * as a second, contradicting status.
 */
export function AgeBadge({ days, resolved }: { days: number; resolved: boolean }) {
  if (resolved) {
    return (
      <Chip className="border-border text-sub">
        <Clock className="h-3 w-3" aria-hidden="true" />
        Took {daysText(days)}
      </Chip>
    );
  }
  return (
    <Chip className={cn("font-data", ageTone(days))}>
      <Clock className="h-3 w-3" aria-hidden="true" />
      {days === 0 ? "Raised today" : `${daysText(days)} old`}
    </Chip>
  );
}

/** "Overdue by 4 days" past the due date; "Due 31 Oct" / "Due today" before it. */
export function DueBadge({
  due,
  overdueBy,
  today,
}: {
  due: string;
  overdueBy: number;
  today: string;
}) {
  if (overdueBy > 0) {
    return (
      <Chip className="border-danger/60 bg-danger/10 font-semibold text-danger">
        <AlarmClock className="h-3 w-3" aria-hidden="true" />
        Overdue by {daysText(overdueBy)}
      </Chip>
    );
  }
  return (
    <Chip className="border-border text-sub">
      <CalendarClock className="h-3 w-3" aria-hidden="true" />
      {due === today ? "Due today" : `Due ${dayLabel(due)}`}
    </Chip>
  );
}
