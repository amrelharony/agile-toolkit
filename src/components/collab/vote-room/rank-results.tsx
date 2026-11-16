"use client";

/**
 * A revealed rank round: the options from most Borda points to fewest,
 * each with its points, its average place and a bar, the leader said in
 * one sentence, and "View as table". No order of anyone's survives the
 * host's tab, so there is nothing per person to show.
 */

import { useEffect, useId, useRef } from "react";
import { ChartFigure } from "@/components/shared/chart-card";
import { NO_VALUE, fmt, listAnd } from "@/lib/charts/chart-text";
import {
  averagePlace,
  rankStanding,
  type RankSheet,
  type RevealedRank,
} from "@/lib/realtime/vote-room/rank";

export interface RankResultsProps {
  sheet: RankSheet;
  revealed: readonly RevealedRank[];
  ballots: number;
  /** Move focus to the "Results" heading on mount: Reveal just replaced the control that had it. */
  focusHeading?: boolean;
}

interface Row {
  id: string;
  text: string;
  points: number;
}

/** "Top: Option A (14 points, average place 1.4)." / "Tied at the top: A and B (12 points each)." */
export function rankSummary(rows: readonly Row[], ballots: number, n: number): string {
  if (rows.length === 0 || ballots === 0) return "Nobody ranked the options.";
  const top = rows[0].points;
  const leaders = rows.filter((r) => r.points === top).map((r) => r.text);
  if (leaders.length > 1) {
    return `Tied at the top: ${listAnd(leaders)} (${top} points each).`;
  }
  const avg = averagePlace(top, ballots, n);
  return `Top: ${leaders[0]} (${top} points, average place ${avg === null ? NO_VALUE : fmt(avg, 1)}).`;
}

export function RankResults({ sheet, revealed, ballots, focusHeading = false }: RankResultsProps) {
  const headingId = useId();
  const chartId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusHeading) headingRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const n = sheet.options.length;
  const rows = rankStanding(
    sheet.options.map((x, i) => ({ id: x.id, text: x.text, points: revealed[i]?.points ?? 0 }))
  );
  const most = Math.max(1, ballots * (n - 1));
  const table = {
    columns: ["Place", "Option", "Points", "Average place"],
    rows: rows.map((r, i) => {
      const avg = averagePlace(r.points, ballots, n);
      return [i + 1, r.text, r.points, avg === null ? NO_VALUE : fmt(avg, 1)];
    }),
    caption: sheet.title,
  };

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div className="space-y-1">
        <h2
          ref={headingRef}
          id={headingId}
          tabIndex={-1}
          className="text-base font-semibold text-text outline-none"
        >
          Results
        </h2>
        <p className="text-sm text-sub">
          {ballots} {ballots === 1 ? "person" : "people"} ranked {n} options. Points: {n - 1} for
          each first place, down to 0 for each last.
        </p>
      </div>
      <div className="rounded-lg border border-border bg-card p-3">
        <h3 id={chartId} className="mb-2 text-sm font-medium text-text">
          {sheet.title}
        </h3>
        <ChartFigure labelledBy={chartId} summary={rankSummary(rows, ballots, n)} table={table}>
          <ol className="space-y-2">
            {rows.map((r, i) => {
              const avg = averagePlace(r.points, ballots, n);
              return (
                <li key={r.id} className="space-y-1 text-xs">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 break-words text-text">
                      <span className="font-data text-sub">{i + 1}.</span> {r.text}
                    </span>
                    <span className="shrink-0 font-data text-text">
                      {r.points}
                      <span className="text-sub">
                        {" "}
                        (avg. {avg === null ? NO_VALUE : fmt(avg, 1)})
                      </span>
                    </span>
                  </div>
                  <span className="block h-3 rounded bg-card-hover">
                    <span
                      className="block h-3 rounded bg-accent/70"
                      style={{ width: `${Math.round((r.points / most) * 100)}%` }}
                    />
                  </span>
                </li>
              );
            })}
          </ol>
        </ChartFigure>
      </div>
    </section>
  );
}
