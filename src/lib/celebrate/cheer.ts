/**
 * Ask Amr to celebrate something a tool did: a wheel landing on a name, a
 * vote that agreed, a goal achieved. He is the only celebration that moves
 * (design-system/DNA-SPEC.md): no confetti, no full-screen layer. This only
 * announces a moment (agent/mascot/tool-moments.ts); Amr answers it when he's
 * on screen (use-tool-reactions.ts), with the tool's own scene for it when
 * his tool table names one, else his cheer, or a dance for a milestone. When
 * he isn't there, nothing happens, so a tool can always call it.
 *
 * He plays one reaction per tick, the most telling, and at most one every
 * few seconds. Call it in the same tick as the history log of the action that
 * earned it (or with no log at all), not seconds after: a log just before
 * would take his turn.
 *
 * A short sound comes only when the call asks for one, through the toolkit's
 * sound engine, so it follows the visitor's sound settings (Full mode only)
 * and plays nothing while sound is off. It doesn't count as an outcome: no XP.
 */

import { CHEER_MOMENTS, announceToolMoment } from "@/lib/agent/mascot/tool-moments";

/**
 * Why the tool is celebrating. A milestone (a goal achieved, a round of the
 * whole team done) gets a dance; everything else his cheer.
 */
export type CheerReason = "result" | "agreed" | "done" | "milestone";

export interface CheerOptions {
  /** Also play a short celebration sound (still subject to the sound settings). Default false. */
  sound?: boolean;
}

/** The moment `cheer` announces for a reason. */
export function cheerMoment(reason: CheerReason): string {
  return reason === "milestone" ? CHEER_MOMENTS.dance : CHEER_MOMENTS.cheer;
}

/**
 * The sound engine, loaded the first time a cheer asks for a sound, so a tool
 * page that never asks doesn't pull it in. One load, shared by every call.
 */
let soundEngine: Promise<typeof import("@/lib/sonification/emit")> | undefined;

/** Ask Amr to celebrate in tool `toolId` (a registry id, such as "picker"). */
export function cheer(
  toolId: string,
  reason: CheerReason = "done",
  options: CheerOptions = {}
): void {
  if (typeof window === "undefined") return;
  announceToolMoment(toolId, cheerMoment(reason));
  if (!options.sound) return;
  const event = reason === "milestone" ? "dance" : "cheer";
  // A load that failed (offline, a stale chunk) is tried again next time.
  soundEngine ??= import("@/lib/sonification/emit").catch((err: unknown) => {
    soundEngine = undefined;
    throw err;
  });
  // Feedback only: never the XP engine.
  soundEngine
    .then(({ emitFeedback }) => emitFeedback("celebrate", event, null, { haptics: false }))
    .catch(() => {
      /* no sound engine here: Amr still cheered */
    });
}
