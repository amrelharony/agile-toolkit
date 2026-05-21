"use client";

import { create } from "zustand";

/**
 * Tiny UI-state store for the LLM settings dialog.
 *
 * Decoupled from `llm-store` because (a) it's not persisted — open/closed
 * shouldn't survive reload — and (b) it lets both the header chip and the
 * UserMenu entry flip a single source of truth without prop-drilling or
 * threading a React context through three layers of layout.
 */

interface LlmUiState {
  settingsOpen: boolean;
  setSettingsOpen: (v: boolean) => void;
  openSettings: () => void;
  closeSettings: () => void;
}

export const useLlmUiStore = create<LlmUiState>((set) => ({
  settingsOpen: false,
  setSettingsOpen: (v) => set({ settingsOpen: v }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
}));
