"use client";

import { useSyncExternalStore } from "react";
import { readLastBackupAt, subscribeLastBackup } from "@/lib/data/backup-meta";

const none = () => null;

/**
 * When the last backup was downloaded (an ISO time), or null for never. It
 * follows a download made anywhere on the page or in another tab, so a chip
 * that shows the backup's age updates the moment one is taken. Null in the
 * server HTML and while hydrating, where the browser's storage can't be read.
 */
export function useLastBackupAt(): string | null {
  return useSyncExternalStore(subscribeLastBackup, readLastBackupAt, none);
}
