"use client";

import { useState } from "react";
import { Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MoodEntry, TeamMember } from "@/lib/stores/workspace-types";
import { MOOD_LABELS, checkInFor, isMoodScore } from "@/lib/team/mood";
import { faceOf } from "./faces";
import { shortDay } from "./verdict";

/**
 * Who checked in how, per day (named mode only): each cell is a button
 * that opens that person's day in the check-in card, so a missed day is
 * one click to fill in. "View as table" gives the same as text. Scrolls
 * sideways inside its own box on a phone.
 */
export function MoodHeatmap({
  members,
  entries,
  days,
  readOnly,
  onPick,
}: {
  members: readonly TeamMember[];
  entries: readonly MoodEntry[];
  days: readonly string[];
  readOnly: boolean;
  onPick: (memberId: string, day: string) => void;
}) {
  const [asTable, setAsTable] = useState(false);
  const label = (e: MoodEntry | undefined) =>
    !e
      ? "no check-in"
      : e.isPlaceholder || !isMoodScore(e.score)
        ? "note only"
        : MOOD_LABELS[e.score];
  return (
    <div className="space-y-3">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="gap-1.5"
        aria-expanded={asTable}
        onClick={() => setAsTable((t) => !t)}
      >
        <Table2 className="h-4 w-4" aria-hidden="true" />
        {asTable ? "Hide the table" : "View as table"}
      </Button>
      {/* relative: a containing block, so sr-only text can't widen the page. */}
      <div className="relative overflow-x-auto">
        {asTable ? (
          <table className="text-xs">
            <caption className="sr-only">Check-ins per person and day</caption>
            <thead>
              <tr>
                <th scope="col" className="py-1 pr-3 text-left font-medium text-sub">
                  Person
                </th>
                {days.map((d) => (
                  <th
                    key={d}
                    scope="col"
                    className="whitespace-nowrap px-1 py-1 font-medium text-sub"
                  >
                    {shortDay(d)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-t border-border">
                  <th scope="row" className="py-1 pr-3 text-left font-normal text-text">
                    {m.name}
                  </th>
                  {days.map((d) => (
                    <td key={d} className="px-1 py-1 text-center text-sub">
                      {label(checkInFor(entries, m.id, d)).replace("no check-in", "—")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div
            className="grid gap-1"
            style={{ gridTemplateColumns: `minmax(5rem, 8rem) repeat(${days.length}, 2rem)` }}
          >
            <div />
            {days.map((d) => (
              <div key={d} className="text-center font-data text-xs text-sub" aria-hidden="true">
                {d.slice(8)}
              </div>
            ))}
            {members.map((m) => (
              <div key={m.id} className="contents">
                <div className="truncate py-1 text-xs text-text">{m.name}</div>
                {days.map((d) => {
                  const e = checkInFor(entries, m.id, d);
                  const face = e && !e.isPlaceholder ? faceOf(e.score) : undefined;
                  return (
                    <button
                      key={d}
                      type="button"
                      disabled={readOnly}
                      onClick={() => onPick(m.id, d)}
                      aria-label={`${m.name}, ${shortDay(d)}: ${label(e)}`}
                      data-mood={face?.score ?? (e ? "note-only" : "none")}
                      className={cn(
                        "h-6 rounded border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                        face ? cn(face.bg, "border-transparent") : "border-border",
                        e?.isPlaceholder && "border-dashed"
                      )}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
