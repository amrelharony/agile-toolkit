"use client";

/**
 * A revealed number round: how many answered and the median, always; the
 * lowest, the middle half (quartiles), the highest and a 10-bucket
 * histogram only from 5 answers (before that it says why they are
 * missing). Plain bars, no chart library.
 */

import { useEffect, useId, useRef } from "react";
import { ChartFigure } from "@/components/shared/chart-card";
import { VOTE_LIMITS } from "@/lib/realtime/vote-room/protocol";
import {
  numberAmount,
  numberBucketRange,
  type NumberSheet,
  type RevealedNumber,
} from "@/lib/realtime/vote-room/number";

export interface NumberResultsProps {
  sheet: NumberSheet;
  revealed: RevealedNumber;
  minN: number;
  /** Move focus to the "Results" heading on mount: Reveal just replaced the control that had it. */
  focusHeading?: boolean;
}

/** "Median 40%. Middle half 30% to 55%." (the spread part only when it shows) */
export function numberSummary(sheet: NumberSheet, r: RevealedNumber): string {
  const amount = (n: number) => numberAmount(n, sheet.unit, sheet.decimals + 2);
  const median = `Median ${amount(r.median)}.`;
  if (!r.spread) return median;
  return `${median} Middle half ${amount(r.spread.q1)} to ${amount(r.spread.q3)}; lowest ${amount(r.spread.min)}, highest ${amount(r.spread.max)}.`;
}

export function NumberResults({ sheet, revealed, minN, focusHeading = false }: NumberResultsProps) {
  const headingId = useId();
  const chartId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusHeading) headingRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const amount = (n: number) => numberAmount(n, sheet.unit, sheet.decimals + 2);
  const spread = revealed.spread;
  const buckets = spread
    ? spread.histogram
        .map((count, k) => ({ count, range: numberBucketRange(k, sheet) }))
        .filter((b): b is { count: number; range: [number, number] } => b.range !== null)
    : [];
  const top = Math.max(1, ...buckets.map((b) => b.count));
  const label = (range: [number, number]) =>
    range[0] === range[1] ? amount(range[0]) : `${amount(range[0])}–${amount(range[1])}`;

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
          {revealed.count} {revealed.count === 1 ? "person" : "people"} answered, from{" "}
          {amount(sheet.min)} to {amount(sheet.max)}.
        </p>
      </div>
      <div className="space-y-3 rounded-lg border border-border bg-card p-3">
        <h3 id={chartId} className="text-sm font-medium text-text">
          {sheet.title}
        </h3>
        <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-sub">Median</dt>
            <dd className="font-data text-lg text-text">{amount(revealed.median)}</dd>
          </div>
          {spread && (
            <>
              <div>
                <dt className="text-xs text-sub">Middle half</dt>
                <dd className="font-data text-text">
                  {amount(spread.q1)} to {amount(spread.q3)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-sub">Lowest</dt>
                <dd className="font-data text-text">{amount(spread.min)}</dd>
              </div>
              <div>
                <dt className="text-xs text-sub">Highest</dt>
                <dd className="font-data text-text">{amount(spread.max)}</dd>
              </div>
            </>
          )}
        </dl>
        {spread ? (
          <ChartFigure
            labelledBy={chartId}
            summary={numberSummary(sheet, revealed)}
            table={{
              columns: ["Range", "People"],
              rows: buckets.map((b) => [label(b.range), b.count]),
              caption: sheet.title,
            }}
          >
            <ul className="space-y-1.5">
              {buckets.map((b) => (
                <li
                  key={`${b.range[0]}`}
                  className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-2 text-xs"
                >
                  <span className="truncate text-sub">{label(b.range)}</span>
                  <span className="h-3 rounded bg-card-hover">
                    <span
                      className="block h-3 rounded bg-accent/70"
                      style={{ width: `${Math.round((b.count / top) * 100)}%` }}
                    />
                  </span>
                  <span className="font-data text-text">{b.count}</span>
                </li>
              ))}
            </ul>
          </ChartFigure>
        ) : (
          <p className="text-xs text-sub">
            The lowest, the highest, the middle half and the spread show from{" "}
            {Math.max(minN, VOTE_LIMITS.minNSpread)} answers: with fewer, they would be close to
            someone&apos;s exact answer.
          </p>
        )}
      </div>
    </section>
  );
}
