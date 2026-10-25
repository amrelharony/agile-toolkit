/**
 * The sprint radar in words: a one-sentence summary and the scores as a
 * table (one row per dimension, one column per sprint), both built from the
 * data the radar draws.
 */

import { fmt, listAnd, mean, plural, type ChartText } from "@/lib/charts/chart-text";

type RadarRow = Record<string, string | number | null>;
type Series = { id: string; name: string };

const score = (row: RadarRow, id: string): number | null => {
  const v = row[id];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

export function sprintRadarText(rows: readonly RadarRow[], series: readonly Series[]): ChartText {
  const averages = series.map((s) => ({
    id: s.id,
    name: s.name,
    avg: mean(rows.map((r) => score(r, s.id))),
    scored: rows.filter((r) => score(r, s.id) !== null).length,
  }));
  const scored = averages.filter((a): a is typeof a & { avg: number } => a.avg !== null);

  let summary: string;
  if (scored.length === 0) {
    summary = "No scored sprints yet.";
  } else if (scored.length === 1) {
    const only = scored[0];
    let top: { dim: string; v: number } | null = null;
    for (const r of rows) {
      const v = score(r, only.id);
      if (v !== null && (top === null || v > top.v)) top = { dim: String(r.dimension), v };
    }
    summary = `${only.name} averages ${fmt(only.avg)} out of 10 across ${plural(
      only.scored,
      "scored dimension"
    )}${top ? `; its highest is ${top.dim} (${fmt(top.v)})` : ""}.`;
  } else {
    const byAvg = [...scored].sort((a, b) => b.avg - a.avg);
    const best = byAvg[0];
    const worst = byAvg[byAvg.length - 1];
    summary =
      fmt(best.avg) === fmt(worst.avg)
        ? `${plural(scored.length, "sprint")} compared; all average ${fmt(best.avg)} out of 10.`
        : `${plural(scored.length, "sprint")} compared; ${best.name} has the highest average score (${fmt(
            best.avg
          )} out of 10) and ${worst.name} the lowest (${fmt(worst.avg)}).`;
  }

  // The radar keeps all six axes and skips a sprint's unscored ones, so say so.
  if (scored.length > 0) {
    const nobody = rows
      .filter((r) => series.every((s) => score(r, s.id) === null))
      .map((r) => String(r.dimension));
    const gaps = rows.some((r) => series.some((s) => score(r, s.id) === null));
    if (gaps) {
      summary += ` Each shape leaves out the dimensions its sprint has no score for${
        nobody.length > 0 ? `; none has a score for ${listAnd(nobody)}` : ""
      }.`;
    }
  }

  return {
    summary,
    table: {
      caption: "Scores out of 10 by dimension",
      columns: ["Dimension", ...series.map((s) => s.name)],
      rows: rows.map((r) => [
        String(r.dimension),
        ...series.map((s) => {
          const v = score(r, s.id);
          return v === null ? "Not scored" : v;
        }),
      ]),
    },
  };
}
