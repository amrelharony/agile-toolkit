"use client";

/**
 * Pieces Burndown and Burnup both show around a burn (lib/sprints/burn):
 * the day-off label, a projected day as "Day 16 · 3 Nov", the bar that
 * says where the numbers come from (with the switch between the board and
 * the typed log when both hold something), and the tiles' grid.
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { StatCard } from "@/components/shared/stat-card";
import { Button } from "@/components/ui/button";
import type { BurnDay, BurnSeries } from "@/lib/sprints/burn";
import { isExampleSprintId } from "@/lib/sprints/example";
import { sprintHref } from "@/lib/sprints/use-selected-sprint";
import type { Sprint } from "@/lib/stores/workspace-types";
import { sourceLine } from "./markdown";
import { weekdayShort } from "./sprint-shell";
import type { BurnTile } from "./tiles";

/** "Sat", "Holiday": why a day is off, for the rows and the table. */
export function offLabel(day: Pick<BurnDay, "off" | "date">): string | null {
  if (!day.off) return null;
  return day.off === "holiday" ? "Holiday" : weekdayShort(day.date) || "Weekend";
}

/** The source as a small badge (a chart card's, or the bar's when there's nothing to switch). */
export function SourceBadge({ source }: { source: BurnSeries["source"] }) {
  return (
    <span className="rounded-md border border-border px-1.5 py-0.5 text-xs font-medium text-sub">
      {sourceLine(source)}
    </span>
  );
}

/**
 * Why the numbers come from where they do, in a line beside the source,
 * for what each source actually holds and whether the sprint is closed.
 */
export function sourceNote(
  burn: Pick<BurnSeries, "source" | "available">,
  sprint: Pick<Sprint, "status">
): string {
  const closed = sprint.status === "completed";
  if (burn.source === "stories") {
    if (!closed) return "Read off the pointed stories on the sprint board.";
    return burn.available.log
      ? "Rebuilt from the stories' sprint moves; the sprint is closed, and its typed log is what was recorded."
      : "Rebuilt from the stories' sprint moves: the sprint is closed and no daily log was typed for it.";
  }
  if (burn.source === "log") {
    if (burn.available.stories) {
      return closed
        ? "The sprint is closed, so its typed log is what was recorded."
        : "Showing the typed log; the board has pointed stories too.";
    }
    return closed
      ? "Read from the typed log: the stories' sprint moves can't rebuild this sprint's board."
      : "Pointed stories on the sprint board would fill this in for you.";
  }
  return closed
    ? "No daily log was typed, and the stories' sprint moves can't rebuild this sprint's board."
    : "Pointed stories on the sprint board would fill this in for you.";
}

/**
 * Where the numbers come from, and the switch between the board and the
 * typed log when both hold something. The choice is the page's only: the
 * rule (the board while it has pointed stories; a closed sprint's log, else
 * its board) stays the default.
 */
export function SourceBar({
  burn,
  sprint,
  onChoose,
}: {
  burn: BurnSeries;
  sprint: Sprint;
  onChoose: (source: "stories" | "log") => void;
}) {
  const both = burn.available.stories && burn.available.log;
  const closed = sprint.status === "completed";
  const boardHref = isExampleSprintId(sprint.id) ? "/kanban" : sprintHref("/kanban", sprint.id);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      {both ? (
        <div role="group" aria-label="Where the numbers come from" className="flex flex-wrap gap-1">
          {(["stories", "log"] as const).map((s) => (
            <Button
              key={s}
              type="button"
              size="sm"
              variant={burn.source === s ? "default" : "outline"}
              aria-pressed={burn.source === s}
              onClick={() => onChoose(s)}
            >
              {s === "stories" ? "From the board" : "From the typed log"}
            </Button>
          ))}
        </div>
      ) : (
        <SourceBadge source={burn.source} />
      )}
      {burn.source === "stories" && !closed ? (
        <Link
          href={boardHref}
          className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
        >
          Move stories on the sprint board
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      ) : (
        <span className="text-sub">{sourceNote(burn, sprint)}</span>
      )}
    </div>
  );
}

/** The tiles in a row (two per row on a phone). */
export function BurnTiles({ tiles }: { tiles: readonly BurnTile[] }) {
  return (
    <KpiGrid cols={[2, 2, 4, 4]} marginBottom="none">
      {tiles.map((t) => (
        <div key={t.id} data-tile={t.id} className="min-w-0">
          <StatCard
            variant="compact"
            label={t.label}
            value={t.value}
            unit={t.unit}
            hint={t.hint}
            tone={t.tone}
            className="h-full"
            valueClassName={t.empty ? "font-sans text-base text-sub" : undefined}
          />
        </div>
      ))}
    </KpiGrid>
  );
}
