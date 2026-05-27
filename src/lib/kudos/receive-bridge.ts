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
 * Send-side `emit("kudos","sent")` is dispatched from the form submit
 * handler directly because it carries a target element for haptics —
 * the bridge here only handles the receive-side where there's no
 * caller element to attribute the cooldown to.
 */

import { subscribeSignals, type Signal } from "@/lib/signals/signal-bus";
import { emit } from "@/lib/sonification/emit";
import { pushMoodSignal } from "@/lib/emotion/engine";

let installed = false;
let unsubscribe: (() => void) | null = null;

const MOOD_LIFT_TTL_MS = 30_000;

export function installKudosReceiveBridge(): void {
  if (installed) return;
  installed = true;
  unsubscribe = subscribeSignals(
    ["kudos.received", "kudos.fairness_alert", "kudos.reaction.added"],
    (s: Signal) => {
      if (s.kind === "kudos.received") {
        // Sonification + haptics + gamification all hang off the canonical
        // tool:kudos:received event name (xpForEvent + the kudos palette
        // both key on it). The bridge layer is the single emit site so
        // adding another fan-out target later means editing one file.
        emit("kudos", "received");
        // Mood lift — playful for 30 s. Uses the `activity` source because
        // it sits at the bottom of the priority ladder; it'll surface
        // when nothing else is overriding, which is the common case.
        pushMoodSignal("activity", "Playful", { ttlMs: MOOD_LIFT_TTL_MS, confidence: 0.7 });
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
}
