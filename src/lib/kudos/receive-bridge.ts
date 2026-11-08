"use client";

/**
 * Receive-side bridge for kudos.
 *
 * When the signal-bridge emits `kudos.received` (the local viewer is the
 * recipient), this module fans the event out to:
 *   * sonification + haptics + gamification (via `emit("kudos","received")`)
 *   * the emotion engine — pushes a transient mood signal so subsequent
 *     animations lift to the brighter end of the curve for ~30 s.
 *   * `kudos.fairness_alert` is forwarded to sonification too so the
 *     ambient HUD (Phase 4) has an audible counterpart.
 *
 * A received kudos pays `kudos-received` XP once per kudos id through the
 * ledger, and the whole fan-out runs once per id: a guest room both emits
 * the signal and calls `onKudosReceived` directly (the bridge isn't
 * installed on bare /guest routes), and must not pay or play twice.
 *
 * Send-side `emit("kudos","sent")` is dispatched from the form submit
 * handler directly because it carries a target element for haptics —
 * the bridge here only handles the receive-side where there's no
 * caller element to attribute the cooldown to.
 */

import { subscribeSignals, type Signal } from "@/lib/signals/signal-bus";
import { emit } from "@/lib/sonification/emit";
import { pushMoodSignal } from "@/lib/emotion/engine";
import { recordOutcome } from "@/lib/gamification/ledger";

let installed = false;
let unsubscribe: (() => void) | null = null;

const MOOD_LIFT_TTL_MS = 30_000;

/** Kudos ids already handled this session (bounded). */
const handled = new Set<string>();
const HANDLED_CAP = 200;

/**
 * Fan out one received kudos: sound + haptics + the engine's counter, the
 * mood lift, and `kudos-received` XP keyed by the kudos id. A second call
 * for the same id does nothing. Returns true when it ran.
 */
export function onKudosReceived(id: unknown): boolean {
  const kudosId = typeof id === "string" && id ? id : null;
  if (kudosId) {
    if (handled.has(kudosId)) return false;
    handled.add(kudosId);
    if (handled.size > HANDLED_CAP) {
      const oldest = handled.values().next().value;
      if (oldest !== undefined) handled.delete(oldest);
    }
  }
  // Sonification + haptics + the engine's `tool:kudos:received` counter all
  // hang off the canonical event name. The event itself pays no XP.
  emit("kudos", "received");
  // Mood lift — playful for 30 s. Uses the `activity` source because
  // it sits at the bottom of the priority ladder; it'll surface
  // when nothing else is overriding, which is the common case.
  pushMoodSignal("activity", "Playful", { ttlMs: MOOD_LIFT_TTL_MS, confidence: 0.7 });
  if (kudosId) recordOutcome("kudos-received", { key: `kudos-in:${kudosId}` });
  return true;
}

export function installKudosReceiveBridge(): void {
  if (installed) return;
  installed = true;
  unsubscribe = subscribeSignals(
    ["kudos.received", "kudos.fairness_alert", "kudos.reaction.added"],
    (s: Signal) => {
      if (s.kind === "kudos.received") {
        onKudosReceived((s.payload as { id?: unknown } | undefined)?.id);
        return;
      }
      if (s.kind === "kudos.fairness_alert") {
        emit("kudos", "fairness-alert");
        return;
      }
      if (s.kind === "kudos.reaction.added") {
        emit("kudos", "reaction-added");
        return;
      }
    }
  );
}

export function uninstallKudosReceiveBridge(): void {
  unsubscribe?.();
  unsubscribe = null;
  installed = false;
  handled.clear();
}
