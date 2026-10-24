/**
 * The Impediments tool's old local store, from before it kept its rows in
 * `workspace.impediments`. Only the one-time move (`migrate-legacy.ts`)
 * reads it; new code must never reuse this name. Kept in this tiny module
 * so the mount point can check for it without loading the move itself.
 */

export const LEGACY_IMPEDIMENTS_KEY = "agile-toolkit:impediments";

/** Cheap synchronous check: is the old store still in this browser? */
export function hasLegacyImpediments(storage?: Pick<Storage, "getItem"> | null): boolean {
  try {
    const store =
      storage === undefined
        ? typeof window === "undefined"
          ? null
          : window.localStorage
        : storage;
    return Boolean(store && store.getItem(LEGACY_IMPEDIMENTS_KEY) !== null);
  } catch {
    return false;
  }
}
