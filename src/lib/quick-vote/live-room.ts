/**
 * The live room the Quick Vote page hosts in this tab, if one is open: the
 * answers it shows results from, fixed when it opened (the vote kit's
 * rule). The page's Run it panel sets it from the kit's `onLiveChange`;
 * Amr's `start_round` reads it, so it can say truly whether that room asks
 * the new round next or the round needs a room of its own.
 *
 * Only this page's own room counts: a room another tool (or another tab)
 * has open never takes Quick Vote's rounds, so it changes nothing here.
 *
 * Pure and server-safe: on the server nothing sets it, so it stays null.
 */

import { presetById, type PresetId } from "./presets";
import { presetMinN } from "./draft";

let openRoom: { minN: number } | null = null;

/** The page's room opened (with its minN) or closed (null). */
export function setQuickVoteRoom(room: { minN: number } | null): void {
  openRoom = room ? { minN: room.minN } : null;
}

/** The room the page hosts now, or null. */
export function quickVoteRoom(): { minN: number } | null {
  return openRoom;
}

/**
 * Whether a room that shows results from `roomMinN` answers may ask a
 * round of `presetId`: never one that needs more answers than that.
 */
export function roomTakesFormat(roomMinN: number, presetId: PresetId): boolean {
  const preset = presetById(presetId);
  return preset ? presetMinN(preset) <= roomMinN : false;
}
