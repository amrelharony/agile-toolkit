"use client";

/**
 * Where one Shape Up pitch stands on the betting table, and the controls to
 * move it: a status select (on the table, bet, not this time, shipped, cut)
 * and "Place in a cycle" (a known cycle, whose dates it takes, or a new one
 * with its start and weeks). Once its cycle has ended, the circuit breaker
 * offers Ship, Cut and Reshape (back on the table, its cycle cleared), each
 * with Undo. The pitch's own panel and every betting table row use these.
 *
 * Every move goes through bets.ts's `placeBet`, which checks it against
 * the other bets in the cycle; a refusal shows inline.
 */

import { useState } from "react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PRODUCT_CANVAS_ACTIONS } from "@/lib/history/event-actions";
import {
  CIRCUIT_BREAKER,
  circuitBreaker,
  cycles,
  nextCycleNumber,
  placeBet,
  type BetInput,
} from "@/lib/product-canvas/bets";
import {
  BET_STATUS_LABEL,
  CYCLE_MAX,
  DEFAULT_CYCLE_WEEKS,
  WEEKS_MAX,
  betStatusOf,
  cycleEnd,
  cycleName,
} from "@/lib/product-canvas/fields";
import {
  PRODUCT_BET_STATUSES,
  type ProductBetStatus,
  type ProductCanvas,
} from "@/lib/stores/workspace-types";
import { todayIso } from "@/lib/sprints/series";
import { undoable } from "@/lib/utils/undoable";
import { shortText } from "../boxes";
import { SELECT_CLASS } from "../select-class";

/** How the betting table writes: one world's pitches (the team's, or the example's). */
export interface BetWriter {
  /** The canvases of this world as the store holds them now. */
  world: () => ProductCanvas[];
  /** Save rows as they are (a move, a cycle's dates, an Undo). */
  put: (rows: readonly ProductCanvas[]) => void;
  /** Log a change to `canvasId` (nothing for the example). */
  log: (canvasId: string, action: string, payload?: Record<string, unknown>) => void;
}

/**
 * Move a pitch on the betting table through `placeBet`; with `undo`, as an
 * undoable change with that label. Logs `bet_placed` when it is bet on a
 * cycle (a new bet, or another cycle), and the move otherwise. Returns why
 * it was refused, or null.
 */
export function placePitch(
  writer: BetWriter,
  pitchId: string,
  input: BetInput,
  opts: { undo?: string } = {}
): string | null {
  const all = writer.world();
  const pitch = all.find((c) => c.id === pitchId);
  if (!pitch) return "This pitch isn't here any more.";
  const w = placeBet(pitch, all, input, new Date().toISOString());
  if (!w.ok) return w.message;
  const next = w.canvas;
  const logIt = () => {
    const bet = next.bet;
    if (bet?.status === "bet" && (pitch.bet?.status !== "bet" || pitch.bet.cycle !== bet.cycle)) {
      writer.log(pitch.id, PRODUCT_CANVAS_ACTIONS.BET_PLACED, {
        canvasId: pitch.id,
        cycle: bet.cycle,
        weeks: bet.weeks,
      });
    } else {
      writer.log(pitch.id, PRODUCT_CANVAS_ACTIONS.CANVAS_UPDATED, {
        canvasId: pitch.id,
        field: "bet",
        status: bet?.status ?? "table",
      });
    }
  };
  if (opts.undo) {
    undoable({
      label: opts.undo,
      apply: () => {
        writer.put([next]);
        logIt();
      },
      revert: () => writer.put([pitch]),
    });
  } else {
    writer.put([next]);
    logIt();
  }
  return null;
}

/** The pitch's place as a line: "Bet in Cycle 4, 2026-10-05 to 2026-11-15". */
export function betSummary(pitch: ProductCanvas): string {
  const bet = pitch.bet;
  const status = betStatusOf(pitch);
  if (!bet || status === "table") return BET_STATUS_LABEL.table;
  const end = cycleEnd(bet.start, bet.weeks);
  const cycle =
    bet.cycle !== undefined
      ? ` in ${cycleName(bet.cycle)}${bet.start && end ? `, ${bet.start} to ${end}` : ""}`
      : "";
  return `${BET_STATUS_LABEL[status]}${cycle}`;
}

const NEW = "new";

/** Place in a cycle: a known one (its dates come with it) or a new one. */
function CycleForm({
  pitch,
  world,
  onPlace,
  onCancel,
}: {
  pitch: ProductCanvas;
  world: () => ProductCanvas[];
  onPlace: (input: BetInput) => string | null;
  onCancel: () => void;
}) {
  const all = world();
  const known = cycles(all.filter((c) => c.id !== pitch.id)).filter((c) => c.start && c.weeks);
  const [choice, setChoice] = useState<string>(known[0] ? String(known[0].number) : NEW);
  const [number, setNumber] = useState(String(nextCycleNumber(all)));
  const [start, setStart] = useState(todayIso());
  const [weeks, setWeeks] = useState(String(DEFAULT_CYCLE_WEEKS));
  const [problem, setProblem] = useState<string | null>(null);

  const submit = () => {
    const input: BetInput =
      choice === NEW
        ? {
            status: "bet",
            cycle: Number(number),
            start: start.trim(),
            weeks: Number(weeks),
          }
        : { status: "bet", cycle: Number(choice) };
    const refused = onPlace(input);
    setProblem(refused);
  };

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <Field label="Cycle">
        {(props) => (
          <select
            {...props}
            className={SELECT_CLASS}
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
          >
            {known.map((c) => (
              <option key={c.number} value={String(c.number)}>
                {c.name}: {c.start} to {c.end}
              </option>
            ))}
            <option value={NEW}>A new cycle</option>
          </select>
        )}
      </Field>
      {choice === NEW && (
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="Number" hint={`1 to ${CYCLE_MAX}`}>
            {(props) => (
              <Input
                {...props}
                type="number"
                inputMode="numeric"
                min={1}
                max={CYCLE_MAX}
                value={number}
                onChange={(e) => setNumber(e.target.value)}
              />
            )}
          </Field>
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
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="toolkit" onClick={submit}>
          Place the bet
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {problem && (
        <p role="alert" className="text-sm text-danger">
          {problem}
        </p>
      )}
    </div>
  );
}

export function BetControls({ pitch, writer }: { pitch: ProductCanvas; writer: BetWriter }) {
  const [placing, setPlacing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const status = betStatusOf(pitch);
  const breaker = circuitBreaker(pitch, todayIso());
  const name = shortText(pitch.title, 40);

  const move = (input: BetInput, undo?: string) => {
    const refused = placePitch(writer, pitch.id, input, undo ? { undo } : {});
    setProblem(refused);
    return refused;
  };

  const onStatus = (next: ProductBetStatus) => {
    if (next === status) return;
    // A bet needs its cycle: pick one first, unless the pitch has one already.
    if (next === "bet" && pitch.bet?.cycle === undefined) {
      setPlacing(true);
      return;
    }
    move({ status: next });
  };

  return (
    <div className="space-y-2">
      <p className="text-sm text-text" data-field="bet-summary">
        {betSummary(pitch)}
      </p>
      {breaker.due && (
        <div className="space-y-2 rounded-md border border-border p-2">
          <p role="status" className="text-sm text-warning">
            {pitch.bet?.cycle !== undefined ? cycleName(pitch.bet.cycle) : "Its cycle"} ended on{" "}
            {breaker.end}. {CIRCUIT_BREAKER}
          </p>
          <div role="group" aria-label={`Out of time: ${name}`} className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="toolkit"
              onClick={() => move({ status: "shipped" }, `Shipped “${name}”`)}
            >
              Ship what’s done
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => move({ status: "cut" }, `Cut “${name}”`)}
            >
              Cut it
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => move({ status: "table" }, `“${name}” is back on the table to reshape`)}
            >
              Reshape it
            </Button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Where it stands" className="min-w-0 flex-1 basis-40">
          {(props) => (
            <select
              {...props}
              className={SELECT_CLASS}
              value={status}
              onChange={(e) => onStatus(e.target.value as ProductBetStatus)}
            >
              {PRODUCT_BET_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {BET_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          )}
        </Field>
        {!placing && (
          <Button type="button" size="sm" variant="outline" onClick={() => setPlacing(true)}>
            {status === "bet" ? "Move to another cycle" : "Place in a cycle"}
          </Button>
        )}
      </div>
      {placing && (
        <CycleForm
          pitch={pitch}
          world={writer.world}
          onPlace={(input) => {
            const refused = move(input);
            if (!refused) setPlacing(false);
            return refused;
          }}
          onCancel={() => setPlacing(false)}
        />
      )}
      {problem && !placing && (
        <p role="alert" className="text-sm text-danger">
          {problem}
        </p>
      )}
    </div>
  );
}
