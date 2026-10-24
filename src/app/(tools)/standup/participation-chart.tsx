"use client";

import { ChartFigure } from "@/components/shared/chart-card";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { enoughData } from "@/lib/analytics/min-sample";
import type { ChartText } from "@/lib/charts/chart-text";
import type { StandupEntry } from "@/lib/stores/workspace-types";
import { cn } from "@/lib/utils";
import { participation, shortDay, type DayCount } from "./model";

const WINDOW = 14;

/**
 * What the strip says, in words and as rows: on how many of the last two
 * weeks' days anyone posted, and (with enough posting days for it to mean
 * something) how many updates such a day brings, against the team's size.
 */
export function participationText(
  days: readonly DayCount[],
  teamSize: number
): ChartText & { activeDays: number } {
  const active = days.filter((d) => d.count > 0);
  const total = active.reduce((sum, d) => sum + d.count, 0);
  let summary =
    active.length === 0
      ? `No updates in the last ${days.length} days.`
      : `Updates on ${active.length} of the last ${days.length} days.`;
  if (enoughData(active.length, "average")) {
    const avg = Math.round((total / active.length) * 10) / 10;
    summary += ` About ${avg} a day when people post${teamSize > 0 ? `, for a team of ${teamSize}` : ""}.`;
  }
  return {
    summary,
    activeDays: active.length,
    table: {
      columns: ["Day", "Updates"],
      rows: days.map((d) => [d.date, d.count]),
      caption: `Standup updates per day, last ${days.length} days`,
    },
  };
}

/** Shade by how much of the team posted (or of the busiest day, with no team). */
function shade(count: number, full: number): string {
  if (count === 0) return "bg-card";
  const share = count / Math.max(1, full);
  if (share < 0.34) return "bg-accent/15";
  if (share < 0.67) return "bg-accent/30";
  return "bg-accent/50";
}

/**
 * The last 14 days of standup updates as a strip of day tiles: pale days
 * are days people stopped posting. A figure with a summary and a table, so
 * it reads without seeing the colours.
 */
export function ParticipationChart({
  entries,
  today,
  teamSize,
}: {
  entries: readonly StandupEntry[];
  today: string;
  teamSize: number;
}) {
  const days = participation(entries, today, WINDOW);
  const text = participationText(days, teamSize);
  const full = teamSize > 0 ? teamSize : Math.max(...days.map((d) => d.count));
  return (
    <div className="space-y-3">
      <h3 id="standup-participation" className="text-sm font-medium text-text">
        Last {WINDOW} days
      </h3>
      <ChartFigure labelledBy="standup-participation" summary={text.summary} table={text.table}>
        <ol className="grid grid-cols-7 gap-1.5" aria-hidden="true">
          {days.map((d) => (
            <li
              key={d.date}
              title={`${d.date}: ${d.count} ${d.count === 1 ? "update" : "updates"}`}
              className={cn(
                "min-w-0 rounded-md border border-border p-1.5 text-center",
                shade(d.count, full),
                d.date === today && "ring-1 ring-accent"
              )}
            >
              <div className="truncate text-xs text-sub">{shortDay(d.date)}</div>
              <div className="font-data text-sm text-text">{d.count}</div>
            </li>
          ))}
        </ol>
      </ChartFigure>
      {text.activeDays > 0 && (
        <NotEnoughData
          have={text.activeDays}
          need="average"
          unit={["posting day", "posting days"]}
          action="Collect"
          what="the average per day"
        />
      )}
    </div>
  );
}
