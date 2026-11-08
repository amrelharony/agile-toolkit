"use client";

import { useNotificationPrefsStore } from "@/lib/stores/notification-prefs-store";

/**
 * Settings › Notifications › "XP, levels and badges". Off pauses XP, badges
 * and challenges in the engine and the ledger; the day streak is still kept
 * alive and every total is kept, so switching it back on carries on where it
 * left off. Before the prefs have loaded this reads the default (on).
 *
 * Its own module (not engine.ts) so tests that mock the engine keep a real
 * switch.
 */
export function isGamificationEnabled(): boolean {
  return useNotificationPrefsStore.getState().gamificationEnabled !== false;
}
