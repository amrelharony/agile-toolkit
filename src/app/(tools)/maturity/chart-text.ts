import { MATURITY_DIMENSIONS } from "@/lib/constants/maturity-model";
import type { MaturityAssessmentEntry } from "@/lib/stores/workspace-types";
import { NO_VALUE, type ChartText } from "@/lib/charts/chart-text";
import { MIN_SAMPLE, enoughData } from "@/lib/analytics/min-sample";
import { fitLine } from "@/lib/sprints/metrics";
import { levelOf, summarizeEntry } from "@/lib/maturity/assessment";
import { formatDate } from "@/lib/utils/formatters";

/** Saved assessments a trend line needs: two points make a line. */
export const TREND_MIN_ASSESSMENTS = 2;

export interface TrendPoint {
  /** "Oct 3, 2026". */
  label: string;
  percentage: number;
}

export function trendPoints(saved: readonly MaturityAssessmentEntry[]): TrendPoint[] {
  return saved.map((e) => {
    const s = summarizeEntry(e);
    return { label: formatDate(s.assessedAt), percentage: s.percentage };
  });
}

/**
 * The trend's text alternative: "Overall maturity went from 19% (May 12,
 * 2026) to 31% (Oct 3, 2026) over 3 assessments", and every assessment
 * with its eight dimensions as a table.
 */
export function trendText(saved: readonly MaturityAssessmentEntry[]): ChartText {
  const rows = saved.map((e) => {
    const s = summarizeEntry(e);
    return [
      formatDate(s.assessedAt),
      s.percentage,
      ...MATURITY_DIMENSIONS.map((d) => levelOf(e.scores[d.id]) ?? NO_VALUE),
    ];
  });
  const table = {
    columns: ["Date", "Overall %", ...MATURITY_DIMENSIONS.map((d) => d.name)],
    rows,
    caption: "Maturity assessments, oldest first",
  };
  if (saved.length === 0) return { summary: "No saved assessments yet.", table };
  const first = summarizeEntry(saved[0]);
  const last = summarizeEntry(saved[saved.length - 1]);
  if (saved.length === 1) {
    return {
      summary: `One assessment so far: ${last.percentage}% on ${formatDate(last.assessedAt)}.`,
      table,
    };
  }
  const moved =
    first.percentage === last.percentage
      ? `stayed at ${last.percentage}% from ${formatDate(first.assessedAt)} to ${formatDate(last.assessedAt)}`
      : `went from ${first.percentage}% (${formatDate(first.assessedAt)}) to ${last.percentage}% (${formatDate(last.assessedAt)})`;
  return { summary: `Overall maturity ${moved} over ${saved.length} assessments.`, table };
}

/**
 * The direction of travel, for the Advanced analysis: the least-squares
 * change in overall % per assessment. Only from MIN_SAMPLE.trend saved
 * assessments, so two or three re-scores never read as a trend.
 */
export function trendSlopeText(saved: readonly MaturityAssessmentEntry[]): string | null {
  if (!enoughData(saved.length, "trend")) return null;
  const { slope } = fitLine(saved.map((e) => summarizeEntry(e).percentage));
  const per = Math.round(slope * 10) / 10;
  if (Math.abs(per) < 1) {
    return `Across ${saved.length} assessments the overall score is about level: under 1 point per assessment.`;
  }
  return `Across ${saved.length} assessments the overall score ${per > 0 ? "rises" : "falls"} by about ${Math.abs(per)} points per assessment (least-squares fit).`;
}

export const TREND_NEED = MIN_SAMPLE.trend;

export interface RadarPoint {
  subject: string;
  latest: number;
  previous?: number;
  target: number;
}

export function radarPoints(
  latest: MaturityAssessmentEntry,
  previous: MaturityAssessmentEntry | null,
  target: number
): RadarPoint[] {
  return MATURITY_DIMENSIONS.map((d) => ({
    subject: d.name,
    latest: levelOf(latest.scores[d.id]) ?? 1,
    ...(previous ? { previous: levelOf(previous.scores[d.id]) ?? 1 } : {}),
    target,
  }));
}

/** The radar's text: strongest and weakest, how many reach the target, and the table. */
export function radarText(
  latest: MaturityAssessmentEntry,
  previous: MaturityAssessmentEntry | null,
  target: number
): ChartText {
  const levels = MATURITY_DIMENSIONS.map((d) => ({
    name: d.name,
    level: levelOf(latest.scores[d.id]) ?? 1,
    before: previous ? levelOf(previous.scores[d.id]) : null,
  }));
  const top = Math.max(...levels.map((l) => l.level));
  const low = Math.min(...levels.map((l) => l.level));
  const named = (lvl: number) =>
    levels
      .filter((l) => l.level === lvl)
      .map((l) => l.name)
      .slice(0, 2)
      .join(" and ");
  const atTarget = levels.filter((l) => l.level >= target).length;
  return {
    summary: `Strongest: ${named(top)} (${top}); weakest: ${named(low)} (${low}). ${atTarget} of ${levels.length} dimensions are at or above the target level ${target}.`,
    table: {
      columns: ["Dimension", "Previous", "Latest", "Target"],
      rows: levels.map((l) => [l.name, l.before ?? NO_VALUE, l.level, target]),
      caption: "Maturity by dimension",
    },
  };
}
