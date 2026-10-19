/**
 * The sprint radar in words: a one-sentence summary and the ratings as a
 * table (one row per dimension, one column per sprint), both built from the
 * data the radar draws.
 */

import { fmt, mean, plural, type ChartText } from "@/lib/charts/chart-text";

type RadarRow = Record<string, string | number | null>;
type Series = { id: string; name: string };

const rating = (row: RadarRow, id: string): number | null => {
  const v = row[id];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

export function sprintRadarText(rows: readonly RadarRow[], series: readonly Series[]): ChartText {
  const averages = series.map((s) => ({
    id: s.id,
    name: s.name,
    avg: mean(rows.map((r) => rating(r, s.id))),
    rated: rows.filter((r) => rating(r, s.id) !== null).length,
  }));
  const rated = averages.filter((a): a is typeof a & { avg: number } => a.avg !== null);

  let summary: string;
  if (rated.length === 0) {
    summary = "No rated sprints yet.";
  } else if (rated.length === 1) {
    const only = rated[0];
    let top: { dim: string; v: number } | null = null;
    for (const r of rows) {
      const v = rating(r, only.id);
      if (v !== null && (top === null || v > top.v)) top = { dim: String(r.dimension), v };
    }
    summary = `${only.name} averages ${fmt(only.avg)} out of 10 across ${plural(
      only.rated,
      "rated dimension"
    )}${top ? `; its highest is ${top.dim} (${fmt(top.v)})` : ""}.`;
  } else {
    const byAvg = [...rated].sort((a, b) => b.avg - a.avg);
    const best = byAvg[0];
    const worst = byAvg[byAvg.length - 1];
    summary =
      fmt(best.avg) === fmt(worst.avg)
        ? `${plural(rated.length, "sprint")} compared; all average ${fmt(best.avg)} out of 10.`
        : `${plural(rated.length, "sprint")} compared; ${best.name} has the highest average rating (${fmt(
            best.avg
          )} out of 10) and ${worst.name} the lowest (${fmt(worst.avg)}).`;
  }

  return {
    summary,
    table: {
      caption: "Ratings out of 10 by dimension",
      columns: ["Dimension", ...series.map((s) => s.name)],
      rows: rows.map((r) => [
        String(r.dimension),
        ...series.map((s) => {
          const v = rating(r, s.id);
          return v === null ? "Not rated" : v;
        }),
      ]),
    },
  };
}
