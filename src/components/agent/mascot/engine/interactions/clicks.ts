/**
 * Mascot taps (docs/mascot/AMR-ART-BRIEF.md, S04): a tap on his tummy is a poke
 * (he giggles), a tap on his head a pat (he leans into it, toward that side);
 * three taps in quick succession tickle him, seven make him dizzy. Taps earn no
 * XP: XP rewards finished work, not input. Each tap answers at once instead of queuing behind the last,
 * so a burst never backs up. Ported from the vanilla mascot's multi-click
 * escalation (handleMascotInteraction 3564-3581); the chat toggle is the caller's.
 */

import type { MascotReaction } from "@/lib/agent/mascot/store";

export type Zone = "head" | "body";
export type Side = "left" | "right";

export interface ClickHooks {
  /** Cut in with this reaction now. */
  playNow(r: MascotReaction): void;
  sound(): void;
}

/** Taps further apart than this start a new count. */
const BURST_MS = 1000;
export const TICKLE_TAPS = 3;
export const DIZZY_TAPS = 7;

export interface ClickInteraction {
  onClick(zone?: Zone, side?: Side): void;
  dispose(): void;
}

export function createClickInteraction(hooks: ClickHooks): ClickInteraction {
  let count = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function onClick(zone: Zone = "body", side: Side = "left"): void {
    count++;
    clearTimeout(timer);
    timer = setTimeout(() => {
      count = 0;
    }, BURST_MS);

    hooks.sound();

    if (count >= DIZZY_TAPS) {
      hooks.playNow("dizzy");
      count = 0;
    } else if (count === TICKLE_TAPS) {
      hooks.playNow("tickle");
    } else if (count === 1) {
      hooks.playNow(zone === "head" ? (side === "left" ? "patLeft" : "patRight") : "poke");
    }
    // Taps 2 and 4–6 let the reaction already playing carry on.
  }

  return { onClick, dispose: () => clearTimeout(timer) };
}
