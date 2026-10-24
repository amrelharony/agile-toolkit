"use client";

import type { Ref } from "react";
import { Flag } from "lucide-react";
import { ChartFigure } from "@/components/shared/chart-card";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { SectionCard } from "@/components/shared/section-card";
import type { ChartText } from "@/lib/charts/chart-text";
import { NO_VALUE } from "@/lib/charts/chart-text";
import { formatClock } from "@/lib/timer/dock-timer";
import { cn } from "@/lib/utils";
import { shortClock } from "./agenda";
import type { RunReport, TurnReport } from "./run";
import { runVerdict } from "./verdict";

/** "+2:15", "−0:40", "0:00". */
function signed(seconds: number): string {
  if (seconds === 0) return "0:00";
  return `${seconds > 0 ? "+" : "−"}${shortClock(Math.abs(seconds))}`;
}

/** The summary sentence and table behind the planned-against-actual chart. */
export function summaryChartText(report: RunReport): ChartText {
  const ran = report.segments.filter((s) => s.actualSeconds !== null);
  const over = ran.filter((s) => (s.actualSeconds ?? 0) > s.plannedSeconds).length;
  const lead =
    report.segments.length === 1
      ? "The time-box"
      : over === 0
        ? "No segment ran over"
        : `${over} of ${report.segments.length} segments ran over`;
  return {
    summary: `${lead}${report.segments.length === 1 ? " took" : "; the meeting took"} ${formatClock(report.actualSeconds)} of ${formatClock(report.plannedSeconds)} planned.`,
    table: {
      caption: "Planned and actual time per segment",
      columns: ["Segment", "Planned", "Actual", "Difference"],
      rows: report.segments.map((s) => [
        s.label,
        formatClock(s.plannedSeconds),
        s.actualSeconds === null ? NO_VALUE : formatClock(s.actualSeconds),
        s.actualSeconds === null ? NO_VALUE : signed(s.actualSeconds - s.plannedSeconds),
      ]),
    },
  };
}

const TURN_COLUMNS: DataTableColumn<TurnReport>[] = [
  { key: "name", header: "Speaker", primary: true, cell: (t) => t.name, sortValue: (t) => t.name },
  {
    key: "share",
    header: "Share",
    align: "right",
    cell: (t) => formatClock(t.plannedSeconds),
    sortValue: (t) => t.plannedSeconds,
  },
  {
    key: "spoke",
    header: "Spoke",
    align: "right",
    cell: (t) => (t.skipped ? "skipped" : formatClock(t.actualSeconds)),
    sortValue: (t) => (t.skipped ? null : t.actualSeconds),
  },
  {
    key: "diff",
    header: "Difference",
    align: "right",
    cell: (t) => {
      if (t.skipped) return NO_VALUE;
      const d = t.actualSeconds - t.plannedSeconds;
      return <span className={d > 0 ? "text-warning" : undefined}>{signed(d)}</span>;
    },
    sortValue: (t) => (t.skipped ? null : t.actualSeconds - t.plannedSeconds),
  },
];

/**
 * The end of the meeting: the verdict, planned against actual for each
 * segment, and each speaker's turn in any round. The Markdown export
 * carries the same. The verdict takes focus (`verdictRef`, tabIndex -1)
 * when Finish switches itself off under the keyboard.
 */
export function RunSummary({
  report,
  verdictRef,
}: {
  report: RunReport;
  verdictRef?: Ref<HTMLParagraphElement>;
}) {
  const text = summaryChartText(report);
  const longest = Math.max(
    1,
    ...report.segments.map((s) => Math.max(s.plannedSeconds, s.actualSeconds ?? 0))
  );
  const rounds = report.segments.filter((s) => s.turns.length > 0);

  return (
    <SectionCard title="How it went" icon={Flag} titleSize="sm">
      <div className="flex flex-col gap-5">
        <p
          ref={verdictRef}
          tabIndex={-1}
          className="rounded-sm text-sm font-medium text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          role="status"
        >
          {runVerdict(report)}
        </p>
        <ChartFigure label="Planned and actual time" summary={text.summary} table={text.table}>
          <ul className="space-y-3">
            {report.segments.map((s, i) => {
              const actual = s.actualSeconds ?? 0;
              const over = actual > s.plannedSeconds;
              return (
                <li key={i} className="grid gap-1 text-xs">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-text">{s.label}</span>
                    <span className={cn("shrink-0 font-data", over ? "text-warning" : "text-sub")}>
                      {formatClock(actual)} / {formatClock(s.plannedSeconds)}
                    </span>
                  </div>
                  <span className="block h-2 overflow-hidden rounded-full bg-sub/15">
                    <span
                      className="block h-full rounded-full bg-sub/40"
                      style={{ width: `${(s.plannedSeconds / longest) * 100}%` }}
                    />
                  </span>
                  <span className="block h-2 overflow-hidden rounded-full bg-sub/15">
                    <span
                      className={cn("block h-full rounded-full", over ? "bg-warning" : "bg-accent")}
                      style={{ width: `${(actual / longest) * 100}%` }}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 flex flex-wrap gap-4 text-xs text-sub">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-4 rounded-full bg-sub/40" aria-hidden="true" />
              Planned
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-4 rounded-full bg-accent" aria-hidden="true" />
              Actual
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-4 rounded-full bg-warning" aria-hidden="true" />
              Over
            </span>
          </p>
        </ChartFigure>

        {rounds.map((s) => (
          <div key={s.label} className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-text">
              {report.segments.length > 1 ? `Turns in ${s.label}` : "Turns"}
            </h3>
            <DataTable columns={TURN_COLUMNS} rows={s.turns} rowKey={(t, i) => `${i}-${t.name}`} />
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
