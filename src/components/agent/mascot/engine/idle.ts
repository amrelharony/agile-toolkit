/**
 * When nobody's around, Amr gets sleepy (docs/mascot/AMR-ART-BRIEF.md, S07): a
 * yawn after 45 s, he sits down after 2 min, dozes off after 4. Any input wakes
 * him: startled if he was dozing, standing up if he was sitting. Late at night
 * (23:00–05:00) he tires sooner; on the first visit of a morning he stretches.
 * On desktop, idle for half a minute or so, he may take a short stroll along the
 * bottom of the screen; anywhere, he may pass the time with a scene of the day
 * or a game first (`play`, engine/interactions/context.ts).
 *
 * The ladder pauses while the panel is open, a reply streams or he's carried,
 * and while the tab is hidden. Pure apart from the clock, which is injected.
 */

import type { MascotHold, MascotReaction } from "@/lib/agent/mascot/store";
import type { PackId } from "../mascot-packs";

export interface IdleHooks {
  act(r: MascotReaction): void;
  playNow(r: MascotReaction): void;
  hold(h: MascotHold, on: boolean): void;
  allow(name: string, cooldownMs?: number): boolean;
  /** Someone's engaged with him: the panel is open, a reply streams, he's carried. */
  busy(): boolean;
  /** A stroll is possible now (desktop, parked at the bottom, motion allowed). */
  canStroll(): boolean;
  /** Load these packs ahead of the moment they're needed. */
  want(packs: PackId[]): void;
  /** Pass the time with a scene; true if one plays. */
  play?: () => boolean;
  now?: () => number;
  hour?: () => number;
  random?: () => number;
}

export const YAWN_MS = 45_000;
export const SIT_MS = 2 * 60_000;
export const DOZE_MS = 4 * 60_000;
/** Late at night everything comes sooner. */
const LATE_FACTOR = 0.6;

export type Rest = "awake" | "sitting" | "dozing";

export interface IdleLadder {
  /** The visitor did something. */
  input(): void;
  /** Call about once a second. */
  tick(): void;
  rest(): Rest;
}

export function createIdleLadder(hooks: IdleHooks): IdleLadder {
  const now = hooks.now ?? (() => Date.now());
  const hour = hooks.hour ?? (() => new Date().getHours());
  const random = hooks.random ?? Math.random;
  let lastInput = now();
  let rest: Rest = "awake";
  let yawned = false;
  let strolled = false;
  let strollAt = 25_000 + random() * 30_000;
  let played = false;
  let playAt = 15_000 + random() * 15_000;
  let wanted = { rest: false, stroll: false };

  const late = () => {
    const h = hour();
    return h >= 23 || h < 5;
  };

  function wakeUp(): void {
    if (rest === "dozing") {
      hooks.hold("dozing", false);
      hooks.playNow("wake");
    } else if (rest === "sitting") {
      hooks.hold("sitting", false);
      hooks.playNow("standUp");
    }
    rest = "awake";
  }

  function input(): void {
    lastInput = now();
    yawned = false;
    strolled = false;
    strollAt = 25_000 + random() * 30_000;
    played = false;
    playAt = 15_000 + random() * 15_000;
    if (rest !== "awake") wakeUp();
  }

  function tick(): void {
    if (hooks.busy()) {
      lastInput = now();
      if (rest !== "awake") wakeUp();
      return;
    }
    const idle = now() - lastInput;
    const f = late() ? LATE_FACTOR : 1;
    if (!wanted.rest && idle > YAWN_MS * f - 15_000) {
      wanted = { ...wanted, rest: true };
      hooks.want(["rest"]);
    }
    if (!wanted.stroll && idle > 15_000 && hooks.canStroll()) {
      wanted = { ...wanted, stroll: true };
      hooks.want(["stroll"]);
    }
    if (rest === "awake" && !played && hooks.play && idle > playAt && idle < YAWN_MS * f) {
      played = true;
      // A scene to pass the time stands in for this stretch's stroll.
      if (hooks.play()) strolled = true;
    }
    if (rest === "awake" && !strolled && idle > strollAt && idle < YAWN_MS * f) {
      strolled = true;
      if (hooks.canStroll() && hooks.allow("stroll", 3 * 60_000)) hooks.act("stroll");
    }
    if (rest === "awake" && !yawned && idle > YAWN_MS * f) {
      yawned = true;
      if (hooks.allow("yawn", 60_000)) hooks.act("yawn");
    }
    if (rest === "awake" && idle > SIT_MS * f) {
      rest = "sitting";
      hooks.hold("sitting", true);
    }
    if (rest === "sitting" && idle > DOZE_MS * f) {
      rest = "dozing";
      hooks.hold("sitting", false);
      hooks.hold("dozing", true);
    }
  }

  return { input, tick, rest: () => rest };
}

const DAY_KEY = "mascot_last_day";

/** True once a day, on the first visit before 11:00: time for a morning stretch. */
export function firstMorningVisit(date = new Date()): boolean {
  try {
    const day = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    const last = localStorage.getItem(DAY_KEY);
    localStorage.setItem(DAY_KEY, day);
    const h = date.getHours();
    return last !== day && h >= 5 && h < 11;
  } catch {
    return false;
  }
}
