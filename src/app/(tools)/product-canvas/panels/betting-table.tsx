"use client";

/**
 * The betting table: every Shape Up pitch of one world (the team's, or the
 * example's), in four columns (on the table, bet, not this time, done),
 * each with its status select and "Place in a cycle"; then the cycles, each
 * with its dates, which "Change dates" rewrites for every bet in it with
 * one Undo. A straw poll in Quick Vote over the pitches on the table numbers
 * each one, and the numbers show here beside their titles.
 *
 * Phone first: the columns stack as lists until the screen is wide.
 */

import { useState } from "react";
import Link from "next/link";
import { Vote } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PRODUCT_CANVAS_ACTIONS } from "@/lib/history/event-actions";
import {
  BET_COLUMNS,
  BET_COLUMN_LABEL,
  bettingTable,
  cycles,
  withCycleDates,
  type Cycle,
} from "@/lib/product-canvas/bets";
import { WEEKS_MAX } from "@/lib/product-canvas/fields";
import { canvasPoll } from "@/lib/product-canvas/poll";
import type { ProductCanvas } from "@/lib/stores/workspace-types";
import { undoable } from "@/lib/utils/undoable";
import { BetControls, type BetWriter } from "./bet-controls";

const weeksText = (n: number) => `${n} ${n === 1 ? "week" : "weeks"}`;

/** A cycle's dates, changed for every bet in it. */
function CycleDates({ cycle, writer }: { cycle: Cycle; writer: BetWriter }) {
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState(cycle.start ?? "");
  const [weeks, setWeeks] = useState(String(cycle.weeks ?? ""));
  const [problem, setProblem] = useState<string | null>(null);

  const save = () => {
    const all = writer.world();
    const r = withCycleDates(
      all,
      cycle.number,
      { start: start.trim(), weeks: Number(weeks) },
      new Date().toISOString()
    );
    if (!r.ok) {
      setProblem(r.message);
      return;
    }
    setProblem(null);
    const saved = r.canvases.flatMap((c) => all.find((x) => x.id === c.id) ?? []);
    undoable({
      label: `Changed ${cycle.name}'s dates`,
      apply: () => {
        writer.put(r.canvases);
        const first = r.canvases[0];
        if (first) {
          writer.log(first.id, PRODUCT_CANVAS_ACTIONS.CANVAS_UPDATED, {
            field: "cycle",
            cycle: cycle.number,
            count: r.canvases.length,
          });
        }
      },
      revert: () => writer.put(saved),
    });
    setEditing(false);
  };

  return (
    <li className="space-y-2 rounded-md border border-border p-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm text-text">
          <span className="font-medium">{cycle.name}</span>
          {cycle.start && cycle.end && cycle.weeks
            ? `: ${cycle.start} to ${cycle.end}, ${weeksText(cycle.weeks)}`
            : ": no dates yet"}
          {" · "}
          {cycle.bets.length} {cycle.bets.length === 1 ? "pitch" : "pitches"}
        </p>
        {!editing && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={`Change ${cycle.name}'s dates`}
            onClick={() => {
              setStart(cycle.start ?? "");
              setWeeks(String(cycle.weeks ?? ""));
              setEditing(true);
            }}
          >
            Change dates
          </Button>
        )}
      </div>
      {editing && (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Starts on">
              {(props) => (
                <Input
                  {...props}
                  type="date"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              )}
            </Field>
            <Field label="Weeks" hint={`1 to ${WEEKS_MAX}`}>
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={WEEKS_MAX}
                  value={weeks}
                  onChange={(e) => setWeeks(e.target.value)}
                />
              )}
            </Field>
          </div>
          <p className="text-xs text-sub">Every pitch bet on {cycle.name} takes the new dates.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="toolkit" onClick={save}>
              Save the dates
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {problem && (
        <p role="alert" className="text-sm text-danger">
          {problem}
        </p>
      )}
    </li>
  );
}

export function BettingTable({
  pitches,
  writer,
  onOpen,
  example,
}: {
  /** One world's canvases (its pitches are read from them). */
  pitches: readonly ProductCanvas[];
  writer: BetWriter;
  onOpen: (id: string) => void;
  /** The example's table: said so above it. */
  example?: boolean;
}) {
  const table = bettingTable(pitches);
  const cycleList = cycles(pitches);
  const onTable = table.table;
  const poll = canvasPoll(
    "Which pitch should we bet on?",
    onTable.map((c) => ({ id: c.id, title: c.title }))
  );

  return (
    <SectionCard title="Betting table" contentClassName="space-y-4">
      <p className="text-sm text-sub">
        Bet on the pitches worth a cycle. A bet doesn’t roll over: when its cycle ends, ship what’s
        done or cut it.
        {example && " This is the example’s table."}
      </p>
      {onTable.length >= 2 && (
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="outline" className="gap-1.5">
            <Link href={poll.href}>
              <Vote aria-hidden="true" />
              Straw poll in Quick Vote
            </Link>
          </Button>
          <p className="text-xs text-sub">
            Each pitch is a numbered option; the numbers show beside the titles below.
            {poll.left > 0 && ` ${poll.left} more aren’t in the poll.`}
          </p>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {BET_COLUMNS.map((col) => {
          const list = table[col];
          const headingId = `pc-bets-${col}`;
          return (
            <section key={col} aria-labelledby={headingId} className="space-y-2">
              <h3 id={headingId} className="font-display text-base text-text">
                {BET_COLUMN_LABEL[col]}{" "}
                <span className="font-mono text-xs text-sub">{list.length}</span>
              </h3>
              {list.length === 0 ? (
                <p className="text-xs text-sub">None.</p>
              ) : (
                <ul className="space-y-2">
                  {list.map((c) => {
                    const key = col === "table" ? poll.keys.get(c.id) : undefined;
                    return (
                      <li key={c.id} className="space-y-2 rounded-md border border-border p-2">
                        <div className="flex flex-wrap items-baseline gap-2">
                          {key && (
                            <span
                              className="font-mono text-xs text-sub"
                              aria-label={`Poll option ${key}`}
                            >
                              {key}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => onOpen(c.id)}
                            className="min-w-0 break-words text-left text-sm font-medium text-text underline-offset-2 hover:underline"
                          >
                            {c.title}
                          </button>
                          {c.appetiteWeeks !== undefined && (
                            <span className="text-xs text-sub">{weeksText(c.appetiteWeeks)}</span>
                          )}
                        </div>
                        <BetControls pitch={c} writer={writer} />
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      {cycleList.length > 0 && (
        <section aria-labelledby="pc-bets-cycles" className="space-y-2">
          <h3 id="pc-bets-cycles" className="font-display text-base text-text">
            Cycles
          </h3>
          <ul className="space-y-2">
            {cycleList.map((cy) => (
              <CycleDates key={cy.number} cycle={cy} writer={writer} />
            ))}
          </ul>
        </section>
      )}
    </SectionCard>
  );
}
