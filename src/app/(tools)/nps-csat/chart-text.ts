/**
 * The score trend chart in words: a one-sentence summary and the periods
 * as a table, both from the PeriodPoints (lib/nps periodSeries) the chart
 * draws. Every period shows its n: a month with three answers reads
 * differently from one with forty, and below MIN_SAMPLE.surveyPeriod the
 * summary says how many periods were thin.
 */

import { NO_VALUE, listAnd, move, plural, type ChartText } from "@/lib/charts/chart-text";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import type { PeriodPoint, SurveyPeriod } from "@/lib/nps/score";

/** Fewer periods than this and there's no line to draw: the cards say it. */
export const CHART_MIN_PERIODS = 2;

const UNIT: Record<SurveyPeriod, readonly [string, string]> = {
  week: ["week", "weeks"],
  month: ["month", "months"],
};

const signed = (v: number) => (v > 0 ? `+${v}` : String(v));

export function periodTrendText(points: readonly PeriodPoint[], by: SurveyPeriod): ChartText {
  const [one, many] = UNIT[by];
  const npsPoints = points.filter((p) => p.nps.score !== null);
  const csatPoints = points.filter((p) => p.csat.satisfiedPct !== null);
  const clause = (
    label: string,
    list: readonly PeriodPoint[],
    value: (p: PeriodPoint) => number,
    show: (v: number) => string
  ) => {
    if (list.length === 0) return null;
    if (list.length === 1) return `${label} was ${show(value(list[0]))} in ${list[0].label}`;
    return `${label} ${move(value(list[0]), value(list[list.length - 1]), show)}`;
  };
  const clauses = [
    clause("NPS", npsPoints, (p) => p.nps.score as number, signed),
    clause(
      "CSAT",
      csatPoints,
      (p) => p.csat.satisfiedPct as number,
      (v) => `${v}% satisfied`
    ),
  ].filter((c): c is string => c !== null);
  const thin = points.filter(
    (p) => (p.nps.n > 0 && !p.enoughNps) || (p.csat.n > 0 && !p.enoughCsat)
  ).length;

  let summary: string;
  if (points.length === 0 || clauses.length === 0) summary = "No responses yet.";
  else {
    const span =
      points.length === 1
        ? ""
        : ` across ${plural(points.length, one, many)}, ${points[0].label} to ${points[points.length - 1].label}`;
    const note =
      thin > 0
        ? `; ${thin === 1 ? `1 ${one} has` : `${thin} ${many} have`} fewer than ${MIN_SAMPLE.surveyPeriod} responses of a kind, so read ${thin === 1 ? "it" : "them"} with care`
        : "";
    summary = `${listAnd(clauses)}${span}${note}.`;
  }

  return {
    summary,
    table: {
      caption: `NPS (−100 to 100) and CSAT (% satisfied) by ${one}, with the responses behind each`,
      columns: [
        by === "week" ? "Week" : "Month",
        "NPS",
        "NPS responses",
        "CSAT % satisfied",
        "CSAT responses",
      ],
      rows: points.map((p) => [
        p.label,
        p.nps.score === null ? NO_VALUE : signed(p.nps.score),
        p.nps.n > 0 && !p.enoughNps ? `${p.nps.n} (below ${MIN_SAMPLE.surveyPeriod})` : p.nps.n,
        p.csat.satisfiedPct === null ? NO_VALUE : `${p.csat.satisfiedPct}%`,
        p.csat.n > 0 && !p.enoughCsat ? `${p.csat.n} (below ${MIN_SAMPLE.surveyPeriod})` : p.csat.n,
      ]),
    },
  };
}
