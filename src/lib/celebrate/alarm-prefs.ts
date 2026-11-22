/**
 * The shared "Chime when time is up" setting for the timers that ring
 * `timesUp` (chime.ts): the room countdowns, the Retro board's timer, the
 * step timer and the docked timer. Off by default: the toolkit keeps sound
 * off unless someone turns it on (DNA-SPEC "Sound stays off by default").
 * Kept in this browser only.
 *
 * The Ceremony Timer and Facilitator Timers have their own switches (their
 * settings stores). A segment or step of theirs on the dock carries its
 * tool's switch (`DockedTimer.chime`), so away from its page that switch
 * rings it, not this setting.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { safeJSONStorage } from "@/lib/stores/safe-storage";

export interface AlarmPrefs {
  /** Chime and buzz when a timer reaches zero. */
  sound: boolean;
  setSound: (on: boolean) => void;
}

export const ALARM_PREFS_KEY = "agile-toolkit:alarm";

export const useAlarmPrefs = create<AlarmPrefs>()(
  persist(
    (set) => ({
      sound: false,
      setSound: (on) => set({ sound: on === true }),
    }),
    {
      name: ALARM_PREFS_KEY,
      version: 1,
      storage: safeJSONStorage("alarm-prefs"),
      partialize: (s) => ({ sound: s.sound }),
      // Whatever was stored, only a real `true` turns sound on.
      merge: (persisted, current) => ({
        ...current,
        sound: (persisted as { sound?: unknown } | null)?.sound === true,
      }),
    }
  )
);
