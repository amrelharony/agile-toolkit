/**
 * How the themes table words a tag's own scores, on the page and in the
 * Markdown alike: a tag's NPS or CSAT shows from MIN_SAMPLE.surveyPeriod
 * responses (a tag on three answers would read as a finding), and below it
 * only its n. The counts are lib/nps tagCounts'. Also the theme the page
 * suggests testing a fix for, from the last 90 days only.
 */

import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import {
  csatCategory,
  isReadableScore,
  npsCategory,
  tagCounts,
  type TagCount,
} from "@/lib/nps/score";
import { isIsoDate, isoDayNumber } from "@/lib/sprints/calendar";
import type { NpsResponse } from "@/lib/stores/workspace-types";

/** The window the Hypothesis Tracker pointer reads: the last 90 days, today included. */
export const RECENT_DAYS = 90;
/** Unhappy answers a tag needs in that window before the page suggests testing a fix. */
export const POINTER_MIN_UNHAPPY = 3;

/** The responses dated in the `days` days up to `today` ("YYYY-MM-DD"), today included. */
export function recentResponses(
  rs: readonly NpsResponse[],
  today: string,
  days: number = RECENT_DAYS
): NpsResponse[] {
  const end = isoDayNumber(today);
  if (end === null) return [];
  return rs.filter((r) => {
    if (typeof r.date !== "string" || !isIsoDate(r.date)) return false;
    const day = isoDayNumber(r.date);
    return day !== null && day <= end && day > end - days;
  });
}

/**
 * The theme the page points at the Hypothesis Tracker: the most unhappy
 * tag in the last RECENT_DAYS days (lib/nps tagCounts' order), when it has
 * POINTER_MIN_UNHAPPY or more unhappy answers there; else null. Old
 * complaints don't keep the pointer up, and it reads the window the shared
 * Next step rule does.
 */
export function hypothesisTag(rs: readonly NpsResponse[], today: string): TagCount | null {
  const top = tagCounts(recentResponses(rs, today))[0];
  return top && top.unhappy >= POINTER_MIN_UNHAPPY ? top : null;
}

const signed = (v: number) => (v > 0 ? `+${v}` : String(v));

/** "+20 (n 12)", "— (n 4)" below the minimum, or "—" with no NPS answers. */
export function tagNpsText(t: TagCount): string {
  if (t.nps.n === 0 || t.nps.score === null) return "—";
  return t.nps.n >= MIN_SAMPLE.surveyPeriod
    ? `${signed(t.nps.score)} (n ${t.nps.n})`
    : `— (n ${t.nps.n})`;
}

/** "75% (n 12)", "— (n 4)" below the minimum, or "—" with no CSAT answers. */
export function tagCsatText(t: TagCount): string {
  if (t.csat.n === 0 || t.csat.satisfiedPct === null) return "—";
  return t.csat.n >= MIN_SAMPLE.surveyPeriod
    ? `${t.csat.satisfiedPct}% (n ${t.csat.n})`
    : `— (n ${t.csat.n})`;
}

/**
 * Whether a response is an NPS detractor (0–6) or a dissatisfied CSAT
 * (1–2): what tagCounts counts as unhappy. A score off its scale is neither.
 */
export function isUnhappy(r: NpsResponse): boolean {
  if (!isReadableScore(r.kind, r.score)) return false;
  return r.kind === "nps"
    ? npsCategory(r.score) === "detractor"
    : csatCategory(r.score) === "dissatisfied";
}
