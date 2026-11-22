/**
 * The companion scenes that stand for something real (docs/mascot/companion-scenes.json,
 * N01–N10; the clips are in components/agent/mascot/engine/scenes.ts, whose
 * COMPANION_SCENES names the same scenes):
 *
 *   • a decision: while a two-choice card waits for the visitor (the visitor's
 *     Approve or Deny card, the consent card before their first AI message), he
 *     offers the two options once, then waits. No timer ends it and no default
 *     is chosen: it lasts exactly as long as a card does.
 *   • trouble: something went wrong a moment ago (a failed answer, a spent
 *     allowance, a failed action, someone stuck). His light-hearted pastimes
 *     (the knowing look with the ahwa cup) keep out of the next few minutes.
 *
 * The Quiet hold is in use-quiet-companion.ts.
 */

import { useMascotStore } from "./store";

/** The held scene while a choice waits (engine/scenes.ts: decide). */
export const DECISION_HOLD = "scene:decide" as const;
/** The held scene while the visitor's own Quiet lasts (engine/scenes.ts: quiet). */
export const QUIET_HOLD = "scene:quiet" as const;
/** Scenes kept away from trouble: a shared chuckle doesn't follow a failure. */
export const CALM_AFTER_TROUBLE: readonly string[] = ["ahwa"];

/** A card's end waits this long, so one card closing as the next opens doesn't replay the offer. */
export const DECISION_END_MS = 60;
/** Trouble keeps the light-hearted scenes away this long. */
export const TROUBLE_MS = 5 * 60_000;

const waiting = new Set<string>();
let endTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * A two-choice card is up and waiting for the visitor (`on`), or it has its
 * answer or is gone (off). `card` names it; he waits while any card does.
 */
export function awaitDecision(card: string, on: boolean): void {
  if (on) waiting.add(card);
  else waiting.delete(card);
  clearTimeout(endTimer);
  endTimer = undefined;
  if (waiting.size) {
    useMascotStore.getState().setHold(DECISION_HOLD, true);
    return;
  }
  endTimer = setTimeout(() => {
    endTimer = undefined;
    if (!waiting.size) useMascotStore.getState().setHold(DECISION_HOLD, false);
  }, DECISION_END_MS);
}

/** Whether a card is waiting for the visitor now. */
export function decisionWaiting(): boolean {
  return waiting.size > 0;
}

let troubleAt = -Infinity;

/** Something just went wrong (or someone seems stuck). */
export function noteTrouble(at: number = Date.now()): void {
  troubleAt = at;
}

/** Whether something went wrong in the last few minutes, or still shows. */
export function troubleRecent(now: number = Date.now()): boolean {
  return troubleShown > 0 || now - troubleAt < TROUBLE_MS;
}

/**
 * Whether a tool result is the visitor's own decision not to go ahead (Deny, a
 * closed card, a stopped turn): a normal answer, not a failure.
 */
export function isDeclined(result: { content: unknown; is_error?: boolean }): boolean {
  if (!result.is_error) return false;
  const text =
    typeof result.content === "string"
      ? result.content
      : Array.isArray(result.content)
        ? result.content
            .map((c: { text?: unknown }) => (typeof c?.text === "string" ? c.text : ""))
            .join("")
        : "";
  // "Handler error: cancelled" is a turn stopped while its action ran (execute-tool.ts raceGuards).
  return (
    /^User denied execution of /.test(text) ||
    text === "Cancelled." ||
    text === "Handler error: cancelled"
  );
}

let troubleShown = 0;

/** Something wrong stays on screen (a crashed tool's page): trouble lasts while it does. */
export function showTrouble(on: boolean): void {
  troubleShown = Math.max(0, troubleShown + (on ? 1 : -1));
  noteTrouble();
}

/** For tests: forget every card and any trouble. */
export function resetCompanion(): void {
  waiting.clear();
  clearTimeout(endTimer);
  endTimer = undefined;
  troubleAt = -Infinity;
  troubleShown = 0;
}
