/**
 * Which boards run as an Emotional Seismograph, and what a card's day is: on
 * their own so that the Retro helpers and the share import (which Retro
 * Actions, Kudos and other pages load) can carry a card's day without the
 * seismograph's days, chart and mood rules in `seismograph.ts`, which
 * re-exports all of these.
 *
 * Pure: no store, no React.
 */

import type { BoardState } from "@/app/(tools)/retro/types";
import { RETRO_CARD_DAY_MAX } from "@/lib/stores/workspace-types";

export const SEISMOGRAPH_FORMAT_ID = "seismograph";

/** The three bands, the format's column keys, high to low. */
export const SEISMOGRAPH_BANDS = ["highs", "steady", "lows"] as const;
export type SeismographBand = (typeof SEISMOGRAPH_BANDS)[number];

/** Whether a board runs as an Emotional Seismograph: its format, with the three columns. */
export function isSeismograph(board: Pick<BoardState, "format"> | null | undefined): boolean {
  if (!board || board.format?.id !== SEISMOGRAPH_FORMAT_ID) return false;
  const keys = new Set((board.format.columns ?? []).map((c) => c.key));
  return SEISMOGRAPH_BANDS.every((k) => keys.has(k));
}

/** Whether `v` is a card's day: a whole number from 0 to RETRO_CARD_DAY_MAX. */
export function isCardDay(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= RETRO_CARD_DAY_MAX;
}
