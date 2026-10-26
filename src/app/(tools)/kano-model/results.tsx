"use client";

import { ChartFigure } from "@/components/shared/chart-card";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { cn } from "@/lib/utils";
import {
  KANO_ANSWERS,
  KANO_ANSWER_LABEL,
  KANO_CATEGORY_LABEL,
  KANO_CLASS_CATEGORY,
  KANO_MIN_RESPONSES,
  KANO_TABLE,
  kanoCategory,
  kanoCoefficients,
  readKano,
  type KanoCategory,
  type KanoClass,
} from "@/lib/prioritization/methods/kano";
import type { PairRoundResult } from "@/lib/realtime/vote-room/pair";
import type { RankedRow } from "@/lib/prioritization/rank";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";
import { coefText, featureView, shortName, type FeatureView } from "./model";
import { applyKanoRound } from "./survey";

/** Each category's chip colours, as theme tokens (never a hex). */
export const CATEGORY_TONE: Record<KanoCategory, string> = {
  "must-be": "border-danger/40 text-danger",
  performance: "border-accent/40 text-accent",
  attractive: "border-success/40 text-success",
  indifferent: "border-border text-sub",
  reverse: "border-warning/40 text-warning",
  questionable: "border-border text-sub",
};

/** A dot's fill on the Better/Worse plot. */
const DOT: Record<KanoCategory, string> = {
  "must-be": "bg-danger",
  performance: "bg-accent",
  attractive: "bg-success",
  indifferent: "bg-sub",
  reverse: "bg-warning",
  questionable: "bg-sub",
};

const CLASS_TONE: Record<KanoClass, string> = {
  A: "text-success",
  O: "text-accent",
  M: "text-danger",
  I: "text-sub",
  R: "text-warning",
  Q: "text-sub",
};

/**
 * "How the category is found": the Kano evaluation table, rows the answer
 * to "If it has this", columns to "If it doesn't". Each answer pair is one
 * class; a feature's category is its most common class.
 */
export function EvaluationTable() {
  return (
    <div className="space-y-2">
      <p className="text-sm text-sub">
        Each answer pair falls in one class: <strong className="text-text">A</strong> attractive,{" "}
        <strong className="text-text">O</strong> performance,{" "}
        <strong className="text-text">M</strong> must-be, <strong className="text-text">I</strong>{" "}
        indifferent, <strong className="text-text">R</strong> reverse and{" "}
        <strong className="text-text">Q</strong> questionable (the answers contradict each other). A
        feature&apos;s category is its most common class (a tie goes M, O, A, I, R, Q) once{" "}
        {KANO_MIN_RESPONSES} people have answered. Better = (A + O) ÷ (A + O + M + I), Worse = −(O +
        M) ÷ (A + O + M + I).
      </p>
      <div className="scroll-x-snap relative">
        <table className="text-xs">
          <caption className="sr-only">
            The Kano evaluation table: rows are the answer if it has the feature, columns the answer
            if it doesn&apos;t.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="py-1 pr-2 text-left font-medium text-sub">
                Has it ↓ / doesn&apos;t →
              </th>
              {KANO_ANSWERS.map((d) => (
                <th key={d} scope="col" className="px-2 py-1 text-center font-medium text-sub">
                  {KANO_ANSWER_LABEL[d]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {KANO_ANSWERS.map((f) => (
              <tr key={f}>
                <th scope="row" className="py-1 pr-2 text-left font-normal text-sub">
                  {KANO_ANSWER_LABEL[f]}
                </th>
                {KANO_ANSWERS.map((d) => {
                  const c = KANO_TABLE[f][d];
                  return (
                    <td
                      key={d}
                      className={cn("px-2 py-1 text-center font-mono font-medium", CLASS_TONE[c])}
                      title={KANO_CATEGORY_LABEL[KANO_CLASS_CATEGORY[c]]}
                    >
                      {c}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The features with Better and Worse (3 answers or more), in list order. */
export function plotted(rows: readonly RankedRow[]): FeatureView[] {
  return rows.map(featureView).filter((f) => f.coefficients !== null);
}

/** The plot's one-sentence summary. */
export function plotSummary(points: readonly FeatureView[]): string {
  if (points.length === 0) return "No feature has 3 answers yet.";
  const best = [...points].sort(
    (a, b) => (b.coefficients?.better ?? 0) - (a.coefficients?.better ?? 0)
  )[0];
  const worst = [...points].sort(
    (a, b) => (a.coefficients?.worse ?? 0) - (b.coefficients?.worse ?? 0)
  )[0];
  const n = points.length;
  return (
    `${n} ${n === 1 ? "feature" : "features"} with enough answers. ` +
    `Most satisfying to have: “${shortName(best.ranked.row.title)}” (Better ${coefText(best.coefficients?.better)}). ` +
    `Most missed when absent: “${shortName(worst.ranked.row.title)}” (Worse ${coefText(worst.coefficients?.worse)}).`
  );
}

/**
 * Better against Worse, one dot per feature with 3 answers or more:
 * across, how much missing it hurts (|Worse|, 0–1); up, how much having
 * it helps (Better, 0–1). The quarters read as the categories do: top
 * left Attractive, top right Performance, bottom right Must-be, bottom
 * left Indifferent. Dots are numbered as the key under the plot; the
 * figure's summary and table carry the same for screen readers.
 */
export function BetterWorsePlot({ rows }: { rows: readonly RankedRow[] }) {
  const points = plotted(rows);
  const answered = rows.map(featureView).filter((f) => f.reading.counts !== null);
  if (points.length === 0) {
    const most = answered.reduce((m, f) => Math.max(m, f.n), 0);
    return (
      <NotEnoughData
        have={most}
        need={KANO_MIN_RESPONSES}
        unit={["answer", "answers"]}
        action="Collect"
        what="Better and Worse for a feature"
      />
    );
  }
  return (
    <ChartFigure
      label="Better vs Worse"
      summary={plotSummary(points)}
      table={{
        columns: ["Feature", "Answers", "Better", "Worse", "Category"],
        rows: points.map((f) => [
          f.ranked.row.title,
          f.n,
          coefText(f.coefficients?.better),
          coefText(f.coefficients?.worse),
          f.category ? KANO_CATEGORY_LABEL[f.category] : "—",
        ]),
      }}
    >
      <div className="mx-auto w-full max-w-md space-y-2">
        <div className="text-xs uppercase tracking-wider text-sub">↑ Better (having it helps)</div>
        <div className="relative aspect-square w-full overflow-hidden rounded-lg border border-border bg-bg">
          <div className="absolute inset-0 grid grid-cols-2 grid-rows-2">
            <div className="border-b border-r border-border p-2 text-xs text-success">
              Attractive
            </div>
            <div className="border-b border-border p-2 text-right text-xs text-accent">
              Performance
            </div>
            <div className="border-r border-border p-2 text-xs text-sub">Indifferent</div>
            <div className="p-2 text-right text-xs text-danger">Must-be</div>
          </div>
          {points.map((f, i) => {
            const x = Math.min(1, Math.abs(f.coefficients?.worse ?? 0));
            const y = Math.min(1, f.coefficients?.better ?? 0);
            return (
              <span
                key={f.ranked.row.id}
                className={cn(
                  "absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-xs font-medium text-bg shadow",
                  f.category ? DOT[f.category] : "bg-sub"
                )}
                // Kept inside the frame at 0 and 1.
                style={{ left: `${4 + x * 92}%`, top: `${96 - y * 92}%` }}
                title={f.ranked.row.title}
              >
                {i + 1}
              </span>
            );
          })}
        </div>
        <div className="text-right text-xs uppercase tracking-wider text-sub">
          |Worse| (missing it hurts) →
        </div>
        <ol className="grid grid-cols-1 gap-1 text-xs text-sub sm:grid-cols-2">
          {points.map((f, i) => (
            <li key={f.ranked.row.id} className="flex min-w-0 gap-1.5">
              <span className="font-mono text-text">{i + 1}</span>
              <span className="break-words">{f.ranked.row.title}</span>
            </li>
          ))}
        </ol>
      </div>
    </ChartFigure>
  );
}

/**
 * Beside a round's Save: what saving does to each feature, by the same
 * code that saves it (applyKanoRound, with "Add to earlier answers" as
 * set): its category and Better and Worse after the round, or why it is
 * left as it is.
 */
export function KanoRoundPreview({
  result,
  rows,
  add,
}: {
  result: PairRoundResult;
  rows: readonly PrioritizationItem[];
  add: boolean;
}) {
  const next = new Map(applyKanoRound(rows, result, { add }).map((r) => [r.id, r]));
  return (
    <div className="space-y-1">
      <h4 className="text-sm font-medium text-text">What saving does</h4>
      <ul className="space-y-1 text-sm">
        {result.items.map((item) => {
          const row = next.get(item.id);
          const r = row ? readKano(row.fields) : null;
          const cat = r?.counts ? kanoCategory(r.counts) : null;
          const coef = r?.counts ? kanoCoefficients(r.counts) : null;
          return (
            <li key={item.id} className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-text">{item.text}</span>
              {r && cat ? (
                <span className="text-xs text-sub">
                  {KANO_CATEGORY_LABEL[cat]} · {r.n} {r.n === 1 ? "answer" : "answers"}
                  {add ? " in all" : ""} · Better {coefText(coef?.better)}, Worse{" "}
                  {coefText(coef?.worse)}
                </span>
              ) : (
                <span className="text-xs text-sub">
                  {item.joint
                    ? "Not saved: it's no longer on the list"
                    : `Not saved: ${item.responses} ${item.responses === 1 ? "answer" : "answers"}, fewer than ${result.minN}`}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
