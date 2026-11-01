"use client";

/**
 * A revealed round: one chart per question (bars per scale point, with a
 * one-sentence summary and "View as table"), and "not enough answers" in
 * place of any question that has fewer than minN, whose distribution was
 * never revealed. Mean and median sit in Advanced analysis.
 *
 * Plain bars, no chart library: a scale has at most 11 points, and the
 * widths come from theme tokens only.
 */

import { useEffect, useId, useRef } from "react";
import { AdvancedAnalysis } from "@/components/shared/advanced-analysis";
import { ChartFigure } from "@/components/shared/chart-card";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { NO_VALUE, fmt, listAnd } from "@/lib/charts/chart-text";
import {
  distributionMean,
  distributionMedian,
  pointShare,
} from "@/lib/realtime/vote-room/aggregate";
import type { Questionnaire, RevealedQuestion } from "@/lib/realtime/vote-room/protocol";

export interface VoteResultsProps {
  questionnaire: Questionnaire;
  revealed: readonly RevealedQuestion[];
  minN: number;
  ballots: number;
  /**
   * Move focus to the "Results" heading on mount: Reveal just replaced the
   * control that had it.
   */
  focusHeading?: boolean;
}

function pct(share: number | null): string {
  return share === null ? NO_VALUE : `${Math.round(share * 100)}%`;
}

/** "Most chose Green (5 of 8)." or "Split between Green and Yellow (3 each, of 8)." */
export function questionSummary(d: readonly number[], q: Questionnaire, responses: number): string {
  const top = Math.max(...d);
  if (responses === 0 || top === 0) return "No answers.";
  const leaders = q.scale.points.filter((_, i) => d[i] === top).map((p) => p.label);
  if (leaders.length === 1) {
    return `Most chose ${leaders[0]} (${top} of ${responses}, ${pct(top / responses)}).`;
  }
  return `Split between ${listAnd(leaders)} (${top} each, of ${responses}).`;
}

/** The round's one-sentence verdict. */
export function resultsVerdict(
  revealed: readonly RevealedQuestion[],
  ballots: number,
  minN: number
): string {
  const people = `${ballots} ${ballots === 1 ? "person" : "people"} answered`;
  const shown = revealed.filter((r) => r.distribution !== null).length;
  if (shown === revealed.length) {
    return revealed.length === 1
      ? `${people}.`
      : `${people}; every question has enough answers to show.`;
  }
  if (shown === 0) {
    return `${people}, but no question has the ${minN} answers it needs to show.`;
  }
  return `${people}; ${shown} of ${revealed.length} questions have enough answers to show (${minN} or more).`;
}

export function VoteResults({
  questionnaire,
  revealed,
  minN,
  ballots,
  focusHeading = false,
}: VoteResultsProps) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const rows = questionnaire.questions.map((q, i) => ({ q, r: revealed[i] }));
  const shown = rows.filter((x) => x.r?.distribution);

  useEffect(() => {
    if (focusHeading) headingRef.current?.focus();
    // On mount only: later renders keep focus wherever the person moved it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section aria-labelledby={headingId} className="space-y-4">
      <div className="space-y-1">
        <h2
          ref={headingRef}
          id={headingId}
          tabIndex={-1}
          className="text-base font-semibold text-text outline-none"
        >
          Results
        </h2>
        <p className="text-sm text-sub">{resultsVerdict(revealed, ballots, minN)}</p>
      </div>

      <ol className="space-y-3">
        {rows.map(({ q, r }, i) => (
          <li key={q.id} className="rounded-lg border border-border bg-card p-3">
            <QuestionResult
              index={i}
              text={q.text}
              questionnaire={questionnaire}
              revealed={r ?? { responses: 0, distribution: null }}
              minN={minN}
            />
          </li>
        ))}
      </ol>

      {shown.length > 0 && (
        <AdvancedAnalysis summary="Mean and median">
          <div className="scroll-x-snap">
            <table className="w-full text-sm">
              <caption className="sr-only">Mean and median per question</caption>
              <thead>
                <tr className="text-left text-xs text-sub">
                  <th scope="col" className="py-1 pr-3 font-medium">
                    Question
                  </th>
                  <th scope="col" className="py-1 pr-3 font-medium text-right">
                    Answers
                  </th>
                  <th scope="col" className="py-1 pr-3 font-medium text-right">
                    Mean
                  </th>
                  <th scope="col" className="py-1 font-medium text-right">
                    Median
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map(({ q, r }) => {
                  const d = r.distribution ?? [];
                  const mean = distributionMean(d, questionnaire.scale);
                  const median = distributionMedian(d, questionnaire.scale);
                  return (
                    <tr key={q.id} className="border-t border-border">
                      <th scope="row" className="py-1 pr-3 text-left font-normal text-text">
                        {q.text}
                      </th>
                      <td className="py-1 pr-3 text-right font-data">{r.responses}</td>
                      <td className="py-1 pr-3 text-right font-data">
                        {mean === null ? NO_VALUE : fmt(mean, 2)}
                      </td>
                      <td className="py-1 text-right font-data">
                        {median === null ? NO_VALUE : fmt(median, 1)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-sub">
            On the scale&apos;s own values:{" "}
            {questionnaire.scale.points.map((p) => `${p.label} = ${p.value}`).join(", ")}.
          </p>
        </AdvancedAnalysis>
      )}
    </section>
  );
}

function QuestionResult({
  index,
  text,
  questionnaire,
  revealed,
  minN,
}: {
  index: number;
  text: string;
  questionnaire: Questionnaire;
  revealed: RevealedQuestion;
  minN: number;
}) {
  const titleId = useId();
  const title = (
    <h3 id={titleId} className="text-sm font-medium text-text">
      {index + 1}. {text}
    </h3>
  );
  const d = revealed.distribution;
  if (!d) {
    return (
      <div className="space-y-2">
        {title}
        {/* The round is closed: say what it lacked, not what to collect now. */}
        <NotEnoughData
          have={revealed.responses}
          need={minN}
          unit={["answer", "answers"]}
          action="It needed"
          what="its results"
        />
        <p className="text-xs text-sub">
          Withheld: {revealed.responses} {revealed.responses === 1 ? "answer" : "answers"}, and a
          question shows its results from {minN}. Ask more people in the next round to see it.
        </p>
      </div>
    );
  }
  const points = questionnaire.scale.points;
  const table = {
    columns: ["Answer", "People", "Share"],
    rows: points.map((p, i) => [p.label, d[i], pct(pointShare(d, i))]),
    caption: text,
  };
  return (
    <div className="space-y-2">
      {title}
      <ChartFigure
        labelledBy={titleId}
        summary={questionSummary(d, questionnaire, revealed.responses)}
        table={table}
      >
        <ul className="space-y-1.5">
          {points.map((p, i) => {
            const share = pointShare(d, i) ?? 0;
            return (
              <li
                key={p.value}
                className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-2 text-xs"
              >
                <span className="truncate text-sub">{p.label}</span>
                <span className="h-3 rounded bg-card-hover">
                  <span
                    className="block h-3 rounded bg-accent/70"
                    style={{ width: `${Math.round(share * 100)}%` }}
                  />
                </span>
                <span className="font-data text-text">{d[i]}</span>
              </li>
            );
          })}
        </ul>
      </ChartFigure>
    </div>
  );
}
