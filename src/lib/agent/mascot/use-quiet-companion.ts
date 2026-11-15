"use client";

/**
 * Quiet Companion (docs/mascot/companion-scenes.json N10): when the visitor turns
 * Amr's talk down to Quiet themselves (Settings › Notifications, Celebrations),
 * he covers his little bell and settles, and stays settled while Quiet is still
 * the setting, on this page.
 *
 * Only a change the visitor makes counts: not the stored setting when the page
 * loads (the store is still rehydrating then), and not the one-time move of an
 * old "silent mode" onto Quiet (adoptSilentMode). The hold ends when the level
 * leaves Quiet, the page changes, he's handled (a tap or a drag cuts in with
 * playNow), or he unmounts.
 *
 * The scene changes nothing: the silence is say()'s, from the setting itself.
 */

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { effectiveCelebrationLevel } from "@/lib/notify/prefs";
import { useNotificationPrefsStore } from "@/lib/stores/notification-prefs-store";
import { QUIET_HOLD } from "./companion";
import { useMascotStore, type MascotReaction } from "./store";

/** What the idle ladder plays at once when any input wakes him (engine/idle.ts). */
const WAKING: readonly MascotReaction[] = ["wake", "standUp"];

type PrefsStore = typeof useNotificationPrefsStore;
type Prefs = ReturnType<PrefsStore["getState"]>;

/** Whether this change is the visitor choosing Quiet, or leaving it. */
export function quietChange(s: Prefs, prev: Prefs, hydrated: boolean): "on" | "off" | null {
  const is = effectiveCelebrationLevel(s) === "quiet";
  const was = effectiveCelebrationLevel(prev) === "quiet";
  if (is === was) return null;
  if (!is) return "off";
  // Turning Quiet on: only the visitor's own choice, once the stored one is in.
  if (!hydrated || s.silentModeAdopted !== prev.silentModeAdopted) return null;
  return "on";
}

/** Keep the Quiet hold in step with the visitor's choices. Returns a cleanup. */
export function watchQuiet(store: PrefsStore = useNotificationPrefsStore): () => void {
  const setQuiet = (on: boolean) => useMascotStore.getState().setHold(QUIET_HOLD, on);
  const unsubPrefs = store.subscribe((s, prev) => {
    const change = quietChange(s, prev, store.persist?.hasHydrated?.() ?? true);
    if (change) setQuiet(change === "on");
  });
  // Handled (a tap, a drag, anything played at once for the visitor): he stops
  // holding still. His own waking from a sit or a doze (a key pressed nearby) isn't.
  const unsubMascot = useMascotStore.subscribe((s, prev) => {
    if (!s.holds.includes(QUIET_HOLD)) return;
    const woke = s.playedNow !== null && WAKING.includes(s.playedNow);
    const tapped = s.interrupt !== prev.interrupt && !woke;
    if (tapped || (s.drag && !prev.drag)) setQuiet(false);
  });
  return () => {
    unsubPrefs();
    unsubMascot();
    setQuiet(false);
  };
}

export function useQuietCompanion(): void {
  const path = usePathname();
  // A new page, a fresh start: the hold is for the moment the visitor chose Quiet.
  useEffect(() => watchQuiet(), [path]);
}
