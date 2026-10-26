"use client";

/**
 * A revealed pair round (Kano): per item, how people's two answers went
 * together, as a P × P grid (rows: the answer to the first question,
 * columns: to the second) with a one-sentence summary and "View as
 * table". An item with fewer than minN answers shows "not enough answers"
 * instead: its counts were never revealed. Each question on its own sits in
 * Advanced analysis.
 *
 * The grid is plain markup in `.scroll-x-snap` (it scrolls at 375 px), the
 * cell shading a theme token at an opacity by share (`pairCellFill`),
 * capped so the count on it keeps 4.5:1 in every theme. The answer labels
 * wrap rather than cut off ("I can live with it" in a 3rem column).
 */

import { useEffect, useId, useRef } from "react";
import { AdvancedAnalysis } from "@/components/shared/advanced-analysis";
import { ChartFigure } from "@/components/shared/chart-card";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { listAnd } from "@/lib/charts/chart-text";
import {
  commonPairs,
  pairCount,
  pairMarginals,
  type PairSheet,
  type RevealedPair,
} from "@/lib/realtime/vote-room/pair";

export interface PairResultsProps {
  sheet: PairSheet;
  revealed: readonly RevealedPair[];
  minN: number;
  ballots: number;
  /** Move focus to the "Results" heading on mount: Reveal just replaced the control that had it. */
  focusHeading?: boolean;
}

/**
 * The most a cell's accent shading may cover. The count sits on it in
 * `--text`: at 0.4 the busiest cell is about 5.3:1 in the dark theme
 * (#00e1ff over the card) and 5.8:1 in high contrast (#ffd400), and the
 * light theme's dark text passes at any fill. At 0.75 the dark theme was
 * about 2.3:1.
 */
export const PAIR_CELL_MAX_FILL = 0.4;
const PAIR_CELL_MIN_FILL = 0.1;

/** A cell's shading for `n` of the busiest cell's `top`: none for 0, up to `PAIR_CELL_MAX_FILL`. */
export function pairCellFill(n: number, top: number): number {
  if (n <= 0 || top <= 0) return 0;
  return PAIR_CELL_MIN_FILL + (PAIR_CELL_MAX_FILL - PAIR_CELL_MIN_FILL) * Math.min(1, n / top);
}

/** "Most common pair: I like it / I dislike it (4 of 7)." or the tie, said as such. */
export function pairSummary(joint: readonly number[], sheet: PairSheet, responses: number): string {
  const points = sheet.answers.length;
  const top = commonPairs(joint, points);
  if (responses === 0 || top.length === 0) return "No answers.";
  const name = (p: { first: number; second: number }) =>
    `${sheet.answers[p.first]} / ${sheet.answers[p.second]}`;
  if (top.length === 1) {
    return `Most common pair: ${name(top[0])} (${top[0].count} of ${responses}).`;
  }
  return `Most common pairs: ${listAnd(top.map(name))} (${top[0].count} each, of ${responses}).`;
}

/** The round's one-sentence verdict. */
export function pairResultsVerdict(
  revealed: readonly RevealedPair[],
  ballots: number,
  minN: number
): string {
  const people = `${ballots} ${ballots === 1 ? "person" : "people"} answered`;
  const shown = revealed.filter((r) => r.joint !== null).length;
  if (shown === revealed.length) {
    return revealed.length === 1
      ? `${people}.`
      : `${people}; every item has enough answers to show.`;
  }
  if (shown === 0) return `${people}, but no item has the ${minN} answers it needs to show.`;
  return `${people}; ${shown} of ${revealed.length} items have enough answers to show (${minN} or more).`;
}

export function PairResults({
  sheet,
  revealed,
  minN,
  ballots,
  focusHeading = false,
}: PairResultsProps) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const rows = sheet.items.map((item, i) => ({
    item,
    r: revealed[i] ?? { responses: 0, joint: null },
  }));
  const shown = rows.filter((x) => x.r.joint);

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
        <p className="text-sm text-sub">{pairResultsVerdict(revealed, ballots, minN)}</p>
        <p className="text-xs text-sub">
          Rows: {sheet.prompts.first} Columns: {sheet.prompts.second}
        </p>
      </div>

      <ol className="space-y-3">
        {rows.map(({ item, r }, i) => (
          <li key={item.id} className="rounded-lg border border-border bg-card p-3">
            <ItemResult index={i} text={item.text} sheet={sheet} revealed={r} minN={minN} />
          </li>
        ))}
      </ol>

      {shown.length > 0 && (
        <AdvancedAnalysis summary="Each question on its own">
          {shown.map(({ item, r }) => {
            const m = pairMarginals(r.joint ?? [], sheet.answers.length);
            return (
              <div key={item.id} className="scroll-x-snap">
                <table className="w-full text-sm">
                  <caption className="py-1 text-left text-xs font-medium text-text">
                    {item.text}
                  </caption>
                  <thead>
                    <tr className="text-left text-xs text-sub">
                      <th scope="col" className="py-1 pr-3 font-medium">
                        Answer
                      </th>
                      <th scope="col" className="py-1 pr-3 text-right font-medium">
                        {sheet.prompts.first}
                      </th>
                      <th scope="col" className="py-1 text-right font-medium">
                        {sheet.prompts.second}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sheet.answers.map((a, k) => (
                      <tr key={a} className="border-t border-border">
                        <th scope="row" className="py-1 pr-3 text-left font-normal text-text">
                          {a}
                        </th>
                        <td className="py-1 pr-3 text-right font-data">{m.first[k]}</td>
                        <td className="py-1 text-right font-data">{m.second[k]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </AdvancedAnalysis>
      )}
    </section>
  );
}

function ItemResult({
  index,
  text,
  sheet,
  revealed,
  minN,
}: {
  index: number;
  text: string;
  sheet: PairSheet;
  revealed: RevealedPair;
  minN: number;
}) {
  const titleId = useId();
  const title = (
    <h3 id={titleId} className="text-sm font-medium text-text">
      {index + 1}. {text}
    </h3>
  );
  const joint = revealed.joint;
  if (!joint) {
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
          Withheld: {revealed.responses} {revealed.responses === 1 ? "answer" : "answers"}, and an
          item shows its results from {minN}. Ask more people in the next round to see it.
        </p>
      </div>
    );
  }
  const points = sheet.answers.length;
  const top = Math.max(1, ...joint);
  const table = {
    columns: ["First answer ↓, second answer →", ...sheet.answers],
    rows: sheet.answers.map((a, f) => [
      a,
      ...sheet.answers.map((_, g) => pairCount(joint, points, f, g)),
    ]),
    caption: text,
  };
  return (
    <div className="space-y-2">
      {title}
      <ChartFigure
        labelledBy={titleId}
        summary={pairSummary(joint, sheet, revealed.responses)}
        table={table}
      >
        <div className="scroll-x-snap">
          <div
            className="grid min-w-[22rem] gap-1 text-xs"
            style={{
              gridTemplateColumns: `minmax(6rem, 1.4fr) repeat(${points}, minmax(3rem, 1fr))`,
            }}
          >
            <span />
            {sheet.answers.map((a) => (
              <span key={a} className="self-end break-words text-center leading-tight text-sub">
                {a}
              </span>
            ))}
            {sheet.answers.map((a, f) => (
              <div key={a} className="contents">
                <span className="self-center break-words leading-tight text-sub">{a}</span>
                {sheet.answers.map((b, g) => {
                  const n = pairCount(joint, points, f, g);
                  return (
                    <span
                      key={b}
                      className="relative flex h-8 items-center justify-center overflow-hidden rounded bg-card-hover"
                    >
                      <span
                        className="absolute inset-0 bg-accent"
                        data-pair-fill=""
                        style={{ opacity: pairCellFill(n, top) }}
                      />
                      <span
                        className={
                          n === top && n > 0
                            ? "relative font-data font-semibold text-text"
                            : "relative font-data text-text"
                        }
                      >
                        {n}
                      </span>
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </ChartFigure>
    </div>
  );
}
