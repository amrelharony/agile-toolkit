/**
 * Follow-through per retro, as the chart, its text alternative and the
 * Markdown export read it. Pure: the counts come from
 * lib/retro/actions followThroughByRetro, the sprint names from the caller.
 */

import type { RetroFollowThrough } from "@/lib/retro/actions";
import { NO_VALUE, listAnd, type ChartText } from "@/lib/charts/chart-text";

/** Fewer rated retros than this and a "per retro" chart is one bar: the verdict says it better. */
export const CHART_MIN_RETROS = 2;

/** Above this many retros the summary gives the first and last rate instead of listing all. */
const LIST_RATES_UP_TO = 4;

/** Looks a sprint's name up by id (undefined when the board names none, or it's gone). */
export type SprintNameOf = (sprintId: string | undefined) => string | undefined;

/** Retros that agreed at least one action: the only ones with a rate. */
export function ratedRetros(rows: readonly RetroFollowThrough[]): RetroFollowThrough[] {
  return rows.filter((r) => r.agreed > 0);
}

/** "58%"; NO_VALUE when nothing was agreed. */
export function pct(rate: number | null): string {
  return rate === null ? NO_VALUE : `${Math.round(rate * 100)}%`;
}

/** The archive day, short ("5 Oct"), in the same style as the retro labels. */
function shortDay(iso: string | undefined): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "Retro";
  return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** The bar's name on the axis: the sprint it looked back on, else the day it was archived. */
export function retroShortName(row: RetroFollowThrough, sprintName: SprintNameOf): string {
  return sprintName(row.sprintId) ?? shortDay(row.archivedAt);
}

export interface FollowThroughPoint {
  name: string;
  done: number;
  carried: number;
  open: number;
  /** "75%", for the tooltip. */
  rate: string;
}

/** The chart's rows, oldest first. */
export function followThroughPoints(
  rows: readonly RetroFollowThrough[],
  sprintName: SprintNameOf
): FollowThroughPoint[] {
  return ratedRetros(rows).map((r) => ({
    name: retroShortName(r, sprintName),
    done: r.done,
    carried: r.carried,
    open: r.open,
    rate: pct(r.rate),
  }));
}

/** Done and agreed, summed. */
export function totals(rows: readonly RetroFollowThrough[]): { agreed: number; done: number } {
  return rows.reduce((t, r) => ({ agreed: t.agreed + r.agreed, done: t.done + r.done }), {
    agreed: 0,
    done: 0,
  });
}

/**
 * The summary and table behind the chart. The table has every rated retro,
 * oldest first, with what happened to its actions; the summary reads the
 * rates in order so a screen reader hears the shape of the bars.
 */
export function followThroughText(
  rows: readonly RetroFollowThrough[],
  sprintName: SprintNameOf
): ChartText {
  const rated = ratedRetros(rows);
  const table = {
    columns: ["Retro", "Sprint", "Agreed", "Done", "Carried over", "Open", "Follow-through"],
    rows: rated.map((r) => [
      r.retroLabel,
      sprintName(r.sprintId) ?? NO_VALUE,
      r.agreed,
      r.done,
      r.carried,
      r.open,
      pct(r.rate),
    ]),
    caption: "Follow-through per retro, oldest first",
  };
  if (rated.length === 0) {
    return { summary: "No past retro has agreed an action yet.", table };
  }
  const rates = rated.map((r) => pct(r.rate));
  const { agreed, done } = totals(rated);
  const shape =
    rated.length <= LIST_RATES_UP_TO
      ? `Share of each retro's actions done, oldest first: ${listAnd(rates)}.`
      : `Share of each retro's actions done, oldest first: from ${rates[0]} to ${rates[rates.length - 1]} across ${rated.length} retros.`;
  return {
    summary: `${shape} ${done} of ${agreed} ${agreed === 1 ? "action" : "actions"} done overall.`,
    table,
  };
}
