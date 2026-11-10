/**
 * Retro visitor room: what a host's own screen shows while cards are hidden.
 *
 * During Write, with "Hide cards while writing" on, the host's screen (often
 * the one shared in the meeting) hides other people's cards the way the
 * participants' screens do: it shows its own and a count per column for the
 * rest. Pure, so the Board and the promoted host share it.
 */

import type { RetroCard } from "../types";

export interface HiddenView {
  /** The cards to draw: every card, or all but the hidden ones. */
  shown: RetroCard[];
  /** How many hidden cards each column holds, or null when nothing is hidden. */
  hiddenCounts: Record<string, number> | null;
}

/**
 * `cards` without the ones in `hiddenIds`, and a count per column of those
 * left out. A shown card grouped under a hidden one stands on its own, or
 * its column (which draws only top-level cards and their children) would
 * lose it. Null `hiddenIds` hides nothing.
 */
export function hideCards(
  cards: readonly RetroCard[],
  hiddenIds: ReadonlySet<string> | null
): HiddenView {
  if (!hiddenIds) return { shown: [...cards], hiddenCounts: null };
  const shown: RetroCard[] = [];
  const hiddenCounts: Record<string, number> = {};
  for (const c of cards) {
    if (hiddenIds.has(c.id)) {
      hiddenCounts[c.columnKey] =
        (Object.prototype.hasOwnProperty.call(hiddenCounts, c.columnKey)
          ? hiddenCounts[c.columnKey]
          : 0) + 1;
    } else {
      shown.push(
        c.groupedWith !== null && hiddenIds.has(c.groupedWith) ? { ...c, groupedWith: null } : c
      );
    }
  }
  return { shown, hiddenCounts };
}

/** Hidden cards in all, from `hiddenCounts`. */
export function hiddenTotal(hiddenCounts: Readonly<Record<string, number>> | null): number {
  if (!hiddenCounts) return 0;
  let total = 0;
  for (const n of Object.values(hiddenCounts)) total += n;
  return total;
}
