"use client";

import { useId } from "react";
import { Trash2 } from "lucide-react";
import { AdvancedAnalysis } from "@/components/shared/advanced-analysis";
import { ChartFigure } from "@/components/shared/chart-card";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { IconButton } from "@/components/ui/icon-button";
import { Label } from "@/components/ui/label";
import { NO_VALUE } from "@/lib/charts/chart-text";
import type { AllocationRound, PrioritizationItem } from "@/lib/stores/workspace-types";
import { ALLOCATION_BANDS, allocationAmount } from "@/lib/realtime/vote-room/allocation";
import { VOTE_LIMITS } from "@/lib/realtime/vote-room/protocol";
import {
  bandLabels,
  compareSplit,
  dollars,
  spreadKnownOf,
  teamAverages,
  type SplitComparison,
} from "@/lib/hundred-dollar/allocation";

/** "20 Oct 2026" */
function dayLabel(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const howOf = (r: AllocationRound) => (r.source === "room" ? "live" : "entered by hand");

/** "20 Oct 2026 · 6 people · live" */
export function roundLabel(r: AllocationRound): string {
  return `${dayLabel(r.date)} · ${r.ballots} ${r.ballots === 1 ? "person" : "people"} · ${howOf(r)}`;
}

/** "20 Oct 2026, live" */
export function roundWhen(r: AllocationRound): string {
  return `${dayLabel(r.date)}, ${howOf(r)}`;
}

/** The chart's one-sentence summary: who leads on average, and how the agreed split compares. */
export function resultsSummary(rows: readonly SplitComparison[], unit: string): string {
  const inRound = rows.filter((x) => x.mean !== null);
  if (inRound.length === 0) return "No answers.";
  const top = Math.max(...inRound.map((x) => x.mean as number));
  const lo = Math.min(...inRound.map((x) => x.mean as number));
  const name = (v: number) =>
    inRound
      .filter((x) => x.mean === v)
      .map((x) => x.text)
      .join(" and ");
  const money = (n: number) => allocationAmount(n, unit);
  if (top === lo) return `Every item averaged ${money(top)}.`;
  return `Highest team average: ${name(top)}, ${money(top)}. Lowest: ${name(lo)}, ${money(lo)}.`;
}

/**
 * One saved team round: each item's team average as a bar, beside the
 * agreed split, with the round's spread (five bands of the $100, and where
 * the middle half of the people's amounts fell) from 5 answers. The chart's
 * table carries the same numbers; the per-band counts are in Advanced
 * analysis. Only the totals and bands are on screen, never anyone's split.
 */
export function TeamResults({
  round,
  rows,
}: {
  round: AllocationRound;
  rows: readonly PrioritizationItem[];
}) {
  const titleId = useId();
  const money = (n: number) => allocationAmount(n, round.unit);
  const compare = compareSplit(rows, round);
  const averages = new Map(teamAverages(round).map((a) => [a.itemId, a]));
  const labels = bandLabels(round);
  const spreadShown = round.items.some((x) => x.bands !== null);
  const spreadNeed = Math.max(round.minN, VOTE_LIMITS.minNSpread);

  const table = {
    columns: ["Item", "Team average", "People who gave something", "Middle half", "Agreed split"],
    rows: compare.map((c) => [
      c.current ? c.text : `${c.text} (deleted since)`,
      c.mean === null ? NO_VALUE : money(c.mean),
      c.backers ?? NO_VALUE,
      c.middleHalf ?? NO_VALUE,
      c.agreed === null ? NO_VALUE : dollars(c.agreed),
    ]),
    caption: `Team round, ${roundLabel(round)}`,
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-lg border border-border bg-card p-3">
        <h3 id={titleId} className="text-sm font-medium text-text">
          Team average per person, of {money(round.budget)}
        </h3>
        <ChartFigure
          labelledBy={titleId}
          summary={resultsSummary(compare, round.unit)}
          table={table}
        >
          <ul className="space-y-3">
            {compare.map((c) => {
              const share = c.mean === null ? 0 : Math.min(1, c.mean / round.budget);
              const agreed = c.agreed === null ? null : Math.min(1, c.agreed / round.budget);
              const bands = averages.get(c.itemId)?.bands ?? null;
              return (
                <li key={c.itemId} className="space-y-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
                    <span className="min-w-0 truncate text-text">
                      {c.text}
                      {!c.current && <span className="text-sub"> (deleted since)</span>}
                    </span>
                    <span className="font-data text-sub">
                      {c.mean === null ? "Not in this round" : `${money(c.mean)} average`}
                      {c.agreed !== null && ` · agreed ${dollars(c.agreed)}`}
                    </span>
                  </div>
                  <span className="relative block h-3 rounded bg-card-hover">
                    <span
                      className="block h-3 rounded bg-accent/70"
                      style={{ width: `${Math.round(share * 100)}%` }}
                    />
                    {agreed !== null && (
                      // The agreed split as a tick on the same scale.
                      <span
                        className="absolute top-0 h-3 w-0.5 bg-text"
                        style={{ left: `calc(${Math.round(agreed * 100)}% - 1px)` }}
                      />
                    )}
                  </span>
                  {bands && (
                    <div className="space-y-1">
                      <ol
                        className="grid grid-cols-5 gap-1"
                        aria-label={`How many people gave ${c.text} each amount`}
                      >
                        {bands.map((n, k) => (
                          <li
                            key={k}
                            className="rounded border border-border bg-surface px-1 py-0.5 text-center text-xs"
                          >
                            <span className="block truncate text-sub">{labels[k]}</span>
                            <span className="font-data text-text">{n}</span>
                          </li>
                        ))}
                      </ol>
                      {c.middleHalf && (
                        <p className="text-xs text-sub">The middle half gave {c.middleHalf}.</p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </ChartFigure>
        <p className="text-xs text-sub">
          The bar is the team&apos;s average; the dark tick is the agreed split.
        </p>
      </div>

      {spreadShown ? (
        <AdvancedAnalysis summary="People per band">
          <p className="text-xs text-sub">
            How many people gave each item an amount in each band of their {money(round.budget)}.
          </p>
          <div className="scroll-x-snap relative">
            <table className="w-full text-sm">
              <caption className="sr-only">People per band, per item</caption>
              <thead>
                <tr className="text-left text-xs text-sub">
                  <th scope="col" className="py-1 pr-3 font-medium">
                    Item
                  </th>
                  {Array.from({ length: ALLOCATION_BANDS }, (_, k) => (
                    <th key={k} scope="col" className="py-1 pr-3 text-right font-medium">
                      {labels[k]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {round.items.map((x) => (
                  <tr key={x.itemId} className="border-t border-border">
                    <th scope="row" className="py-1 pr-3 text-left font-normal text-text">
                      {x.text}
                    </th>
                    {Array.from({ length: ALLOCATION_BANDS }, (_, k) => (
                      <td key={k} className="py-1 pr-3 text-right font-data">
                        {x.bands ? x.bands[k] : NO_VALUE}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </AdvancedAnalysis>
      ) : !spreadKnownOf(round) ? (
        <p className="text-sm text-sub">
          The totals were typed in, so how the amounts were spread isn&apos;t known.
        </p>
      ) : (
        <NotEnoughData
          have={round.ballots}
          need={spreadNeed}
          unit={["answer", "answers"]}
          action="It needed"
          what="how the amounts were spread"
        />
      )}
    </div>
  );
}

/** Pick which saved round to show; newest first. */
export function RoundPicker({
  rounds,
  selectedId,
  onSelect,
}: {
  rounds: readonly AllocationRound[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const id = useId();
  if (rounds.length < 2) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Label htmlFor={id} className="text-sm text-sub">
        Round
      </Label>
      <select
        id={id}
        value={selectedId}
        onChange={(e) => onSelect(e.target.value)}
        className="h-9 min-w-0 max-w-full rounded-md border border-border bg-surface px-2 text-sm text-text"
      >
        {rounds.map((r, i) => (
          <option key={r.id} value={r.id}>
            {roundLabel(r)}
            {i === 0 ? " (latest)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

/** The saved rounds, newest first, each with Delete (the page offers Undo). */
export function RoundHistory({
  rounds,
  readOnly,
  onDelete,
}: {
  rounds: readonly AllocationRound[];
  readOnly: boolean;
  onDelete: (r: AllocationRound) => void;
}) {
  return (
    <ul className="divide-y divide-border" aria-label="Saved team rounds">
      {rounds.map((r) => (
        <li key={r.id} className="flex items-center gap-2 py-2 text-sm">
          <span className="min-w-0 flex-1 text-text">{roundLabel(r)}</span>
          <IconButton
            label={`Delete the round of ${roundLabel(r)}`}
            icon={<Trash2 className="h-4 w-4" />}
            className="text-sub hover:text-danger"
            disabled={readOnly}
            onClick={() => onDelete(r)}
          />
        </li>
      ))}
    </ul>
  );
}
