"use client";

import { useCallback } from "react";
import { usePersistedLocal } from "@/lib/utils/use-persisted";
import { COMIC_LAST_PAGE_KEY } from "@/lib/comic/agile-at-work";
import { validLastPage } from "@/lib/comic/last-page";

/**
 * The last page read, per device: never in the workspace or the cloud
 * (nothing else reads it, and a resume point is about this browser).
 *
 * Same key and value as before (a JSON number), so a position saved by the
 * first reader is still offered. The slot is read in a mount effect, which
 * finishes before the PDF opens; a value that isn't a page reads as none.
 * A failed write (quota) raises the shell's storage banner, as every
 * persisted preference does.
 */
export function useLastPage(
  key: string = COMIC_LAST_PAGE_KEY
): [saved: number | null, save: (page: number) => void] {
  const [stored, setStored] = usePersistedLocal<unknown>(key, null);
  const save = useCallback((page: number) => setStored(page), [setStored]);
  return [validLastPage(stored), save];
}
