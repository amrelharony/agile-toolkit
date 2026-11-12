/**
 * Backlog Health's own settings: how many stories count as the top of the
 * backlog, how many points is too big, and how many weeks untouched is
 * stale. The stories themselves are the workspace's.
 */

import { createPersistedStore } from "@/lib/stores/create-persisted-store";
import {
  BACKLOG_HEALTH_STORE_NAME,
  DEFAULT_SETTINGS,
  SETTINGS_LIMITS,
  normalizeSettings,
  type HealthSettings,
} from "@/lib/backlog/settings";
import type { Validation } from "@/lib/utils/form";

// The settings' shape, defaults and read-back live in lib/backlog/settings,
// where Amr's verbs read them too.
export { DEFAULT_SETTINGS, normalizeSettings, type HealthSettings };

export const useBacklogHealthSettings = createPersistedStore<HealthSettings>(
  BACKLOG_HEALTH_STORE_NAME,
  DEFAULT_SETTINGS
);

export type SettingsDraft = Record<keyof HealthSettings, string>;

export const settingsDraft = (s: HealthSettings): SettingsDraft => ({
  topN: String(s.topN),
  tooBigPoints: String(s.tooBigPoints),
  staleWeeks: String(s.staleWeeks),
});

const LABEL: Record<keyof HealthSettings, string> = {
  topN: "The top of the backlog",
  tooBigPoints: "Too big above",
  staleWeeks: "Stale after",
};

export function validateSettings(
  draft: SettingsDraft
): Validation<HealthSettings, keyof HealthSettings> {
  const errors: Partial<Record<keyof HealthSettings, string>> = {};
  const values = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof HealthSettings)[]) {
    const n = Number(draft[key].trim());
    const [min, max] = SETTINGS_LIMITS[key];
    if (!draft[key].trim() || !Number.isInteger(n) || n < min || n > max) {
      errors[key] = `${LABEL[key]}: a whole number from ${min} to ${max}.`;
    } else values[key] = n;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, values };
}

/** Points as typed into a story's field: blank clears them, else 0 to 1,000. */
export function validatePoints(raw: string): Validation<number | undefined, "points"> {
  const t = raw.trim();
  if (!t) return { ok: true, values: undefined };
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > 1000) {
    return { ok: false, errors: { points: "Points are a number from 0 to 1,000." } };
  }
  return { ok: true, values: Math.round(n * 10) / 10 };
}
