/**
 * Audience Wall's saved walls: a tool store (`agile-toolkit:audience-wall`,
 * synced like the other tool stores for a signed-in owner). Every read and
 * write goes through `normalizeWallData`, because a synced or hand-edited
 * value can hold anything.
 *
 * Not a "use client" module: Amr's actions read and write it in the tab.
 * It skips hydration at load; the page (and an action) rehydrates it first.
 */

import { createPersistedStore } from "@/lib/stores/create-persisted-store";
import {
  AUDIENCE_WALL_INITIAL,
  AUDIENCE_WALL_STORE,
  normalizeWallData,
  type AudienceWallData,
  type WallSession,
} from "./model";

export const useAudienceWallStore = createPersistedStore<AudienceWallData>(
  AUDIENCE_WALL_STORE,
  AUDIENCE_WALL_INITIAL
);

/** Load what this browser stored, once. */
export async function hydrateAudienceWall(): Promise<void> {
  const p = useAudienceWallStore.persist;
  if (!p.hasHydrated()) await p.rehydrate();
}

/** The saved walls, clean, newest first. */
export function readWalls(): WallSession[] {
  return normalizeWallData(useAudienceWallStore.getState()).sessions;
}

/** Change the saved walls, starting from the clean list. */
export function updateWalls(fn: (list: readonly WallSession[]) => WallSession[]): void {
  useAudienceWallStore.setState((s) => ({
    sessions: normalizeWallData({ sessions: fn(normalizeWallData(s).sessions) }).sessions,
  }));
}

/** Change one wall (nothing when it's gone). */
export function updateWall(id: string, fn: (s: WallSession) => WallSession): void {
  updateWalls((list) => list.map((s) => (s.id === id ? fn(s) : s)));
}
