/**
 * Whether the one-time move of the old per-tool sprint data into shared
 * sprints has run in this tab. Sprint tools show "Loading sprints…" while it
 * is pending, instead of an empty state that would be wrong a moment later.
 *
 * `idle`: nothing to move (or not checked yet); `pending`: moving now;
 * `done`: finished in this tab.
 */

import { create } from "zustand";

export type SprintMigrationStatus = "idle" | "pending" | "done";

interface MigrationStatusState {
  status: SprintMigrationStatus;
  setStatus: (status: SprintMigrationStatus) => void;
}

export const useSprintMigrationStore = create<MigrationStatusState>((set) => ({
  status: "idle",
  setStatus: (status) => set({ status }),
}));

export function useSprintMigrationStatus(): SprintMigrationStatus {
  return useSprintMigrationStore((s) => s.status);
}
