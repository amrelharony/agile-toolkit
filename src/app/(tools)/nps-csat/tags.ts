/**
 * How the themes table words a tag's own scores, on the page and in the
 * Markdown alike: a tag's NPS or CSAT shows from MIN_SAMPLE.surveyPeriod
 * responses (a tag on three answers would read as a finding), and below it
 * only its n. The counts are lib/nps tagCounts'.
 */

import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { csatCategory, isReadableScore, npsCategory, type TagCount } from "@/lib/nps/score";
import type { NpsResponse } from "@/lib/stores/workspace-types";

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
