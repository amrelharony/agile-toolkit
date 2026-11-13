/**
 * Product Goal's own setting, the product vision, as data: where it is
 * kept, its cap and how a stored copy is read back. The page keeps it in
 * its persisted store (`PRODUCT_GOAL_STORE_NAME`); Amr's verbs read the
 * same copy (the browser's, or the user's synced row on the server), so
 * the check list's "fits the vision" reads the same on both.
 *
 * Pure; server-safe.
 */

/** The persisted store's name (createPersistedStore adds the prefix). */
export const PRODUCT_GOAL_STORE_NAME = "product-goal";
/** Where the vision lives: localStorage in the browser, `user_state.store_key` on the server. */
export const PRODUCT_GOAL_STORE_KEY = `agile-toolkit:${PRODUCT_GOAL_STORE_NAME}`;

/** The longest vision kept (the AI task's input cap). */
export const VISION_MAX = 2000;

/** A vision read back from storage: a string, capped; anything else is "". */
export function normalizeVision(value: unknown): string {
  return typeof value === "string" ? value.slice(0, VISION_MAX) : "";
}

/**
 * The vision in a stored blob: the browser's persisted copy
 * (`{state: {vision}, version}`) or the synced row (`{vision}`). "" when
 * there is none.
 */
export function visionFromBlob(raw: unknown): string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "";
  const state = (raw as { state?: unknown }).state;
  const body = state && typeof state === "object" && !Array.isArray(state) ? state : raw;
  return normalizeVision((body as { vision?: unknown }).vision).trim();
}
