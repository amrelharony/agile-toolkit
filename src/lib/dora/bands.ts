/**
 * The DORA performance bands, as data with the report they come from, so
 * the DORA Scorecard page, its Markdown export, tool.dora_scorecard and the
 * guide band a number the same way and can say whose bands they are.
 *
 * The bands follow the four performance clusters of the 2023 Accelerate
 * State of DevOps Report (DORA, Google Cloud), the report the scorecard's
 * old comment cited. Its table describes each cluster by the typical values
 * of its teams:
 *
 *   Cluster  Deploys                     Lead time        Change failure  Recovery
 *   Elite    On demand                   < 1 day          5%              < 1 hour
 *   High     Once a day – once a week    1 day – 1 week   10%             < 1 day
 *   Medium   Once a week – once a month  1 week – 1 month 15%             1 day – 1 week
 *   Low      Once a week – once a month  1 week – 1 month 64%             1 month – 6 months
 *
 * A cluster is a group of teams, not a cut-off, so the boundaries here are
 * read off that table: a value is in the best band whose range it is in or
 * beats. Two things follow. In 2023 the Low cluster deployed as often and as
 * fast as the Medium one, so deploy frequency and lead time can't tell those
 * two apart: a value inside Medium's range reads Medium, and only a value
 * slower than every cluster (deploys rarer than monthly, lead time over a
 * month) reads Low. Change failure is a single rate per cluster, so a band
 * holds the rates at or under its cluster's (7% is worse than Elite's 5% and
 * better than High's 10%: High). A boundary value goes to the better band,
 * as the scorecard always did: exactly one day of lead time is Elite.
 *
 * The old bands mixed sources: change failure at 15 / 30 / 45% matched no
 * report, and Elite deploys started at 14 a week. Saved samples keep their
 * numbers; only the band shown next to them follows this table.
 */

export type DoraBand = "Elite" | "High" | "Medium" | "Low";

/** Best first. */
export const DORA_BAND_ORDER: readonly DoraBand[] = ["Elite", "High", "Medium", "Low"];

export type DoraMetric = "deployFreqPerWeek" | "leadTimeHours" | "changeFailRate" | "mttrHours";

export const DORA_METRICS: readonly DoraMetric[] = [
  "deployFreqPerWeek",
  "leadTimeHours",
  "changeFailRate",
  "mttrHours",
];

export interface DoraBandTable {
  /** The report the bands come from. */
  report: string;
  /** Who publishes it. */
  publisher: string;
  year: number;
  /** Deploy frequency is better higher; the other three lower. */
  higherIsBetter: Record<DoraMetric, boolean>;
  /**
   * Where each band starts, in the metric's stored unit (deploys a week,
   * hours, a 0–1 rate). Higher-is-better: Elite from `elite` up, High from
   * `high`, Medium from `medium`, Low below. Lower-is-better: Elite up to
   * `elite`, and so on, Low above `medium`.
   */
  cut: Record<DoraMetric, { elite: number; high: number; medium: number }>;
  /** The report's own words for each cluster and metric. */
  clusters: Record<DoraBand, Record<DoraMetric, string>>;
  /** How the boundaries were read off the report's table. */
  note: string;
}

const HOURS_PER_DAY = 24;
const HOURS_PER_WEEK = 7 * HOURS_PER_DAY;
/** A month of lead time, as the scorecard always counted it. */
const HOURS_PER_MONTH = 30 * HOURS_PER_DAY;
/** Once a month, in deploys a week. */
const MONTHLY = 12 / 52;

export const DORA_BANDS: DoraBandTable = {
  report: "Accelerate State of DevOps Report",
  publisher: "DORA (Google Cloud)",
  year: 2023,
  higherIsBetter: {
    deployFreqPerWeek: true,
    leadTimeHours: false,
    changeFailRate: false,
    mttrHours: false,
  },
  cut: {
    // On demand (several a day) from daily up; at least weekly; at least monthly.
    deployFreqPerWeek: { elite: 7, high: 1, medium: MONTHLY },
    leadTimeHours: { elite: HOURS_PER_DAY, high: HOURS_PER_WEEK, medium: HOURS_PER_MONTH },
    changeFailRate: { elite: 0.05, high: 0.1, medium: 0.15 },
    mttrHours: { elite: 1, high: HOURS_PER_DAY, medium: HOURS_PER_WEEK },
  },
  clusters: {
    Elite: {
      deployFreqPerWeek: "on demand",
      leadTimeHours: "under a day",
      changeFailRate: "5%",
      mttrHours: "under an hour",
    },
    High: {
      deployFreqPerWeek: "once a day to once a week",
      leadTimeHours: "a day to a week",
      changeFailRate: "10%",
      mttrHours: "under a day",
    },
    Medium: {
      deployFreqPerWeek: "once a week to once a month",
      leadTimeHours: "a week to a month",
      changeFailRate: "15%",
      mttrHours: "a day to a week",
    },
    Low: {
      deployFreqPerWeek: "once a week to once a month",
      leadTimeHours: "a week to a month",
      changeFailRate: "64%",
      mttrHours: "a month to six months",
    },
  },
  note: "Each band starts where the cluster's range in the report's table does; a value slower than every cluster is Low. Change failure: at or under the cluster's rate. A boundary value goes to the better band.",
};

/**
 * The band of `value` for `metric`, or null when it isn't a number of that
 * kind (not finite, or negative): a missing measurement has no band, where
 * the old code called it Low.
 */
export function doraBand(
  metric: DoraMetric,
  value: number | null | undefined,
  table: DoraBandTable = DORA_BANDS
): DoraBand | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const c = table.cut[metric];
  if (table.higherIsBetter[metric]) {
    if (value >= c.elite) return "Elite";
    if (value >= c.high) return "High";
    if (value >= c.medium) return "Medium";
    return "Low";
  }
  if (value <= c.elite) return "Elite";
  if (value <= c.high) return "High";
  if (value <= c.medium) return "Medium";
  return "Low";
}

/** 0 for Elite to 3 for Low: lower is better. */
export const bandRank = (band: DoraBand): number => DORA_BAND_ORDER.indexOf(band);

/** "Accelerate State of DevOps Report 2023, DORA (Google Cloud)": whose bands they are. */
export function bandsCitation(table: DoraBandTable = DORA_BANDS): string {
  return `${table.report} ${table.year}, ${table.publisher}`;
}

export const DORA_METRIC_LABEL: Record<DoraMetric, string> = {
  deployFreqPerWeek: "Deploy frequency",
  leadTimeHours: "Lead time",
  changeFailRate: "Change failure rate",
  mttrHours: "Time to restore",
};

const round = (n: number, digits: number) => {
  const f = 10 ** digits;
  const r = Math.round(n * f) / f;
  return Object.is(r, -0) ? 0 : r;
};

/** Hours as the scorecard shows them: "45 min", "6 h", "3 days", "5 weeks". */
export function formatHours(hours: number): string {
  if (!Number.isFinite(hours)) return "—";
  if (hours < 1) return `${round(hours * 60, 0)} min`;
  if (hours < 48) return `${round(hours, 1)} h`;
  if (hours < 14 * HOURS_PER_DAY) return `${round(hours / HOURS_PER_DAY, 1)} days`;
  return `${round(hours / HOURS_PER_WEEK, 1)} weeks`;
}

/** A metric's value in words: "2.5 a week", "36 h", "12%", "4 h". */
export function formatMetric(metric: DoraMetric, value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (metric === "deployFreqPerWeek") return `${round(value, 2)} a week`;
  if (metric === "changeFailRate") return `${round(value * 100, 1)}%`;
  return formatHours(value);
}

/** Where a band starts, in words: "7+ a week", "up to 1 day", "up to 10%". */
function cutText(metric: DoraMetric, value: number): string {
  if (metric === "deployFreqPerWeek") {
    return value === MONTHLY ? "monthly or more" : `${round(value, 2)}+ a week`;
  }
  if (metric === "changeFailRate") return `up to ${round(value * 100, 1)}%`;
  if (value === HOURS_PER_DAY) return "up to 1 day";
  if (value === HOURS_PER_WEEK) return "up to 1 week";
  if (value === HOURS_PER_MONTH) return "up to 30 days";
  return `up to ${formatHours(value)}`;
}

/**
 * Each band's range for `metric` in words, best first: what the guide's
 * scale, the page's legend and the export print.
 */
export function bandRanges(
  metric: DoraMetric,
  table: DoraBandTable = DORA_BANDS
): { band: DoraBand; range: string; cluster: string }[] {
  const c = table.cut[metric];
  const low = table.higherIsBetter[metric]
    ? metric === "deployFreqPerWeek"
      ? "rarer than monthly"
      : `under ${round(c.medium, 2)}`
    : metric === "changeFailRate"
      ? `over ${round(c.medium * 100, 1)}%`
      : `over ${cutText(metric, c.medium).replace(/^up to /, "")}`;
  return [
    { band: "Elite", range: cutText(metric, c.elite), cluster: table.clusters.Elite[metric] },
    { band: "High", range: cutText(metric, c.high), cluster: table.clusters.High[metric] },
    { band: "Medium", range: cutText(metric, c.medium), cluster: table.clusters.Medium[metric] },
    { band: "Low", range: low, cluster: table.clusters.Low[metric] },
  ];
}
