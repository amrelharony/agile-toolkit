import { describe, it, expect } from "vitest";
import { latestEnough, periodSeries, summarizeNps } from "@/lib/nps/score";
import type { NpsResponse } from "@/lib/stores/workspace-types";
import { periodTrendText } from "@/app/(tools)/nps-csat/chart-text";

/**
 * NPS / CSAT: the score trend's "NPS" is real NPS for each period
 * (% promoters − % detractors), not the average raw 0–10 score. Since
 * Phase 8 it is read per calendar week or month (lib/nps periodSeries),
 * not per answer day, so a day with one detractor no longer plots −100.
 */

const r = (kind: "nps" | "csat", date: string, score: number, i: number): NpsResponse => ({
  id: `r${i}`,
  kind,
  date,
  score,
});

describe("NPS / CSAT score trend", () => {
  it("plots NPS per month as % promoters minus % detractors", () => {
    const { points } = periodSeries(
      [
        // October: 2 promoters, 1 passive, 1 detractor → (2 − 1) / 4 = +25. Average would be 7.25.
        r("nps", "2026-10-02", 10, 1),
        r("nps", "2026-10-02", 9, 2),
        r("nps", "2026-10-20", 7, 3),
        r("nps", "2026-10-21", 3, 4),
        // September: all detractors → −100. Average would be 4.
        r("nps", "2026-09-01", 6, 5),
        r("nps", "2026-09-30", 2, 6),
        r("csat", "2026-09-01", 4, 7),
        r("csat", "2026-09-02", 5, 8),
      ],
      "month"
    );
    expect(points.map((p) => [p.period, p.nps.score, p.nps.n, p.csat.satisfiedPct])).toEqual([
      ["2026-09", -100, 2, 100],
      ["2026-10", 25, 4, null],
    ]);
  });

  it("leaves NPS empty in a period with only CSAT responses", () => {
    const { points } = periodSeries([r("csat", "2026-10-03", 3, 1)], "month");
    expect(points[0].nps).toMatchObject({ n: 0, score: null });
    expect(points[0].csat).toMatchObject({ n: 1, satisfiedPct: 0 });
    expect(periodTrendText(points, "month").table.rows[0]).toEqual([
      "Oct 2026",
      "—",
      0,
      "0%",
      "1 (below 10)",
    ]);
  });

  it("reads a single full period the same as the headline card", () => {
    const rs = Array.from({ length: 10 }, (_, i) => r("nps", "2026-10-05", i < 6 ? 10 : 1, i));
    const { points } = periodSeries(rs, "week");
    expect(latestEnough(points, "nps")?.nps.score).toBe(summarizeNps(rs).score);
    expect(points[0].period).toBe("2026-W41");
  });
});
