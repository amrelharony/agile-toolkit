"use client";

import { useId } from "react";
import { AllocationResults } from "@/components/collab/vote-room";
import { ChartFigure } from "@/components/shared/chart-card";
import { NO_VALUE, listAnd } from "@/lib/charts/chart-text";
import type { AllocationRound } from "@/lib/stores/workspace-types";
import { allocationAmount } from "@/lib/realtime/vote-room/allocation";
import { kitResultOf, sheetOfRound } from "@/lib/hundred-dollar/allocation";
import { fundedShare, isFunded, remaining, type FeatureLedger } from "@/lib/buy-a-feature/game";

/** The priced features, most funded first (a read-only view: it may re-sort). */
function byShare(features: readonly FeatureLedger[]): FeatureLedger[] {
  return features
    .filter((f) => f.price !== null)
    .sort(
      (a, b) => (fundedShare(b) ?? 0) - (fundedShare(a) ?? 0) || a.title.localeCompare(b.title)
    );
}

/** "2 of 5 features funded. Closest to funded: Bulk export, 63%." */
export function fundingSummary(features: readonly FeatureLedger[]): string {
  const priced = byShare(features);
  if (priced.length === 0) return "No priced features yet.";
  const funded = priced.filter(isFunded);
  const head = `${funded.length} of ${priced.length} ${priced.length === 1 ? "feature" : "features"} funded.`;
  const next = priced.filter((f) => !isFunded(f) && f.raised > 0);
  if (next.length === 0)
    return funded.length === priced.length ? head : `${head} Nothing pledged to the rest.`;
  const top = Math.round((fundedShare(next[0]) ?? 0) * 100);
  const closest = next.filter((f) => Math.round((fundedShare(f) ?? 0) * 100) === top);
  return `${head} Closest to funded: ${listAnd(closest.map((f) => f.title))}, ${top}%.`;
}

/**
 * Each priced feature's share of its price raised, as bars (green once
 * funded), with the summary and "View as table" (price, raised, to go).
 */
export function FundingChart({
  features,
  unit,
}: {
  features: readonly FeatureLedger[];
  unit: string;
}) {
  const titleId = useId();
  const money = (n: number) => allocationAmount(n, unit);
  const priced = byShare(features);
  const table = {
    columns: ["Feature", "Price", "Raised", "To go", "Funded"],
    rows: priced.map((f) => [
      f.title,
      f.price === null ? NO_VALUE : money(f.price),
      money(f.raised),
      money(remaining(f)),
      isFunded(f) ? "Yes" : `${Math.round((fundedShare(f) ?? 0) * 100)}%`,
    ]),
    caption: "Funding per feature",
  };
  return (
    <div className="space-y-2">
      <h3 id={titleId} className="text-sm font-medium text-text">
        Share of each price raised
      </h3>
      <ChartFigure labelledBy={titleId} summary={fundingSummary(features)} table={table}>
        <ul className="space-y-1.5">
          {priced.map((f) => {
            const pct = Math.round((fundedShare(f) ?? 0) * 100);
            return (
              <li
                key={f.id}
                className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2 text-xs"
              >
                <span className="truncate text-sub">{f.title}</span>
                <span className="h-3 rounded bg-card-hover">
                  <span
                    className={`block h-3 rounded ${isFunded(f) ? "bg-success" : "bg-accent/70"}`}
                    style={{ width: `${pct}%` }}
                  />
                </span>
                <span className="font-data text-text">{pct}%</span>
              </li>
            );
          })}
        </ul>
      </ChartFigure>
    </div>
  );
}

/** "Round 2 · 20 Oct 2026 · 5 people · live" */
export function gameRoundLabel(r: AllocationRound, n: number): string {
  const d = new Date(`${r.date.slice(0, 10)}T12:00:00`);
  const day = Number.isNaN(d.getTime())
    ? r.date
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const how = r.source === "room" ? "live" : "entered by hand";
  return `Round ${n} · ${day} · ${r.ballots} ${r.ballots === 1 ? "person" : "people"} · ${how}`;
}

/**
 * The game's saved rounds, newest first, each opening onto the kit's
 * results (totals and averages; who backed what and the spread from 5
 * answers, in Advanced analysis). A round holds totals only.
 */
export function GameRounds({ rounds }: { rounds: readonly AllocationRound[] }) {
  return (
    <ul className="space-y-2" aria-label="Saved rounds">
      {rounds.map((r, i) => {
        const result = kitResultOf(r);
        return (
          <li key={r.id}>
            <details className="rounded-lg border border-border bg-card">
              <summary className="min-h-11 cursor-pointer px-3 py-2 text-sm text-text">
                {gameRoundLabel(r, rounds.length - i)}
              </summary>
              <div className="border-t border-border p-3">
                <AllocationResults
                  sheet={sheetOfRound(r)}
                  revealed={result.items.map((x) => ({
                    total: x.total,
                    backers: x.backers,
                    bands: x.bands,
                  }))}
                  minN={r.minN}
                  ballots={r.ballots}
                  spreadKnown={result.spreadKnown}
                />
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}
