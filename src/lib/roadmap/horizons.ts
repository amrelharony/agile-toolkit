/**
 * The Epic Roadmap's Now, Next, Later view: which horizon an epic sits on.
 *
 * An epic still has quarters (the timeline needs them, and so does every
 * way in: the add form, add_epic and the "epic" hand-off). Its horizon is
 * read from them unless someone moves it by hand (`Epic.horizon`):
 *   1. done (its roll-up says so) → Done, even when set by hand;
 *   2. set by hand → that horizon;
 *   3. no valid quarters → Later;
 *   4. its start quarter has come (under way, ending or past its end) → Now;
 *   5. it starts within the next NEXT_WINDOW_QUARTERS quarters → Next;
 *   6. later than that → Later.
 *
 * Every function takes `now`, so nothing depends on today's date. It takes
 * the epic and whether it is done, never the page's view. Pure and
 * server-safe: the page, the Markdown, tool.epic_roadmap and the next step
 * read it.
 */

import { EPIC_HORIZONS, type Epic, type EpicHorizon } from "@/lib/stores/workspace-types";
import { currentQuarterIndex, quarterIndex } from "./quarters";
import { epicSchedule } from "./rollup";

/** A column of the board. */
export type HorizonColumn = EpicHorizon | "done";

/** Where an epic's place came from. */
export type HorizonFrom = "done" | "set" | "quarters" | "none";

export const HORIZON_LABEL: Record<HorizonColumn, string> = {
  now: "Now",
  next: "Next",
  later: "Later",
  done: "Done",
};

/** "Next" holds what starts within this many quarters after the current one. */
export const NEXT_WINDOW_QUARTERS = 2;
/** From this many epics in Now, the board suggests finishing before starting. */
export const NOW_CROWDED = 4;

/** What the horizon reads: an epic's quarters and hand-set horizon, and whether it is done. */
export interface HorizonItem {
  epic: Pick<Epic, "horizon" | "startQuarter" | "endQuarter">;
  done: boolean;
}

export const isEpicHorizon = (v: unknown): v is EpicHorizon =>
  typeof v === "string" && (EPIC_HORIZONS as readonly string[]).includes(v);

/** The horizon the epic's quarters give (steps 3–6), ignoring a hand-set one. */
export function quartersHorizon(
  epic: Pick<Epic, "startQuarter" | "endQuarter">,
  now: Date = new Date()
): { horizon: EpicHorizon; from: "quarters" | "none" } {
  const schedule = epicSchedule(epic, false, now);
  if (schedule === "unscheduled") return { horizon: "later", from: "none" };
  if (schedule !== "upcoming") return { horizon: "now", from: "quarters" };
  const ahead = quarterIndex(epic.startQuarter) - currentQuarterIndex(now);
  return { horizon: ahead <= NEXT_WINDOW_QUARTERS ? "next" : "later", from: "quarters" };
}

/** Where the epic sits on the board, and why. */
export function horizonOf(
  item: HorizonItem,
  now: Date = new Date()
): { horizon: HorizonColumn; from: HorizonFrom } {
  if (item.done) return { horizon: "done", from: "done" };
  if (isEpicHorizon(item.epic.horizon)) return { horizon: item.epic.horizon, from: "set" };
  return quartersHorizon(item.epic, now);
}

/** The items by column, each column in the order given (the board passes them sorted by start). */
export function horizonColumns<T extends HorizonItem>(
  items: readonly T[],
  now: Date = new Date()
): Record<HorizonColumn, T[]> {
  const out: Record<HorizonColumn, T[]> = { now: [], next: [], later: [], done: [] };
  for (const item of items) out[horizonOf(item, now).horizon].push(item);
  return out;
}

/**
 * For an epic moved by hand whose quarters say otherwise: "Its quarters
 * put it in Later." Null when they agree, when it isn't set by hand or
 * done, or when it has no valid quarters to go by.
 */
export function horizonMismatch(item: HorizonItem, now: Date = new Date()): string | null {
  const place = horizonOf(item, now);
  if (place.from !== "set") return null;
  const fromQuarters = quartersHorizon(item.epic, now);
  if (fromQuarters.from === "none" || fromQuarters.horizon === place.horizon) return null;
  return `Its quarters put it in ${HORIZON_LABEL[fromQuarters.horizon]}.`;
}

/** The epic with its horizon set by hand, or back to its quarters (`null`). Quarters never change. */
export function withHorizon<E extends Pick<Epic, "horizon">>(
  epic: E,
  horizon: EpicHorizon | null
): E {
  const next = { ...epic };
  if (horizon) next.horizon = horizon;
  else delete next.horizon;
  return next;
}
