"use client";

import { useId } from "react";
import { CalendarClock } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { ChartFigure } from "@/components/shared/chart-card";
import { ResortChip } from "@/components/shared/resort-chip";
import { useStableOrder } from "@/hooks/use-stable-order";
import { NO_VALUE, type ChartText } from "@/lib/charts/chart-text";
import { cn } from "@/lib/utils";
import {
  CADENCE_OPTIONS,
  compareCadence,
  daysBetween,
  lastText,
  targetText,
  type CadenceDays,
  type ReportCadence,
} from "./model";

/** The timeline's span: the last 26 weeks, today included. */
export const TIMELINE_DAYS = 182;

/** The timeline's text: who met how often in the span, and a row per report. */
export function timelineText(rows: readonly ReportCadence[], today: string): ChartText {
  const held = rows.filter((r) => r.meetings > 0);
  const inSpan = (r: ReportCadence) =>
    r.dates.filter((d) => {
      const ago = daysBetween(d, today);
      return ago !== null && ago >= 0 && ago < TIMELINE_DAYS;
    }).length;
  const list = held.map((r) => `${r.name} ${inSpan(r)}`).join(", ");
  return {
    summary: held.length > 0 ? `1:1s in the last 26 weeks: ${list}.` : "No 1:1s yet.",
    table: {
      // The plotted span first, so the table and the summary agree; the
      // all-time count beside it.
      columns: [
        "Report",
        "1:1s (last 26 weeks)",
        "1:1s (all time)",
        "Last 1:1",
        "Median gap (days)",
        "Open actions",
      ],
      rows: held.map((r) => [
        r.name,
        inSpan(r),
        r.meetings,
        r.lastDate ?? NO_VALUE,
        r.medianGapDays ?? NO_VALUE,
        r.openActions,
      ]),
    },
  };
}

/**
 * One row per report, a dot per 1:1 over the last 26 weeks: an even rhythm
 * reads as evenly spaced dots, a gap as a gap. Plain HTML; ChartFigure
 * hides it from screen readers behind its summary and table.
 */
function Timeline({ rows, today }: { rows: readonly ReportCadence[]; today: string }) {
  const held = rows.filter((r) => r.meetings > 0);
  return (
    <div className="space-y-2">
      {held.map((r) => (
        <div
          key={r.key}
          className="grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)] items-center gap-2 text-xs"
        >
          <span className="truncate text-text" title={r.name}>
            {r.name}
          </span>
          <div className="relative h-4 rounded bg-surface-deep">
            {r.dates.map((d) => {
              const ago = daysBetween(d, today);
              if (ago === null || ago < 0 || ago >= TIMELINE_DAYS) return null;
              const left = ((TIMELINE_DAYS - 1 - ago) / (TIMELINE_DAYS - 1)) * 100;
              return (
                <span
                  key={d}
                  className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent"
                  style={{ left: `${left}%` }}
                />
              );
            })}
          </div>
        </div>
      ))}
      <div className="grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)] gap-2 text-xs text-sub">
        <span />
        <span className="flex justify-between">
          <span>26 weeks ago</span>
          <span>Today</span>
        </span>
      </div>
    </div>
  );
}

/**
 * Cadence per report: "Raj · last 1:1 18 days ago · every 14 days → 4 days
 * overdue", with the cadence picked per report (or read from their usual
 * gap once there are four 1:1s), and the timeline. The list keeps its
 * order while a cadence is changed; Re-sort puts the latest first again.
 */
export function CadenceSection({
  rows,
  today,
  onCadence,
}: {
  rows: readonly ReportCadence[];
  today: string;
  /** Set a report's cadence, or null to go back to their usual gap. */
  onCadence: (key: string, days: CadenceDays | null) => void;
}) {
  const { ordered, isStale, resort } = useStableOrder(rows, (r) => r.key, compareCadence);
  const baseId = useId();
  const text = timelineText(rows, today);
  if (rows.length === 0) return null;
  return (
    <SectionCard title="Cadence per report" icon={CalendarClock} contentClassName="space-y-4">
      <ResortChip isStale={isStale} onResort={resort} what="Cadences" />
      <ul className="divide-y divide-border rounded-lg border border-border">
        {ordered.map((r) => {
          const selectId = `${baseId}-${r.key}`;
          const target = targetText(r);
          return (
            <li
              key={r.key}
              className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
            >
              <p className="min-w-0 text-sm">
                <span className="font-medium text-text">{r.name}</span>
                <span className="text-sub"> · {lastText(r)}</span>
                {target && <span className="text-sub"> · {target}</span>}
                {r.overdueBy !== null && (
                  <span className="font-medium text-danger">
                    {" "}
                    → {r.overdueBy === 1 ? "1 day" : `${r.overdueBy} days`} overdue
                  </span>
                )}
                {r.nextDate && <span className="text-sub"> · next {r.nextDate}</span>}
                {r.openActions > 0 && (
                  <span className="text-sub">
                    {" "}
                    · {r.openActions === 1 ? "1 open action" : `${r.openActions} open actions`}
                  </span>
                )}
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <label htmlFor={selectId} className="text-xs text-sub">
                  Cadence
                </label>
                <select
                  id={selectId}
                  value={r.targetSource === "set" && r.targetDays !== null ? r.targetDays : ""}
                  onChange={(e) =>
                    onCadence(
                      r.key,
                      e.target.value ? (Number(e.target.value) as CadenceDays) : null
                    )
                  }
                  aria-label={`Cadence for ${r.name}`}
                  className={cn(
                    "h-9 rounded-md border border-input bg-background px-2 text-sm text-text",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  )}
                >
                  <option value="">{r.medianGapDays !== null ? "Usual gap" : "Not set"}</option>
                  {CADENCE_OPTIONS.map((d) => (
                    <option key={d} value={d}>
                      Every {d === 7 ? "week" : `${d / 7} weeks`}
                    </option>
                  ))}
                </select>
              </div>
            </li>
          );
        })}
      </ul>
      {rows.some((r) => r.meetings > 0) && (
        <ChartFigure
          label="1:1s per report over the last 26 weeks"
          summary={text.summary}
          table={text.table}
          caption="1:1s per report"
        >
          <Timeline rows={rows} today={today} />
        </ChartFigure>
      )}
    </SectionCard>
  );
}
