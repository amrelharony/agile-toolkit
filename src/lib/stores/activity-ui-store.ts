"use client";

import { create } from "zustand";

/**
 * Open/closed state of the Activity panel and the trophy case. Not
 * persisted. One mount of each lives in app-shell.tsx, so the XP bar, the
 * user menu and the panel's own Trophies footer can all open them.
 */
interface ActivityUiState {
  activityOpen: boolean;
  trophyOpen: boolean;
  setActivityOpen: (open: boolean) => void;
  setTrophyOpen: (open: boolean) => void;
  openActivity: () => void;
  /** Open Activity, or close it if open (the XP bar). */
  toggleActivity: () => void;
  /** Close Activity (if open) and open the trophy case. */
  openTrophies: () => void;
}

export const useActivityUiStore = create<ActivityUiState>()((set) => ({
  activityOpen: false,
  trophyOpen: false,
  setActivityOpen: (open) => set({ activityOpen: open }),
  setTrophyOpen: (open) => set({ trophyOpen: open }),
  openActivity: () => set({ activityOpen: true }),
  toggleActivity: () => set((s) => ({ activityOpen: !s.activityOpen })),
  openTrophies: () => set({ activityOpen: false, trophyOpen: true }),
}));
