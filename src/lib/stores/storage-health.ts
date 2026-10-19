import { create } from "zustand";

/**
 * Whether this browser is still saving the toolkit's data.
 *
 * When localStorage is full or blocked, every store keeps working in memory
 * and the next reload loses it all — previously with only a console warning.
 * Storage adapters report failures here and the shell shows a banner that
 * offers a backup while the data still exists in memory.
 */
interface StorageHealth {
  /** A write failed since the page loaded. */
  writeFailed: boolean;
  /** The user closed the banner for this page load. */
  dismissed: boolean;
  dismiss: () => void;
}

export const useStorageHealth = create<StorageHealth>((set) => ({
  writeFailed: false,
  dismissed: false,
  dismiss: () => set({ dismissed: true }),
}));

/** Call from any storage adapter's failed write. */
export function reportStorageWriteFailure(): void {
  if (!useStorageHealth.getState().writeFailed) useStorageHealth.setState({ writeFailed: true });
}
