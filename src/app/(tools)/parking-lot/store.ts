/**
 * Parking Lot's writes, on the one store its agent verbs and next step read
 * (workspace.parkingLotItems). Store writes stamp nothing: the page stamps
 * createdAt and updatedAt (lib/parking-lot/model), as the workspace CRUD does
 * for agents.
 */

import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { ParkingLotItem } from "@/lib/stores/workspace-types";

const ws = () => useWorkspaceStore.getState();

/** Every stored row, fresh (not a render's copy). */
export const currentParkingItems = (): ParkingLotItem[] => ws().parkingLotItems ?? [];

export const findParkingItem = (id: string): ParkingLotItem | undefined =>
  currentParkingItems().find((i) => i.id === id);

export function saveParkingItem(item: ParkingLotItem): ParkingLotItem {
  ws().upsertParkingLotItem(item);
  return item;
}

/** Change one row with `fn`; false when it is gone. */
export function patchParkingItem(
  id: string,
  fn: (item: ParkingLotItem) => ParkingLotItem
): boolean {
  const item = findParkingItem(id);
  if (!item) return false;
  ws().upsertParkingLotItem(fn(item));
  return true;
}

/** Remove a row, returning it (for Undo), or null when it was already gone. */
export function removeParkingItem(id: string): ParkingLotItem | null {
  const item = findParkingItem(id);
  if (!item) return null;
  ws().removeParkingLotItem(id);
  return item;
}
