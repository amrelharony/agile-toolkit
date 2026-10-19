/**
 * NPS / CSAT Score Trend — one point per response date.
 *
 * `nps` is the real Net Promoter Score for that date's NPS responses
 * (% promoters (9–10) − % detractors (0–6), −100..+100), the same formula as
 * the NPS card. It used to be the average raw 0–10 score, labelled "NPS".
 * `csat` is the average CSAT score (1–5) for that date.
 */

export interface TrendResponse {
  kind: "nps" | "csat";
  date: string;
  score: number;
}

export interface TrendPoint {
  date: string;
  nps?: number;
  csat?: number;
}

export function buildScoreTrend(entries: TrendResponse[]): TrendPoint[] {
  const byDate = new Map<
    string,
    { promoters: number; detractors: number; npsCount: number; csatSum: number; csatCount: number }
  >();
  for (const e of entries) {
    const cur = byDate.get(e.date) ?? {
      promoters: 0,
      detractors: 0,
      npsCount: 0,
      csatSum: 0,
      csatCount: 0,
    };
    if (e.kind === "nps") {
      cur.npsCount += 1;
      if (e.score >= 9) cur.promoters += 1;
      else if (e.score <= 6) cur.detractors += 1;
    } else {
      cur.csatSum += e.score;
      cur.csatCount += 1;
    }
    byDate.set(e.date, cur);
  }
  return Array.from(byDate.entries())
    .map(([date, d]) => ({
      date,
      nps:
        d.npsCount > 0 ? Math.round(((d.promoters - d.detractors) / d.npsCount) * 100) : undefined,
      csat: d.csatCount > 0 ? d.csatSum / d.csatCount : undefined,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
