"use client";

import { useId, useState } from "react";
import { Layers } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { Button } from "@/components/ui/button";
import {
  itemEfficiency,
  stageDuration,
  stageSentence,
  type StageBreakdown,
  type StageId,
} from "@/lib/flow";
import { cn } from "@/lib/utils";
import { barLabel, efficiencySentence } from "../stage-text";

/** Each status's colour in the bars and the legend (theme tokens, solid). */
export const STAGE_SWATCH: Record<StageId, string> = {
  backlog: "bg-sub",
  todo: "bg-sub",
  ready: "bg-info",
  in_progress: "bg-accent",
  review: "bg-accent-amber",
  done: "bg-accent-green",
};

/** Bars shown before "Show all". */
export const BARS_SHOWN = 10;

const FINISHED = ["finished item", "finished items"] as const;

/**
 * Time in each status: where finished work spent the time between its
 * start and Done, per status (median, P85 and share) and per item (a
 * stacked bar, newest first), with the flow efficiency once the person has
 * marked which statuses are waiting ones. Read from the boards' recorded
 * moves only (lib/flow stageBreakdown); typed items have no statuses.
 */
export function StageSection({
  breakdown,
  onToggleWaiting,
  typedLeftOut,
}: {
  breakdown: StageBreakdown;
  onToggleWaiting: (stage: StageId) => void;
  /** Finished typed items in the rows shown, which have no statuses to read. */
  typedLeftOut: number;
}) {
  const id = useId();
  const [all, setAll] = useState(false);
  const b = breakdown;
  const newest = [...b.items].reverse();
  const shown = all ? newest : newest.slice(0, BARS_SHOWN);
  const longest = Math.max(0, ...shown.map((i) => i.elapsedDays));
  const waiting = new Set<string>(b.waiting);
  const sentence = stageSentence(b);
  const efficiency = efficiencySentence(b);
  const notes = [
    b.approximate > 0
      ? `${b.approximate} finished ${b.approximate === 1 ? "item has" : "items have"} no recorded moves (from before the boards kept each one), so ${
          b.approximate === 1 ? "it is" : "they are"
        } left out here.`
      : null,
    typedLeftOut > 0
      ? `Typed items have no statuses, so ${typedLeftOut === 1 ? "the typed one is" : `the ${typedLeftOut} typed ones are`} left out here.`
      : null,
  ].filter((n): n is string => n !== null);

  return (
    <SectionCard title="Time in each status" icon={Layers} contentClassName="space-y-4">
      {b.items.length === 0 ? (
        <p className="text-sm text-sub">
          No finished story or card has its moves recorded yet. Work moved across the Sprint or Flow
          board from now on shows here, with the time it spent in each status.
        </p>
      ) : (
        <>
          <p className="text-xs text-sub">
            From the start of work to done, in elapsed time between the board&apos;s moves, so a
            same-day item adds up to less than a day.
          </p>
          {sentence && <p className="text-sm font-medium text-text">{sentence}</p>}

          <div className="relative overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <caption className="sr-only">Time in each status, over the finished items</caption>
              <thead>
                <tr className="border-b border-border bg-surface-deep text-xs uppercase tracking-wider text-sub">
                  <th scope="col" className="px-3 py-2.5 text-left font-medium">
                    Status
                  </th>
                  <th
                    scope="col"
                    className="hidden px-3 py-2.5 text-right font-medium sm:table-cell"
                  >
                    Items
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">
                    Median
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">
                    P85
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">
                    Share
                  </th>
                </tr>
              </thead>
              <tbody>
                {b.stages.map((s) => (
                  <tr key={s.stage} className="border-b border-border last:border-0">
                    <th scope="row" className="px-3 py-2.5 text-left font-normal text-text">
                      <span className="flex items-center gap-2">
                        <span
                          className={cn("h-2.5 w-2.5 shrink-0 rounded-sm", STAGE_SWATCH[s.stage])}
                          aria-hidden="true"
                        />
                        <span className="min-w-0">
                          {s.label}
                          {s.waiting && <span className="text-xs text-sub"> (waiting)</span>}
                        </span>
                      </span>
                    </th>
                    <td className="hidden px-3 py-2.5 text-right font-data text-sub sm:table-cell">
                      {s.items}
                    </td>
                    <td className="px-3 py-2.5 text-right font-data text-text">
                      {stageDuration(s.median)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-data text-text">
                      {stageDuration(s.p85)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-data text-text">
                      {s.share === null ? "—" : `${Math.round(s.share)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <NotEnoughData
            have={b.items.length}
            need="distribution"
            unit={FINISHED}
            action="Finish"
            what="each status's median and 85th percentile"
          />

          <div className="space-y-2">
            <p id={`${id}-waiting`} className="text-xs font-medium text-sub">
              Statuses where work waits
            </p>
            <div role="group" aria-labelledby={`${id}-waiting`} className="flex flex-wrap gap-1">
              {b.stages.map((s) => (
                <Button
                  key={s.stage}
                  type="button"
                  size="sm"
                  variant={s.waiting ? "default" : "outline"}
                  aria-pressed={s.waiting}
                  onClick={() => onToggleWaiting(s.stage)}
                >
                  {s.label}
                </Button>
              ))}
            </div>
            {efficiency ? (
              <p className="text-sm text-text" aria-live="polite">
                {efficiency}
              </p>
            ) : (
              <NotEnoughData
                have={b.items.length}
                need="average"
                unit={FINISHED}
                action="Finish"
                what="a flow efficiency"
              />
            )}
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-text">Each item, newest first</h3>
            <ul aria-label="Statuses in the bars" className="flex flex-wrap gap-x-3 gap-y-1">
              {b.stages.map((s) => (
                <li key={s.stage} className="flex items-center gap-1.5 text-xs text-sub">
                  <span
                    className={cn("h-2.5 w-2.5 rounded-sm", STAGE_SWATCH[s.stage])}
                    aria-hidden="true"
                  />
                  {s.label}
                  {s.waiting ? " (waiting)" : ""}
                </li>
              ))}
            </ul>
            <ul aria-label="Time in each status, by item" className="space-y-2.5">
              {shown.map((item) => {
                const eff = itemEfficiency(item, waiting);
                const width = longest > 0 ? Math.max(2, (item.elapsedDays / longest) * 100) : 100;
                return (
                  <li key={`${item.kind}:${item.id}`} className="min-w-0">
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate text-text">{item.title}</span>
                      <span className="shrink-0 font-data text-xs text-sub">
                        {stageDuration(item.elapsedDays)}
                        {b.efficiency.reason === "ok" && eff !== null
                          ? ` · ${Math.round(eff)}% active`
                          : ""}
                      </span>
                    </div>
                    <div className="mt-1 h-3 w-full rounded-full bg-surface-deep">
                      <div
                        role="img"
                        aria-label={barLabel(item)}
                        className="flex h-3 overflow-hidden rounded-full"
                        style={{ width: `${width}%` }}
                      >
                        {item.stages.map((s) => (
                          <span
                            key={s.stage}
                            className={cn("h-full", STAGE_SWATCH[s.stage])}
                            style={{
                              width: `${item.elapsedDays > 0 ? (s.days / item.elapsedDays) * 100 : 100 / item.stages.length}%`,
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            {newest.length > BARS_SHOWN && (
              <Button type="button" size="sm" variant="ghost" onClick={() => setAll((v) => !v)}>
                {all ? "Show the latest 10" : `Show all ${newest.length}`}
              </Button>
            )}
          </div>
        </>
      )}
      {notes.map((n) => (
        <p key={n} className="text-xs text-sub">
          {n}
        </p>
      ))}
    </SectionCard>
  );
}
