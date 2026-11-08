"use client";
import { safeJSONStorage } from "./safe-storage";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { mergePersisted } from "./persist-migrate";
import {
  capMutedKeys,
  DEFAULT_NOTIFICATION_PREFS,
  FOCUS_UNTIL_OFF,
  isValidTime,
  migrateNotificationPrefs,
  NOTIFICATION_PREFS_VERSION,
  type CelebrationLevel,
  type NotificationPrefs,
  type QuietHours,
} from "@/lib/notify/prefs";

export { NOTIFICATION_PREFS_VERSION } from "@/lib/notify/prefs";

/**
 * Notification preferences (Settings › Notifications). Local to this
 * browser: never synced, so a shared screen's quiet hours stay its own.
 * The shape, defaults and pure checks live in `lib/notify/prefs.ts`.
 */

interface NotificationPrefsActions {
  setCelebrationLevel: (level: CelebrationLevel) => void;
  setGamificationEnabled: (v: boolean) => void;
  setShowXpBar: (v: boolean) => void;
  setConfirmationsAsToasts: (v: boolean) => void;
  /** Focus for `durationMs` from `now`; `null` = until turned off. */
  startFocus: (durationMs: number | null, now?: number) => void;
  endFocus: () => void;
  /** Update quiet hours. Malformed times are ignored. */
  setQuietHours: (patch: Partial<QuietHours>) => void;
  /** Pause celebrations for `durationMs` from `now`. */
  pauseCelebrations: (durationMs: number, now?: number) => void;
  resumeCelebrations: () => void;
  /** Stop showing toasts with this key (learned muting). */
  muteKey: (key: string) => void;
  /** "Show hidden tips again". */
  clearMutedKeys: () => void;
  /**
   * Map the legacy gamification silent mode onto `celebrationLevel` once,
   * after both stores have rehydrated. Later calls do nothing.
   */
  adoptSilentMode: (silentMode: boolean) => void;
  resetToDefaults: () => void;
}

export type NotificationPrefsState = NotificationPrefs & NotificationPrefsActions;

export const useNotificationPrefsStore = create<NotificationPrefsState>()(
  persist(
    (set) => ({
      ...DEFAULT_NOTIFICATION_PREFS,
      setCelebrationLevel: (level) => set({ celebrationLevel: level }),
      setGamificationEnabled: (v) => set({ gamificationEnabled: v }),
      setShowXpBar: (v) => set({ showXpBar: v }),
      setConfirmationsAsToasts: (v) => set({ confirmationsAsToasts: v }),
      startFocus: (durationMs, now = Date.now()) =>
        set({
          focusUntil:
            durationMs === null || !Number.isFinite(durationMs)
              ? FOCUS_UNTIL_OFF
              : now + Math.max(0, durationMs),
        }),
      endFocus: () => set({ focusUntil: null }),
      setQuietHours: (patch) =>
        set((s) => ({
          quietHours: {
            ...s.quietHours,
            ...(typeof patch.enabled === "boolean" ? { enabled: patch.enabled } : {}),
            ...(isValidTime(patch.start) ? { start: patch.start } : {}),
            ...(isValidTime(patch.end) ? { end: patch.end } : {}),
          },
        })),
      pauseCelebrations: (durationMs, now = Date.now()) =>
        set({ celebrationsPausedUntil: now + Math.max(0, durationMs) }),
      resumeCelebrations: () => set({ celebrationsPausedUntil: null }),
      muteKey: (key) => set((s) => ({ mutedKeys: capMutedKeys([...s.mutedKeys, key]) })),
      clearMutedKeys: () => set({ mutedKeys: [] }),
      adoptSilentMode: (silentMode) =>
        set((s) => {
          if (s.silentModeAdopted) return {};
          return silentMode
            ? { silentModeAdopted: true, celebrationLevel: "quiet" }
            : { silentModeAdopted: true };
        }),
      resetToDefaults: () =>
        // Keep the one-off silent-mode mapping done: a reset must not let a
        // later silentMode read flip the level again.
        set((s) => ({ ...DEFAULT_NOTIFICATION_PREFS, silentModeAdopted: s.silentModeAdopted })),
    }),
    {
      name: "agile-toolkit:notification-prefs",
      storage: safeJSONStorage("notification-prefs"),
      skipHydration: true,
      version: NOTIFICATION_PREFS_VERSION,
      // Runs for any other stored version, older or newer: idempotent and
      // keeps unknown fields, so a rollback loses nothing.
      migrate: (persisted) => migrateNotificationPrefs(persisted) as NotificationPrefsState,
      // Same-version payloads skip `migrate`, so sanitise them here too.
      merge: (persisted, current) =>
        mergePersisted(
          persisted && typeof persisted === "object" && !Array.isArray(persisted)
            ? migrateNotificationPrefs(persisted)
            : persisted,
          current
        ),
    }
  )
);

/** The preference fields only (no actions), e.g. for `getQuietState`. */
export function getNotificationPrefsSnapshot(): NotificationPrefs {
  const s = useNotificationPrefsStore.getState();
  return {
    celebrationLevel: s.celebrationLevel,
    gamificationEnabled: s.gamificationEnabled,
    showXpBar: s.showXpBar,
    confirmationsAsToasts: s.confirmationsAsToasts,
    focusUntil: s.focusUntil,
    quietHours: s.quietHours,
    celebrationsPausedUntil: s.celebrationsPausedUntil,
    mutedKeys: s.mutedKeys,
    silentModeAdopted: s.silentModeAdopted,
  };
}
