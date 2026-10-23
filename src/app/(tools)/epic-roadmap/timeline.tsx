"use client";

import { ChartFigure } from "@/components/shared/chart-card";
import type { ChartTable } from "@/lib/charts/chart-text";
import { cn } from "@/lib/utils";
import { colorTint, colorVar } from "./palette";
import { currentQuarterIndex, normalizeQuarter, quarterIndex } from "./quarters";
import { rollupLabel } from "./rollup";
import { inView, type EpicView } from "./view";

/** Column widths in rem: the sticky name column, then each quarter. */
const NAME_REM = 9;
const QUARTER_REM = 4.5;

/**
 * Where an epic's bar sits in the view, in quarter columns (0-based), and
 * how much of the visible bar its progress fills. The fill is measured on
 * the whole epic, so a bar cut off by the view still fills to the right
 * point instead of restarting at the view's edge.
 */
export function barGeometry(
  view: Pick<EpicView, "epic" | "rollup">,
  viewStart: number,
  columns: number
): {
  start: number;
  span: number;
  fill: number;
  clippedStart: boolean;
  clippedEnd: boolean;
} | null {
  const s = quarterIndex(view.epic.startQuarter);
  const e = quarterIndex(view.epic.endQuarter);
  if (s === 0 || e === 0 || e < s || columns === 0) return null;
  const viewEnd = viewStart + columns - 1;
  if (e < viewStart || s > viewEnd) return null;
  const visStart = Math.max(s, viewStart);
  const visEnd = Math.min(e, viewEnd);
  const reach = s + (view.rollup.pct / 100) * (e - s + 1);
  const fill = Math.min(1, Math.max(0, (reach - visStart) / (visEnd - visStart + 1)));
  return {
    start: visStart - viewStart,
    span: visEnd - visStart + 1,
    fill: Math.round(fill * 1000) / 10,
    clippedStart: s < viewStart,
    clippedEnd: e > viewEnd,
  };
}

/** The timeline's rows as a table, for "View as table". */
export function timelineTable(views: readonly EpicView[]): ChartTable {
  return {
    caption: "Epics on the roadmap",
    columns: ["Epic", "Start", "End", "Owner", "Progress", "From"],
    rows: views.map((v) => [
      v.epic.title,
      normalizeQuarter(v.epic.startQuarter) || "—",
      normalizeQuarter(v.epic.endQuarter) || "—",
      v.epic.owner || "—",
      `${v.rollup.pct}%`,
      rollupLabel(v.rollup),
    ]),
  };
}

/**
 * Epics as bars across quarter columns. Read-only: epics are edited in the
 * list below. The grid keeps a usable width and scrolls sideways inside its
 * own box on a phone, with the epic names pinned on the left.
 */
export function RoadmapTimeline({
  views,
  columns,
  summary,
  now = new Date(),
}: {
  views: readonly EpicView[];
  /** The view's quarters, in order ("2026 Q1", …). */
  columns: readonly string[];
  summary: string;
  now?: Date;
}) {
  const viewStart = quarterIndex(columns[0]);
  const nowCol = currentQuarterIndex(now) - viewStart;
  const shown = views.filter((v) => inView(v.epic, columns[0], columns[columns.length - 1]));
  const template = `${NAME_REM}rem repeat(${columns.length}, minmax(${QUARTER_REM}rem, 1fr))`;

  return (
    <ChartFigure
      label="Epic timeline"
      summary={summary}
      table={timelineTable(shown)}
      caption="Epics on the roadmap"
    >
      <div className="overflow-x-auto rounded-md border border-border">
        <div
          className="relative grid gap-y-1.5 py-2"
          style={{
            gridTemplateColumns: template,
            minWidth: `${NAME_REM + columns.length * QUARTER_REM}rem`,
          }}
        >
          {nowCol >= 0 && nowCol < columns.length && (
            // This quarter's column, shaded behind the bars.
            <div
              className="rounded bg-accent/5"
              style={{ gridColumn: nowCol + 2, gridRow: `1 / span ${shown.length + 1}` }}
            />
          )}
          <div className="sticky left-0 z-10 bg-card" style={{ gridColumn: 1, gridRow: 1 }} />
          {columns.map((c, i) => (
            <div
              key={c}
              className={cn(
                "px-1 text-center font-data text-xs uppercase tracking-wider",
                i === nowCol ? "font-semibold text-accent" : "text-sub"
              )}
              style={{ gridColumn: i + 2, gridRow: 1 }}
            >
              {c}
            </div>
          ))}
          {shown.map((v, row) => {
            const bar = barGeometry(v, viewStart, columns.length);
            if (!bar) return null;
            const color = v.color;
            return (
              <div key={v.epic.id} className="contents">
                <div
                  className="sticky left-0 z-10 flex min-w-0 items-center gap-2 bg-card px-2 text-sm text-text"
                  style={{ gridColumn: 1, gridRow: row + 2 }}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: colorVar(color) }}
                  />
                  <span className="truncate">{v.epic.title}</span>
                </div>
                <div
                  className={cn(
                    "relative mx-0.5 flex h-7 items-center overflow-hidden",
                    !bar.clippedStart && "rounded-l-md",
                    !bar.clippedEnd && "rounded-r-md"
                  )}
                  style={{
                    gridColumn: `${bar.start + 2} / span ${bar.span}`,
                    gridRow: row + 2,
                    background: colorTint(color, 16),
                    borderLeft: bar.clippedStart ? undefined : `3px solid ${colorVar(color)}`,
                    borderRight: bar.clippedEnd ? undefined : `3px solid ${colorVar(color)}`,
                  }}
                >
                  <div
                    className="absolute inset-y-0 left-0"
                    style={{ width: `${bar.fill}%`, background: colorTint(color, 45) }}
                  />
                  <span className="relative z-10 flex w-full items-center justify-between px-1.5 font-data text-xs text-text">
                    <span>{bar.clippedStart ? "‹" : ""}</span>
                    <span>{v.rollup.pct}%</span>
                    <span>{bar.clippedEnd ? "›" : ""}</span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </ChartFigure>
  );
}
