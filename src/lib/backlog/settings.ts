/**
 * Backlog Health's settings as data: how many stories count as the top of
 * the backlog, how many points is too big and how many weeks untouched is
 * stale, their limits, and how a stored copy is read back. The page keeps
 * them in its persisted store (`BACKLOG_HEALTH_STORE_NAME`); Amr's verbs
 * read the same copy (the browser's, or the user's synced row on the
 * server), so the page and Amr scan the backlog the same way.
 *
 * Pure; server-safe.
 */

import { DEEP_TOP_N, STALE_WEEKS, TOO_BIG_POINTS } from "./health";

/** The persisted store's name (createPersistedStore adds the prefix). */
export const BACKLOG_HEALTH_STORE_NAME = "backlog-health";
/** Where the settings live: localStorage in the browser, `user_state.store_key` on the server. */
export const BACKLOG_HEALTH_STORE_KEY = `agile-toolkit:${BACKLOG_HEALTH_STORE_NAME}`;

export interface HealthSettings {
  topN: number;
  tooBigPoints: number;
  staleWeeks: number;
}

export const DEFAULT_SETTINGS: HealthSettings = {
  topN: DEEP_TOP_N,
  tooBigPoints: TOO_BIG_POINTS,
  staleWeeks: STALE_WEEKS,
};

/** Each setting's whole-number range, both ends included. */
export const SETTINGS_LIMITS: Record<keyof HealthSettings, readonly [number, number]> = {
  topN: [1, 50],
  tooBigPoints: [1, 100],
  staleWeeks: [1, 104],
};

const inRange = (key: keyof HealthSettings, v: unknown): v is number =>
  typeof v === "number" &&
  Number.isInteger(v) &&
  v >= SETTINGS_LIMITS[key][0] &&
  v <= SETTINGS_LIMITS[key][1];

/** Settings as read back: a value out of range is its default. */
export function normalizeSettings(
  value: Partial<Record<keyof HealthSettings, unknown>> | null | undefined
): HealthSettings {
  const out = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof HealthSettings)[]) {
    const v = value?.[key];
    if (inRange(key, v)) out[key] = v;
  }
  return out;
}

/**
 * The settings in a stored blob: the browser's persisted copy
 * (`{state: {...}, version}`) or the synced row (the state itself). The
 * defaults when there is none, or it can't be read.
 */
export function settingsFromBlob(raw: unknown): HealthSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_SETTINGS };
  const state = (raw as { state?: unknown }).state;
  const body = state && typeof state === "object" && !Array.isArray(state) ? state : raw;
  return normalizeSettings(body as Partial<Record<keyof HealthSettings, unknown>>);
}
