"use client";

/**
 * A revealed choice round: one bar per option (people who picked it, or
 * dots on it), the leader said in one sentence, and "View as table". A dot
 * round also shows how many people put a dot on each option, once 5 have
 * answered; before that it says why that column is missing.
 *
 * Plain bars, no chart library: at most 12 options, widths from theme
 * tokens only.
 */

import { useEffect, useId, useRef } from "react";
import { ChartFigure } from "@/components/shared/chart-card";
import { NO_VALUE, listAnd } from "@/lib/charts/chart-text";
import { VOTE_LIMITS } from "@/lib/realtime/vote-room/protocol";
import {
  choiceShare,
  choiceShareBase,
  type ChoiceSheet,
  type RevealedChoice,
} from "@/lib/realtime/vote-room/choice";

export interface ChoiceResultsProps {
  sheet: ChoiceSheet;
  revealed: readonly RevealedChoice[];
  minN: number;
  ballots: number;
  /** Move focus to the "Results" heading on mount: Reveal just replaced the control that had it. */
  focusHeading?: boolean;
}

function people(n: number): string {
  return `${n} ${n === 1 ? "person" : "people"}`;
}

function pct(share: number | null): string {
  return share === null ? NO_VALUE : `${Math.round(share * 100)}%`;
}

/** "Most picked Option A (5 of 8, 63%)." / "Tied: A and B (3 each)." / "A has the most dots (9 of 20)." */
export function choiceSummary(
  sheet: ChoiceSheet,
  revealed: readonly RevealedChoice[],
  ballots: number
): string {
  const totals = revealed.map((r) => r.total);
  const top = Math.max(0, ...totals);
  if (top === 0) return "Nothing was picked.";
  const base = choiceShareBase(sheet.mode, ballots, totals);
  const leaders = sheet.options.filter((_, i) => totals[i] === top).map((x) => x.text);
  if (sheet.mode === "dots") {
    return leaders.length === 1
      ? `${leaders[0]} has the most dots (${top} of ${base}, ${pct(choiceShare(top, base))}).`
      : `Tied for the most dots: ${listAnd(leaders)} (${top} each, of ${base}).`;
  }
  return leaders.length === 1
    ? `Most picked ${leaders[0]} (${top} of ${base}, ${pct(choiceShare(top, base))}).`
    : `Tied: ${listAnd(leaders)} (${top} each, of ${base}).`;
}

export function ChoiceResults({
  sheet,
  revealed,
  minN,
  ballots,
  focusHeading = false,
}: ChoiceResultsProps) {
  const headingId = useId();
  const chartId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusHeading) headingRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dots = sheet.mode === "dots";
  const totals = revealed.map((r) => r.total);
  const base = choiceShareBase(sheet.mode, ballots, totals);
  const top = Math.max(1, ...totals);
  const backersShown = dots && revealed.some((r) => r.backers !== null);
  const spreadNeed = Math.max(minN, VOTE_LIMITS.minNSpread);

  const columns = dots
    ? backersShown
      ? ["Option", "Dots", "Share", "People with a dot"]
      : ["Option", "Dots", "Share"]
    : ["Option", "People", "Share"];
  const table = {
    columns,
    rows: sheet.options.map((option, i) => {
      const r = revealed[i];
      const row: (string | number)[] = [
        option.text,
        r?.total ?? 0,
        pct(choiceShare(r?.total ?? 0, base)),
      ];
      if (backersShown) row.push(r?.backers ?? NO_VALUE);
      return row;
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
          {people(ballots)} answered
          {dots ? `, placing ${base} ${base === 1 ? "dot" : "dots"}` : ""}.
        </p>
      </div>
      <div className="rounded-lg border border-border bg-card p-3">
        <h3 id={chartId} className="mb-2 text-sm font-medium text-text">
          {sheet.title}
        </h3>
        <ChartFigure
          labelledBy={chartId}
          summary={choiceSummary(sheet, revealed, ballots)}
          table={table}
        >
          <ul className="space-y-2">
            {sheet.options.map((option, i) => {
              const total = revealed[i]?.total ?? 0;
              const backers = revealed[i]?.backers ?? null;
              return (
                <li key={option.id} className="space-y-1 text-xs">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 break-words text-text">{option.text}</span>
                    <span className="shrink-0 font-data text-text">
                      {total}
                      {backers !== null && <span className="text-sub"> ({people(backers)})</span>}
                    </span>
                  </div>
                  <span className="block h-3 rounded bg-card-hover">
                    <span
                      className="block h-3 rounded bg-accent/70"
                      style={{ width: `${Math.round((total / top) * 100)}%` }}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        </ChartFigure>
      </div>
      {dots && !backersShown && (
        <p className="text-xs text-sub">
          How many people put a dot on each option shows from {spreadNeed} answers.
        </p>
      )}
    </section>
  );
}
