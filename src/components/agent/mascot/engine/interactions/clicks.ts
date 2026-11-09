/**
 * Mascot taps (docs/mascot/AMR-ART-BRIEF.md, S04): a tap on his tummy is a poke
 * (he giggles), a tap on his head a pat (he leans into it, toward that side);
 * three taps in quick succession tickle him, seven make him dizzy. Taps earn no
 * XP: XP rewards finished work, not input. Each tap answers at once instead of queuing behind the last,
 * so a burst never backs up. Ported from the vanilla mascot's multi-click
 * escalation (handleMascotInteraction 3564-3581); the chat toggle is the caller's.
 *
 * Being poked wears thin (lib/agent/mascot/brain/choose.ts): poke him again and
 * again within a minute and the giggle gives way to a shy look, then a shrug,
 * then he hides his eyes till he's left alone. A pat never wears thin.
 */

import type { MascotHold, MascotReaction } from "@/lib/agent/mascot/store";
import { HIDE_MS, POKE_MEMORY_MS, pokeAnswer } from "@/lib/agent/mascot/brain/choose";
import type { BrainEvent, Temperament } from "@/lib/agent/mascot/brain/state";

export type Zone = "head" | "body";
export type Side = "left" | "right";

export interface ClickHooks {
  /** Cut in with this reaction now. */
  playNow(r: MascotReaction): void;
  sound(): void;
  /** Hold a pose while something lasts (he hides his eyes when he's had enough). */
  hold?(h: MascotHold, on: boolean): void;
  /** His temperament now: a playful Amr has more patience. */
  temperament?(): Temperament;
  /** Tell his mind what happened to him. */
  feel?(event: BrainEvent): void;
  now?: () => number;
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
  const now = hooks.now ?? (() => Date.now());
  let count = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pokes: number[] = [];
  let hiding: ReturnType<typeof setTimeout> | undefined;

  const stopHiding = () => {
    if (hiding === undefined) return;
    clearTimeout(hiding);
    hiding = undefined;
    hooks.hold?.("peekHide", false);
  };

  function poke(): void {
    const t = now();
    pokes = pokes.filter((at) => t - at < POKE_MEMORY_MS);
    pokes.push(t);
    hooks.feel?.("poke");
    const answer = pokeAnswer(pokes.length, hooks.temperament?.() ?? "calm");
    if (answer === "hide" && hooks.hold) {
      // Enough: he covers his eyes for a moment (again, if the poking goes on).
      clearTimeout(hiding);
      hooks.hold("peekHide", true);
      hiding = setTimeout(stopHiding, HIDE_MS);
      return;
    }
    hooks.playNow(answer === "hide" ? "shrug" : answer);
  }

  function onClick(zone: Zone = "body", side: Side = "left"): void {
    count++;
    clearTimeout(timer);
    timer = setTimeout(() => {
      count = 0;
    }, BURST_MS);

    hooks.sound();

    if (count >= DIZZY_TAPS) {
      hooks.feel?.("shaken");
      hooks.playNow("dizzy");
      count = 0;
    } else if (count === TICKLE_TAPS) {
      hooks.feel?.("tickle");
      hooks.playNow("tickle");
    } else if (count === 1) {
      if (zone === "head") {
        hooks.feel?.("pat");
        hooks.playNow(side === "left" ? "patLeft" : "patRight");
      } else {
        poke();
      }
    }
    // Taps 2 and 4–6 let the reaction already playing carry on.
  }

  return {
    onClick,
    dispose: () => {
      clearTimeout(timer);
      stopHiding();
    },
  };
}
