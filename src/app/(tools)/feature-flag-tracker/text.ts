/**
 * Feature Flag Tracker: the wording the cards, the verdict and the export
 * share. Pure.
 */

import type { FeatureFlagPurpose } from "@/lib/stores/workspace-types";
import { TYPICAL_LIFETIME_DAYS, type FlagStaleness } from "@/lib/flags/model";
import { NO_VALUE, plural } from "@/lib/charts/chart-text";
import { isIsoDate } from "@/lib/sprints/calendar";

/** "24 Oct" (or "24 Oct 2026"), or "—" for no day. */
export function dayLabel(value: string | undefined | null, withYear = false): string {
  const day = value ? value.slice(0, 10) : "";
  if (!isIsoDate(day)) return NO_VALUE;
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

const PURPOSE_NOUN: Record<FeatureFlagPurpose, string> = {
  rollout: "a rollout",
  experiment: "an experiment",
  kill_switch: "a kill switch",
  permission: "a permission flag",
};

/**
 * Why a flag is or isn't stale, in words: "Past its removal date by 12
 * days", "Over 30 days for a rollout (by 5 days)", "Exempt: kill switch",
 * "Due by 30 Nov".
 */
export function stalenessText(st: FlagStaleness, purpose: FeatureFlagPurpose): string {
  if (st.exempt) {
    return purpose === "kill_switch"
      ? "Exempt: kill switch"
      : "Exempt: permission flag with no removal date";
  }
  if (st.reason === "past-removal-date" && st.stale) {
    return `Past its removal date by ${plural(st.daysOver, "day")}`;
  }
  if (st.reason === "over-typical-lifetime" && st.stale) {
    return `Over ${TYPICAL_LIFETIME_DAYS[purpose]} days for ${PURPOSE_NOUN[purpose]} (by ${plural(st.daysOver, "day")})`;
  }
  if (st.dueOn) return `Due by ${dayLabel(st.dueOn)}`;
  return NO_VALUE;
}

/** ", after 30 days" for a retired flag's lifetime; "" when unknown. */
export function livedText(days: number | null): string {
  if (days === null) return "";
  if (days === 0) return ", the day it was created";
  return `, after ${plural(days, "day")}`;
}

/** "12 days old", "created today", or "—". */
export function ageText(days: number | null): string {
  if (days === null) return NO_VALUE;
  if (days === 0) return "created today";
  return `${plural(days, "day")} old`;
}
