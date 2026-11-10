/**
 * Room left in this browser's storage, for an import that adds a lot at
 * once (Sprint Planning's Jira import: up to 1,000 stories).
 *
 * Everything a visitor makes lives in localStorage, mostly in the one
 * workspace entry, under a quota of about 5 MB for the whole site. Past it
 * the browser stops saving and the next reload loses the work (the store
 * keeps it in memory and the shell offers a backup, lib/stores/
 * storage-health.ts). So an import that would bring the site near the quota
 * is refused before it is written, with what to do instead.
 *
 * Sizes are counted the strictest way a browser counts them, as in
 * test/retro/retro-archive-size.test.ts: two bytes per character (strings
 * are UTF-16) against 5 MB. A browser that allows 5 million characters has
 * twice this room, so the check errs on the side of keeping work saved.
 *
 * Pure apart from `siteStorageBytes`, which reads the storage it is given
 * and counts nothing it can't read.
 */

/** The quota counted against: 5 MB. */
export const STORAGE_QUOTA_BYTES = 5 * 1024 * 1024;
/** "Near the quota": an import may not bring the site past this share of it. */
export const STORAGE_NEAR_SHARE = 0.9;

/** What a string costs in storage, counted as UTF-16. */
export const storedBytes = (text: string): number => text.length * 2;

/**
 * What the site keeps in `storage` now, every key and value, with the
 * entry `replaceKey` counted as `replaceWith` instead (the workspace as the
 * store holds it now, which may be newer than its stored copy). 0 for a
 * storage that can't be read (private mode, blocked).
 */
export function siteStorageBytes(
  storage: Pick<Storage, "length" | "key" | "getItem"> | null | undefined,
  replace?: { key: string; value: string }
): number {
  let total = replace ? storedBytes(replace.key) + storedBytes(replace.value) : 0;
  if (!storage) return total;
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key === null || key === replace?.key) continue;
      total += storedBytes(key) + storedBytes(storage.getItem(key) ?? "");
    }
  } catch {
    // Unreadable storage: count what the workspace alone takes.
  }
  return total;
}

const percent = (bytes: number) => Math.round((bytes / STORAGE_QUOTA_BYTES) * 100);

/**
 * Why adding `addedBytes` to the `usedBytes` already stored isn't safe, or
 * null when it fits: the message says how full storage would be and what
 * to do instead. `what` names what is being added, plural and as a
 * sentence starts ("These stories").
 */
export function storageRoomProblem(
  usedBytes: number,
  addedBytes: number,
  what = "These items"
): string | null {
  const after = usedBytes + addedBytes;
  if (after <= STORAGE_QUOTA_BYTES * STORAGE_NEAR_SHARE) return null;
  const full =
    after > STORAGE_QUOTA_BYTES
      ? `${what} need more room than this browser's storage has, about 5 MB in all.`
      : `${what} would fill ${percent(after)}% of this browser's storage, which holds about 5 MB.`;
  return `${full} Past that, work stops being saved, so they can't be imported. Import fewer rows at a time, such as one sprint's issues. Or download a backup from Your data, then delete work you no longer need.`;
}
