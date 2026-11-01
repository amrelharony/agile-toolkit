"use client";

/**
 * A revealed allocation round (Buy-a-Feature, the $100 Test): what each
 * item got in all and on average, as one chart (bars of the average, as a
 * share of each person's budget) with a summary and "View as table", plus
 * "kept / over" for items with a cap.
 *
 * Who gave an item anything, and how the amounts were spread (five bands
 * of the budget, and where the middle half of the people's amounts lie),
 * show only from `VOTE_LIMITS.minNSpread` answers, in Advanced analysis.
 * Below that it says what the round lacked; for totals typed by hand
 * (`spreadKnown` false) it says the spread isn't known, at any count, since
 * more answers wouldn't have shown it. Plain bars, no chart library; theme
 * tokens only.
 */

import { useEffect, useId, useRef } from "react";
import { AdvancedAnalysis } from "@/components/shared/advanced-analysis";
import { ChartFigure } from "@/components/shared/chart-card";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { NO_VALUE, listAnd } from "@/lib/charts/chart-text";
import { VOTE_LIMITS } from "@/lib/realtime/vote-room/protocol";
import {
  ALLOCATION_BANDS,
  allocationAmount,
  allocationBandEdges,
  allocationMean,
  bandLabel,
  cappedTotal,
  middleHalfText,
  type AllocationSheet,
  type RevealedAllocation,
} from "@/lib/realtime/vote-room/allocation";
import { effectiveMinN } from "@/lib/realtime/vote-room/aggregate";

export interface AllocationResultsProps {
  sheet: AllocationSheet;
  revealed: readonly RevealedAllocation[];
  minN: number;
  /** People who split the budget. */
  ballots: number;
  /**
   * False for totals typed by hand (`AllocationRoundResult.spreadKnown`):
   * the spread is then unknown whatever the count. Default true (live
   * rounds and paper splits).
   */
  spreadKnown?: boolean;
  /** Move focus to the "Results" heading on mount: Reveal just replaced the control that had it. */
  focusHeading?: boolean;
}

function people(n: number): string {
  return `${n} ${n === 1 ? "person" : "people"}`;
}

/**
 * The round's one-sentence verdict: "5 people split $100 each. Search got
 * the most: $180 in all, $36 on average."
 */
export function allocationVerdict(
  sheet: AllocationSheet,
  revealed: readonly RevealedAllocation[],
  ballots: number
): string {
  const money = (n: number) => allocationAmount(n, sheet.unit);
  const head = `${people(ballots)} split ${money(sheet.budget)} each.`;
  const top = Math.max(0, ...revealed.map((r) => r.total));
  if (top === 0) return `${head} Nobody gave anything.`;
  const leaders = sheet.items.filter((_, i) => revealed[i]?.total === top).map((x) => x.text);
  const mean = allocationMean(top, ballots);
  const avg = mean === null ? "" : `, ${money(mean)} on average`;
  return leaders.length === 1
    ? `${head} ${leaders[0]} got the most: ${money(top)} in all${avg}.`
    : `${head} ${listAnd(leaders)} got the most: ${money(top)} each in all${avg}.`;
}

/**
 * The averages chart's one-line summary: the highest and lowest averages
 * ("Highest average: Search, $36. Lowest: Themes, $5."), ties named
 * together. One sentence however many items; each item's own line is in
 * "View as table".
 */
export function allocationChartSummary(
  sheet: AllocationSheet,
  revealed: readonly RevealedAllocation[],
  ballots: number
): string {
  const money = (n: number) => allocationAmount(n, sheet.unit);
  const totals = sheet.items.map((_, i) => revealed[i]?.total ?? 0);
  if (ballots <= 0 || totals.length === 0) return "No answers.";
  const hi = Math.max(...totals);
  const lo = Math.min(...totals);
  const named = (t: number) =>
    listAnd(sheet.items.filter((_, i) => totals[i] === t).map((x) => x.text));
  const avg = (t: number) => money(allocationMean(t, ballots) ?? 0);
  if (hi === lo) return `Every item averaged ${avg(hi)}.`;
  return `Highest average: ${named(hi)}, ${avg(hi)}. Lowest: ${named(lo)}, ${avg(lo)}.`;
}

/** One item's line: "Search: $180 in all, $36 on average, from 4 of 5 people." */
export function allocationItemSummary(
  text: string,
  r: RevealedAllocation,
  sheet: AllocationSheet,
  ballots: number
): string {
  const money = (n: number) => allocationAmount(n, sheet.unit);
  const mean = allocationMean(r.total, ballots);
  const from = r.backers === null ? "" : `, from ${r.backers} of ${people(ballots)}`;
  return `${text}: ${money(r.total)} in all${mean === null ? "" : `, ${money(mean)} on average`}${from}.`;
}

export function AllocationResults({
  sheet,
  revealed,
  minN,
  ballots,
  spreadKnown = true,
  focusHeading = false,
}: AllocationResultsProps) {
  const headingId = useId();
  const chartTitleId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const money = (n: number) => allocationAmount(n, sheet.unit);
  const edges = allocationBandEdges(sheet.budget);
  const spreadNeed = Math.max(effectiveMinN(minN), VOTE_LIMITS.minNSpread);
  const rows = sheet.items.map((item, i) => ({
    item,
    r: revealed[i] ?? { total: 0, backers: null, bands: null },
  }));
  const spreadShown = rows.some((x) => x.r.bands !== null);
  const overCap = rows
    .map(({ item, r }) => ({ item, ...cappedTotal(r.total, item.cap) }))
    .filter((x) => x.over > 0);

  useEffect(() => {
    if (focusHeading) headingRef.current?.focus();
    // On mount only: later renders keep focus wherever the person moved it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const table = {
    columns: ["Item", "Total", "Average", "People who gave something", "Middle half"],
    rows: rows.map(({ item, r }) => {
      const mean = allocationMean(r.total, ballots);
      return [
        item.text,
        money(r.total),
        mean === null ? NO_VALUE : money(mean),
        r.backers ?? NO_VALUE,
        r.bands ? (middleHalfText(r.bands, edges, sheet.budget, sheet.unit) ?? NO_VALUE) : NO_VALUE,
      ];
    }),
    caption: sheet.title,
  };

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
        <p className="text-sm text-sub">{allocationVerdict(sheet, revealed, ballots)}</p>
      </div>

      <div className="space-y-2 rounded-lg border border-border bg-card p-3">
        <h3 id={chartTitleId} className="text-sm font-medium text-text">
          Average per person, of {money(sheet.budget)}
        </h3>
        <ChartFigure
          labelledBy={chartTitleId}
          summary={allocationChartSummary(sheet, revealed, ballots)}
          table={table}
        >
          <ul className="space-y-1.5">
            {rows.map(({ item, r }) => {
              const mean = allocationMean(r.total, ballots) ?? 0;
              const share = sheet.budget > 0 ? Math.min(1, mean / sheet.budget) : 0;
              return (
                <li
                  key={item.id}
                  className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-2 text-xs"
                >
                  <span className="truncate text-sub">{item.text}</span>
                  <span className="h-3 rounded bg-card-hover">
                    <span
                      className="block h-3 rounded bg-accent/70"
                      style={{ width: `${Math.round(share * 100)}%` }}
                    />
                  </span>
                  <span className="font-data text-text">{money(mean)}</span>
                </li>
              );
            })}
          </ul>
        </ChartFigure>
        {overCap.length > 0 && (
          <ul className="space-y-1 text-xs text-sub">
            {overCap.map(({ item, kept, over }) => (
              <li key={item.id}>
                {item.text}: {money(kept)} kept, {money(over)} over: refunded.
              </li>
            ))}
          </ul>
        )}
      </div>

      {spreadShown ? (
        <AdvancedAnalysis summary="How the amounts were spread">
          <p className="text-xs text-sub">
            People per band of each person&apos;s {money(sheet.budget)}. The middle half is where
            the amounts of the middle half of the people fell.
          </p>
          <div className="scroll-x-snap">
            <table className="w-full text-sm">
              <caption className="sr-only">People per band, per item</caption>
              <thead>
                <tr className="text-left text-xs text-sub">
                  <th scope="col" className="py-1 pr-3 font-medium">
                    Item
                  </th>
                  {Array.from({ length: ALLOCATION_BANDS }, (_, k) => (
                    <th key={k} scope="col" className="py-1 pr-3 text-right font-medium">
                      {bandLabel(k, edges, sheet.budget, sheet.unit)}
                    </th>
                  ))}
                  <th scope="col" className="py-1 font-medium">
                    Middle half
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ item, r }) => (
                  <tr key={item.id} className="border-t border-border">
                    <th scope="row" className="py-1 pr-3 text-left font-normal text-text">
                      {item.text}
                    </th>
                    {Array.from({ length: ALLOCATION_BANDS }, (_, k) => (
                      <td key={k} className="py-1 pr-3 text-right font-data">
                        {r.bands ? r.bands[k] : NO_VALUE}
                      </td>
                    ))}
                    <td className="py-1 text-xs text-sub">
                      {r.bands
                        ? (middleHalfText(r.bands, edges, sheet.budget, sheet.unit) ?? NO_VALUE)
                        : NO_VALUE}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </AdvancedAnalysis>
      ) : !spreadKnown ? (
        // Typed totals never show a spread: more answers wouldn't have helped.
        <p className="text-sm text-sub">
          The totals were entered by hand, so how the amounts were spread isn&apos;t known.
        </p>
      ) : ballots < spreadNeed ? (
        // The round is closed: say what it lacked, not what to collect now.
        <NotEnoughData
          have={ballots}
          need={spreadNeed}
          unit={["answer", "answers"]}
          action="It needed"
          what="how the amounts were spread"
        />
      ) : (
        <p className="text-sm text-sub">How the amounts were spread wasn&apos;t shared.</p>
      )}
    </section>
  );
}
