"use client";

/**
 * A result as the page shows it: the verdict first ("Too early to call"
 * until the planned sample is in, the numbers still below it), each
 * version's rate with its interval (cards on a phone, a table from md up),
 * B against A as a difference and a lift, p, and the split check. Every
 * number comes from lib/experiments.
 */

import { AlertTriangle } from "lucide-react";
import {
  analysisPText,
  liftText,
  percentText,
  pointsText,
  rateText,
  splitPText,
  type ConversionAnalysis,
} from "@/lib/experiments/ab";
import { countText, type ResultReading } from "@/lib/experiments/model";
import { cn } from "@/lib/utils";

/** A result's colour by which way it went: B won, B lost, or no clear difference. */
export function verdictTone(r: Pick<ConversionAnalysis, "significant" | "difference">): string {
  if (!r.significant) return "text-text";
  return r.difference > 0 ? "text-success" : "text-danger";
}

export function ResultView({
  reading,
  live = false,
  className,
}: {
  reading: ResultReading;
  /** The calculator's own result: its verdict is a polite live region. */
  live?: boolean;
  className?: string;
}) {
  const r = reading.analysis;
  const level = percentText(r.level);
  const tooEarly = reading.early.planned !== null && !reading.early.met;
  const versions = [
    { name: "A (control)", v: r.a },
    { name: "B", v: r.b },
  ];
  const [dl, dh] = r.differenceInterval;
  return (
    <div className={cn("space-y-3", className)}>
      <p
        className={cn(
          "break-words text-sm font-medium",
          tooEarly ? "text-warning" : verdictTone(r)
        )}
        {...(live ? { role: "status" } : {})}
      >
        {reading.verdict}
      </p>
      {tooEarly && <p className="text-xs text-sub">So far: {reading.sentence}</p>}
      {reading.note && <p className="text-xs text-sub">{reading.note}</p>}
      {reading.splitWarning && (
        <p className="flex items-start gap-1.5 text-xs text-warning">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{reading.splitWarning}</span>
        </p>
      )}

      {/* A phone reads each version as a card; a wider screen as a table. */}
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:hidden" aria-label="Versions">
        {versions.map(({ name, v }) => (
          <li key={name} className="rounded-md border border-border bg-surface p-2.5 text-sm">
            <p className="font-medium text-text">{name}</p>
            <p className="text-text">
              {rateText(v.rate)}{" "}
              <span className="text-sub">
                ({countText(v.conversions)} of {countText(v.visitors)})
              </span>
            </p>
            <p className="text-xs text-sub">
              {level} interval {rateText(v.interval[0])} to {rateText(v.interval[1])}
            </p>
          </li>
        ))}
      </ul>
      <table className="hidden w-full text-sm md:table">
        <caption className="sr-only">Each version&apos;s conversion rate</caption>
        <thead>
          <tr className="border-b border-border text-left text-xs text-sub">
            <th scope="col" className="py-1.5 pr-3 font-medium">
              Variant
            </th>
            <th scope="col" className="py-1.5 pr-3 text-right font-medium">
              Visitors
            </th>
            <th scope="col" className="py-1.5 pr-3 text-right font-medium">
              Conversions
            </th>
            <th scope="col" className="py-1.5 font-medium">
              Rate ({level} interval)
            </th>
          </tr>
        </thead>
        <tbody>
          {versions.map(({ name, v }) => (
            <tr key={name} className="border-b border-border">
              <th scope="row" className="py-1.5 pr-3 text-left font-medium text-text">
                {name}
              </th>
              <td className="py-1.5 pr-3 text-right tabular-nums">{countText(v.visitors)}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{countText(v.conversions)}</td>
              <td className="py-1.5 tabular-nums">
                {rateText(v.rate)}{" "}
                <span className="text-sub">
                  ({rateText(v.interval[0])} to {rateText(v.interval[1])})
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
        <div className="min-w-0">
          <dt className="text-xs text-sub">Difference, B − A</dt>
          <dd className="break-words text-text">
            {pointsText(r.difference)} points{" "}
            <span className="text-sub">
              ({level} interval {pointsText(dl)} to {pointsText(dh)})
            </span>
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-sub">Lift</dt>
          <dd className="break-words text-text">
            {r.lift === null || !r.liftInterval ? (
              <span className="text-sub">Needs a conversion in each version</span>
            ) : (
              <>
                {liftText(r.lift)}{" "}
                <span className="text-sub">
                  ({liftText(r.liftInterval[0])} to {liftText(r.liftInterval[1])})
                </span>
              </>
            )}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-sub">{r.sided === "one" ? "p (one-sided)" : "p"}</dt>
          <dd className="text-text">
            {analysisPText(r)}{" "}
            <span className="text-sub">
              {r.significant
                ? `significant at ${percentText(r.confidence)}`
                : `not significant at ${percentText(r.confidence)}`}
            </span>
          </dd>
        </div>
      </dl>
      <p className="text-xs text-sub">
        Split check: p {splitPText(r.split)}
        {r.split.flagged
          ? ", further from even than chance would make it."
          : ", as even as planned."}
      </p>
    </div>
  );
}
