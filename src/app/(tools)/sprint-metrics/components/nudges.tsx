"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "@/components/motion/transition-link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Sprint, SprintSeries } from "@/lib/stores/workspace-types";
import { migratedSourceNames, type NudgeKind } from "@/lib/sprints/hub-view";
import { sprintHref } from "@/lib/sprints/use-selected-sprint";

export interface SprintNudge {
  sprint: Sprint;
  series: SprintSeries | undefined;
  kinds: NudgeKind[];
}

export interface NudgesProps {
  items: SprintNudge[];
  /** Add the completed points a finished sprint is missing (the close dialog's points mode). */
  onAddPoints: (sprint: Sprint) => void;
  /** A migrated sprint the user has checked. */
  onLooksRight: (sprint: Sprint) => void;
}

/** Sprints listed in full; the rest wait behind "Show all". */
const SHOWN = 5;

function Nudge({ children, actions }: { children: React.ReactNode; actions: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 sm:flex-row sm:items-center">
      <AlertTriangle className="hidden h-4 w-4 shrink-0 text-warning sm:block" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-sm text-text">{children}</p>
      <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
    </li>
  );
}

const linkCls =
  "inline-flex h-8 items-center rounded-md border border-border px-3 text-sm text-text hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** The checks on screen, in order, one key per nudge. */
const nudgeKeys = (items: readonly SprintNudge[]) =>
  items.flatMap(({ sprint, kinds }) => kinds.map((k) => `${sprint.id}-${k}`));

/**
 * Data-quality checks across the sprints, each with its fix: a finished
 * sprint without completed points (it drops out of velocity and the trend),
 * placeholder dates, and sprints made from old tool data. Dates and details
 * are edited in the cockpit's header now; points are added here.
 *
 * Fixing a check removes it, and the button that fixed it with it, so
 * focus moves to the next check (or the heading once none is left) rather
 * than falling back to the page.
 */
export function Nudges({ items, onAddPoints, onLooksRight }: NudgesProps) {
  const headingId = useId();
  const listId = useId();
  const [all, setAll] = useState(false);
  // Once a check was shown, the section stays (saying none is left) so
  // focus has somewhere to go when the last one is fixed.
  const [shownOnce, setShownOnce] = useState(items.length > 0);
  if (items.length > 0 && !shownOnce) setShownOnce(true);

  const listRef = useRef<HTMLUListElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const keys = nudgeKeys(items);
  const keyList = keys.join("\u0000");
  const before = useRef(keys);
  useEffect(() => {
    const prev = before.current;
    before.current = keyList ? keyList.split("\u0000") : [];
    const now = new Set(before.current);
    const gone = prev.findIndex((k) => !now.has(k));
    if (gone === -1) return;
    // Only when focus went with the removed check: never take it from
    // somewhere the user moved it. The close dialog hands focus back after
    // it unmounts (on a timer), so look once that has happened.
    const timer = window.setTimeout(() => {
      const active = document.activeElement;
      if (active && active !== document.body) return;
      const rows = listRef.current?.querySelectorAll<HTMLElement>(":scope > li") ?? [];
      const row = rows[Math.min(gone, rows.length - 1)];
      const target = row?.querySelector<HTMLElement>("button, a[href]") ?? headingRef.current;
      target?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [keyList]);

  if (items.length === 0 && !shownOnce) return null;
  const shown = all ? items : items.slice(0, SHOWN);

  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h2
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        className="text-sm font-semibold text-text focus:outline-none"
      >
        Worth checking
      </h2>
      {items.length === 0 && <p className="text-sm text-sub">Nothing left to check.</p>}
      <ul id={listId} ref={listRef} className="space-y-2">
        {shown.flatMap(({ sprint, series, kinds }) => [
          ...(kinds.includes("no-points")
            ? [
                <Nudge
                  key={`${sprint.id}-points`}
                  actions={
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => onAddPoints(sprint)}
                      aria-label={`Add completed points to ${sprint.name}`}
                    >
                      Add completed points
                    </Button>
                  }
                >
                  {sprint.name} is done but has no completed points, so Velocity, the trend and
                  forecasts skip it.
                </Nudge>,
              ]
            : []),
          ...(kinds.includes("synthetic-dates")
            ? [
                <Nudge
                  key={`${sprint.id}-dates`}
                  actions={
                    <Link
                      href={sprintHref("/sprint", sprint.id)}
                      aria-label={`Set real dates for ${sprint.name}`}
                      className={linkCls}
                    >
                      Set real dates
                    </Link>
                  }
                >
                  {sprint.name} has no real dates, so its days can&apos;t line up with the calendar.
                  Edit its details in the cockpit.
                </Nudge>,
              ]
            : []),
          ...(kinds.includes("migrated")
            ? [
                <Nudge
                  key={`${sprint.id}-migrated`}
                  actions={
                    <>
                      <Link
                        href={sprintHref("/sprint", sprint.id)}
                        aria-label={`Check the details of ${sprint.name}`}
                        className={linkCls}
                      >
                        Check its details
                      </Link>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => onLooksRight(sprint)}
                        aria-label={`${sprint.name} looks right`}
                      >
                        Looks right
                      </Button>
                    </>
                  }
                >
                  {sprint.name} was made from your earlier{" "}
                  {migratedSourceNames(series?.migratedFrom)} data. Check its name, dates and
                  points.
                </Nudge>,
              ]
            : []),
        ])}
      </ul>
      {items.length > SHOWN && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setAll((v) => !v)}
          aria-expanded={all}
          aria-controls={listId}
        >
          {all ? "Show fewer" : `Show all ${items.length} sprints to check`}
        </Button>
      )}
    </section>
  );
}
