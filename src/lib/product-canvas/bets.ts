/**
 * The betting table: Shape Up pitches by where they stand (on the table,
 * bet on a cycle, not this time, done) and the cycles they're bet on.
 *
 * A cycle is a number ("Cycle 4": the entity's `bet.cycle`, 1 to 60). Its
 * start and weeks come from its earliest-decided bet, so every bet placed
 * in a known cycle takes them (a bet that disagrees is refused), and
 * editing a cycle's dates rewrites every bet in it. There is no cool-down,
 * and a bet doesn't roll over: once its cycle ends, the circuit breaker
 * asks to ship what's done, cut it, or reshape it (back on the table, its
 * cycle cleared).
 *
 * Pure and server-safe: no zod, no React, no store, no "use client" import.
 */

import { isIsoDay } from "@/lib/product-goal/model";
import type {
  ProductBetStatus,
  ProductCanvas,
  ProductPitchBet,
} from "@/lib/stores/workspace-types";
import type { Validation } from "@/lib/utils/form";
import {
  CYCLE_MAX,
  DEFAULT_CYCLE_WEEKS,
  WEEKS_MAX,
  betStatusOf,
  cycleEnd,
  cycleName,
  isOutOfTime,
  readWeeks,
} from "./fields";
import { finishAll, withBet, type CanvasRefused, type CanvasWrite } from "./model";

/** What the circuit breaker says about a bet past its cycle. */
export const CIRCUIT_BREAKER =
  "Out of time: ship what's done or cut it. Bets don't roll over by default.";

/** The betting table's columns, in order. */
export const BET_COLUMNS = ["table", "bet", "passed", "done"] as const;
export type BetColumn = (typeof BET_COLUMNS)[number];

export const BET_COLUMN_LABEL: Record<BetColumn, string> = {
  table: "On the table",
  bet: "Bet",
  passed: "Not this time",
  done: "Done",
};

/** The Shape Up pitches among `canvases`. */
export const pitchesOf = (canvases: readonly ProductCanvas[]): ProductCanvas[] =>
  canvases.filter((c) => c.format === "shape-up");

/** A pitch's column: no bet or on the table, bet, passed, shipped or cut. */
export function betColumn(c: ProductCanvas): BetColumn {
  const s = betStatusOf(c);
  return s === "shipped" || s === "cut" ? "done" : s;
}

/** Every pitch by column, newest change first in each. */
export function bettingTable(
  canvases: readonly ProductCanvas[]
): Record<BetColumn, ProductCanvas[]> {
  const out: Record<BetColumn, ProductCanvas[]> = { table: [], bet: [], passed: [], done: [] };
  for (const c of pitchesOf(canvases)) out[betColumn(c)].push(c);
  for (const col of BET_COLUMNS) {
    out[col].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  }
  return out;
}

/** A cycle and the pitches bet on it. */
export interface Cycle {
  number: number;
  name: string;
  /** From its earliest-decided bet with dates. */
  start?: string;
  weeks?: number;
  /** Its last day: start + weeks × 7 − 1. */
  end?: string;
  /** Its pitches, earliest decided first. */
  bets: ProductCanvas[];
}

const decidedAt = (c: ProductCanvas) => c.bet?.decidedAt ?? c.updatedAt;

/**
 * The cycles pitches are bet on (any status but the table), newest number
 * first. Each takes its start and weeks from its earliest-decided bet that
 * has both.
 */
export function cycles(canvases: readonly ProductCanvas[]): Cycle[] {
  const byNumber = new Map<number, ProductCanvas[]>();
  for (const c of pitchesOf(canvases)) {
    const n = c.bet?.cycle;
    if (n === undefined || betStatusOf(c) === "table") continue;
    byNumber.set(n, [...(byNumber.get(n) ?? []), c]);
  }
  return Array.from(byNumber.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([number, list]) => {
      const bets = [...list].sort(
        (a, b) => decidedAt(a).localeCompare(decidedAt(b)) || a.id.localeCompare(b.id)
      );
      const dated = bets.find((c) => cycleEnd(c.bet?.start, c.bet?.weeks));
      const cycle: Cycle = { number, name: cycleName(number), bets };
      if (dated?.bet?.start && dated.bet.weeks) {
        cycle.start = dated.bet.start;
        cycle.weeks = dated.bet.weeks;
        cycle.end = cycleEnd(dated.bet.start, dated.bet.weeks) ?? undefined;
      }
      return cycle;
    });
}

/** A cycle by number, without `exceptId`'s bet (the pitch being placed). */
export function cycleOf(
  canvases: readonly ProductCanvas[],
  number: number,
  exceptId?: string
): Cycle | undefined {
  return cycles(canvases.filter((c) => c.id !== exceptId)).find((c) => c.number === number);
}

/** The number a new cycle gets: one past the highest, CYCLE_MAX at most. */
export function nextCycleNumber(canvases: readonly ProductCanvas[]): number {
  const top = cycles(canvases).reduce((n, c) => Math.max(n, c.number), 0);
  return Math.min(CYCLE_MAX, top + 1);
}

/** Where a pitch goes on the betting table, as the page and Amr ask for it. */
export interface BetInput {
  status: ProductBetStatus;
  /** The cycle, for a bet (and kept for passed, shipped or cut when given). */
  cycle?: number;
  /** The cycle's start day; a known cycle's is taken when left out. */
  start?: string;
  /** The cycle's weeks; a known cycle's (or DEFAULT_CYCLE_WEEKS) when left out. */
  weeks?: number;
}

/**
 * A place on the betting table checked against the other pitches. A bet
 * needs a cycle (1 to CYCLE_MAX): in a known cycle it takes the cycle's
 * start and weeks when they are left out, and given ones must agree; a new
 * cycle needs its start day (a pitch alone in its cycle keeps its own),
 * and runs DEFAULT_CYCLE_WEEKS weeks unless told. Passed, shipped and cut
 * keep the pitch's cycle as it was unless one is given (checked the same
 * way); the table takes none.
 */
export function validateBet(
  input: BetInput,
  canvases: readonly ProductCanvas[],
  pitch: ProductCanvas
): Validation<ProductPitchBet, "cycle" | "start" | "weeks"> {
  const { status } = input;
  if (status === "table") return { ok: true, values: { status } };
  const given = input.cycle !== undefined || input.start !== undefined || input.weeks !== undefined;
  if (status !== "bet" && !given) {
    const keep: ProductPitchBet = { status };
    const was = pitch.bet;
    if (was?.cycle !== undefined) keep.cycle = was.cycle;
    if (was?.start) keep.start = was.start;
    if (was?.weeks) keep.weeks = was.weeks;
    return { ok: true, values: keep };
  }
  const number = input.cycle ?? (status !== "bet" ? pitch.bet?.cycle : undefined);
  if (number === undefined || !Number.isInteger(number) || number < 1 || number > CYCLE_MAX) {
    return {
      ok: false,
      errors: { cycle: `Pick a cycle: a whole number from 1 to ${CYCLE_MAX}.` },
    };
  }
  if (input.start !== undefined && !isIsoDay(input.start)) {
    return { ok: false, errors: { start: "Write the start as YYYY-MM-DD, such as 2027-01-04." } };
  }
  if (input.weeks !== undefined && readWeeks(input.weeks) === undefined) {
    return { ok: false, errors: { weeks: `A cycle runs 1 to ${WEEKS_MAX} whole weeks.` } };
  }
  const known = cycleOf(canvases, number, pitch.id);
  if (known?.start && known.weeks) {
    const start = input.start ?? known.start;
    const weeks = input.weeks ?? known.weeks;
    if (start !== known.start || weeks !== known.weeks) {
      return {
        ok: false,
        errors: {
          cycle: `${known.name} runs from ${known.start} for ${known.weeks} ${known.weeks === 1 ? "week" : "weeks"}. Leave the dates out to take them, change the cycle's dates for every bet in it, or pick another cycle.`,
        },
      };
    }
    return { ok: true, values: { status, cycle: number, start, weeks } };
  }
  // No other pitch is in this cycle: its dates are this pitch's own, or new.
  const own = pitch.bet?.cycle === number ? pitch.bet : undefined;
  const start = input.start ?? own?.start;
  if (!start) {
    return {
      ok: false,
      errors: { start: `${cycleName(number)} is new: say the day it starts.` },
    };
  }
  return {
    ok: true,
    values: {
      status,
      cycle: number,
      start,
      weeks: input.weeks ?? own?.weeks ?? DEFAULT_CYCLE_WEEKS,
    },
  };
}

/**
 * A pitch placed on the betting table (see `validateBet`), refused with the
 * check's sentence ("bad_bet") or the canvas model's (a field of another
 * format, a row too big to save).
 */
export function placeBet(
  pitch: ProductCanvas,
  canvases: readonly ProductCanvas[],
  input: BetInput,
  now: string
): CanvasWrite {
  if (pitch.format !== "shape-up") {
    return {
      ok: false,
      reason: "wrong_format",
      message: "Only a Shape Up pitch goes on the betting table.",
    };
  }
  const v = validateBet(input, canvases, pitch);
  if (!v.ok) {
    return {
      ok: false,
      reason: "bad_bet",
      message: v.errors.cycle ?? v.errors.start ?? v.errors.weeks ?? "",
    };
  }
  return withBet(pitch, v.values.status === "table" ? null : v.values, now);
}

/**
 * A cycle's dates changed: every pitch bet on it (any status but the table)
 * takes the new start and weeks, all or none. Refused for a cycle no pitch
 * is bet on, a start that isn't a day, or weeks out of 1 to WEEKS_MAX. The
 * caller writes them all, and its one Undo puts them all back.
 */
export function withCycleDates(
  canvases: readonly ProductCanvas[],
  number: number,
  dates: { start: string; weeks: number },
  now: string
): { ok: true; canvases: ProductCanvas[] } | CanvasRefused {
  const cycle = cycles(canvases).find((c) => c.number === number);
  if (!cycle) {
    return { ok: false, reason: "not_found", message: `No pitch is bet on ${cycleName(number)}.` };
  }
  if (!isIsoDay(dates.start)) {
    return {
      ok: false,
      reason: "bad_bet",
      message: "Write the start as YYYY-MM-DD, such as 2027-01-04.",
    };
  }
  if (readWeeks(dates.weeks) === undefined) {
    return { ok: false, reason: "bad_bet", message: `A cycle runs 1 to ${WEEKS_MAX} whole weeks.` };
  }
  return finishAll(
    cycle.bets.map((c) => ({
      ...c,
      bet: { ...(c.bet as ProductPitchBet), start: dates.start, weeks: dates.weeks },
    })),
    now
  );
}

/** The circuit breaker on one pitch: due when it is still bet on a cycle that has ended. */
export function circuitBreaker(
  pitch: ProductCanvas,
  today: string
): { due: false } | { due: true; end: string } {
  if (pitch.format !== "shape-up" || !isOutOfTime(pitch.bet, today)) return { due: false };
  const end = cycleEnd(pitch.bet?.start, pitch.bet?.weeks);
  return end ? { due: true, end } : { due: false };
}

/** The pitches whose circuit breaker is due, the longest overdue first. */
export function outOfTime(canvases: readonly ProductCanvas[], today: string): ProductCanvas[] {
  return pitchesOf(canvases)
    .flatMap((c) => {
      const b = circuitBreaker(c, today);
      return b.due ? [{ c, end: b.end }] : [];
    })
    .sort((a, b) => a.end.localeCompare(b.end) || a.c.id.localeCompare(b.c.id))
    .map((x) => x.c);
}
