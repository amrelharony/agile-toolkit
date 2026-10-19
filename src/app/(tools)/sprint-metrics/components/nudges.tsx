"use client";

import { useId } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Sprint, SprintSeries } from "@/lib/stores/workspace-types";
import { migratedSourceNames, type NudgeKind } from "../view";

export interface NudgesProps {
  sprint: Sprint;
  series: SprintSeries | undefined;
  nudges: NudgeKind[];
  /** Other sprints with something to check. */
  others: Sprint[];
  onAddPoints: () => void;
  onSetDates: () => void;
  onCheckDetails: () => void;
  onLooksRight: () => void;
  onSelect: (id: string) => void;
}

/** Other sprints listed by name; the rest are counted. */
const MAX_OTHERS = 5;

function Nudge({ children, actions }: { children: React.ReactNode; actions: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 sm:flex-row sm:items-center">
      <AlertTriangle className="hidden h-4 w-4 shrink-0 text-warning sm:block" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-sm text-text">{children}</p>
      <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
    </li>
  );
}

/**
 * Data-quality checks, each with its fix: a finished sprint without
 * completed points, placeholder dates, and sprints made from old tool data.
 */
export function Nudges({
  sprint,
  series,
  nudges,
  others,
  onAddPoints,
  onSetDates,
  onCheckDetails,
  onLooksRight,
  onSelect,
}: NudgesProps) {
  const headingId = useId();
  if (nudges.length === 0 && others.length === 0) return null;

  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h2 id={headingId} className="text-sm font-semibold text-text">
        Worth checking
      </h2>
      {nudges.length > 0 && (
        <ul className="space-y-2">
          {nudges.includes("no-points") && (
            <Nudge
              actions={
                <Button type="button" size="sm" variant="outline" onClick={onAddPoints}>
                  Add completed points
                </Button>
              }
            >
              {sprint.name} is done but has no completed points, so Velocity and forecasts skip it.
            </Nudge>
          )}
          {nudges.includes("synthetic-dates") && (
            <Nudge
              actions={
                <Button type="button" size="sm" variant="outline" onClick={onSetDates}>
                  Set real dates
                </Button>
              }
            >
              {sprint.name} has no real dates, so its days can&apos;t line up with the calendar.
            </Nudge>
          )}
          {nudges.includes("migrated") && (
            <Nudge
              actions={
                <>
                  <Button type="button" size="sm" variant="outline" onClick={onCheckDetails}>
                    Check this sprint&apos;s details
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={onLooksRight}>
                    Looks right
                  </Button>
                </>
              }
            >
              {sprint.name} was made from your earlier {migratedSourceNames(series?.migratedFrom)}{" "}
              data. Check its name, dates and points.
            </Nudge>
          )}
        </ul>
      )}
      {others.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-sub">
          <span>{nudges.length > 0 ? "Other sprints to check:" : "Sprints to check:"}</span>
          {others.slice(0, MAX_OTHERS).map((s) => (
            <Button
              key={s.id}
              type="button"
              size="sm"
              variant="ghost"
              className="h-auto px-2 py-1 text-accent underline-offset-2 hover:underline"
              onClick={() => onSelect(s.id)}
            >
              {s.name}
            </Button>
          ))}
          {others.length > MAX_OTHERS && <span>and {others.length - MAX_OTHERS} more</span>}
        </div>
      )}
    </section>
  );
}
