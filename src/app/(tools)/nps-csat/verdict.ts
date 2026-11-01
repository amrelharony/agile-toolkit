/**
 * The NPS / CSAT page's one-sentence verdict and its small-sample warning.
 * Every number is lib/nps's: the headline period is the latest with
 * MIN_SAMPLE.surveyPeriod responses of a kind (latestEnough), compared with
 * the one before it that also had enough; below the minimum the value still
 * shows, with the swing one answer makes (answerSwing, 100 / n points).
 */

import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import {
  answerSwing,
  enoughForPeriod,
  type CsatSummary,
  type NpsSummary,
  type PeriodPoint,
  type SurveyKind,
} from "@/lib/nps/score";

const signed = (v: number) => (v > 0 ? `+${v}` : String(v));
const responses = (n: number) => (n === 1 ? "1 response" : `${n} responses`);

/** The latest period with enough of `kind` before index `before`, or null. */
function enoughBefore(
  points: readonly PeriodPoint[],
  kind: SurveyKind,
  before: number
): PeriodPoint | null {
  for (let i = before - 1; i >= 0; i--) {
    if (kind === "nps" ? points[i].enoughNps : points[i].enoughCsat) return points[i];
  }
  return null;
}

function npsClause(points: readonly PeriodPoint[], all: NpsSummary): string | null {
  if (all.n === 0 || all.score === null) return null;
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    if (!p.enoughNps || p.nps.score === null) continue;
    const prev = enoughBefore(points, "nps", i);
    const moved =
      prev && prev.nps.score !== null
        ? p.nps.score === prev.nps.score
          ? `, the same as ${prev.label}`
          : `, ${p.nps.score > prev.nps.score ? "up" : "down"} from ${signed(prev.nps.score)} in ${prev.label}`
        : "";
    return `${p.label}: NPS ${signed(p.nps.score)} from ${responses(p.nps.n)}${moved}`;
  }
  return `NPS ${signed(all.score)} from ${responses(all.n)} all told (no period has ${MIN_SAMPLE.surveyPeriod} yet; one answer moves it by ${answerSwing(all.n)} points)`;
}

function csatClause(points: readonly PeriodPoint[], all: CsatSummary): string | null {
  if (all.n === 0 || all.satisfiedPct === null) return null;
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    if (!p.enoughCsat || p.csat.satisfiedPct === null) continue;
    const prev = enoughBefore(points, "csat", i);
    const moved =
      prev && prev.csat.satisfiedPct !== null && prev.csat.satisfiedPct !== p.csat.satisfiedPct
        ? `, ${p.csat.satisfiedPct > prev.csat.satisfiedPct ? "up" : "down"} from ${prev.csat.satisfiedPct}% in ${prev.label}`
        : "";
    return `CSAT ${p.csat.satisfiedPct}% satisfied in ${p.label} (${responses(p.csat.n)})${moved}`;
  }
  return `CSAT ${all.satisfiedPct}% satisfied from ${responses(all.n)} all told (no period has ${MIN_SAMPLE.surveyPeriod} yet)`;
}

/**
 * "Oct 2026: NPS +31 from 25 responses, up from +12 in Sep 2026; CSAT 82%
 * satisfied in Oct 2026 (40 responses)."
 */
export function surveyVerdict(
  points: readonly PeriodPoint[],
  all: { nps: NpsSummary; csat: CsatSummary }
): string {
  const parts = [npsClause(points, all.nps), csatClause(points, all.csat)].filter(
    (p): p is string => p !== null
  );
  return parts.length === 0 ? "No responses yet." : `${parts.join("; ")}.`;
}

/**
 * The warning for a period read from too few answers, or null: "Only 6 NPS
 * responses in Oct 2026: one answer moves NPS by 17 points." Empty kinds
 * say nothing (there is no score to misread).
 */
export function thinPeriodWarning(p: PeriodPoint | undefined): string | null {
  if (!p) return null;
  const parts: string[] = [];
  if (p.nps.n > 0 && !enoughForPeriod(p.nps.n)) {
    parts.push(
      `only ${p.nps.n === 1 ? "1 NPS response" : `${p.nps.n} NPS responses`}: one answer moves NPS by ${answerSwing(p.nps.n)} points`
    );
  }
  if (p.csat.n > 0 && !enoughForPeriod(p.csat.n)) {
    parts.push(
      `only ${p.csat.n === 1 ? "1 CSAT response" : `${p.csat.n} CSAT responses`}: one answer moves it by ${answerSwing(p.csat.n)} points`
    );
  }
  if (parts.length === 0) return null;
  const text = parts.join("; ");
  return `${p.label}: ${text}. Read it with care until ${MIN_SAMPLE.surveyPeriod} are in.`;
}
