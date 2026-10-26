/**
 * The RACI tool's old local-only store, from before the matrix was a
 * workspace document. Only the one-time move (`app/(tools)/raci/migrate.ts`)
 * reads it; new code must never reuse this name. Kept in this tiny module
 * so the app-wide mount can check for it without loading the RACI model.
 * `lib/raci/model` re-exports both.
 */

/** The tool's old local-only store (a zustand persist blob), moved into the workspace once. */
export const RACI_LEGACY_KEY = "agile-toolkit:raci";

/** Cheap synchronous check: is the old store still in this browser? */
export function hasLegacyRaci(storage?: Pick<Storage, "getItem"> | null): boolean {
  try {
    const store =
      storage === undefined
        ? typeof window === "undefined"
          ? null
          : window.localStorage
        : storage;
    return Boolean(store && store.getItem(RACI_LEGACY_KEY) !== null);
  } catch {
    return false;
  }
}
