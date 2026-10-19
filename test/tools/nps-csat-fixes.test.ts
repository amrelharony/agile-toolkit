import { describe, it, expect } from "vitest";
import { buildScoreTrend } from "@/app/(tools)/nps-csat/trend";

/**
 * NPS / CSAT: the Score Trend "NPS" line is real NPS for each date
 * (% promoters − % detractors), not the average raw 0–10 score.
 */

describe("NPS / CSAT score trend", () => {
  it("plots NPS per date as % promoters minus % detractors", () => {
    const trend = buildScoreTrend([
      // 2 promoters, 1 passive, 1 detractor → (2 − 1) / 4 = +25. Average would be 7.25.
      { kind: "nps", date: "2026-10-02", score: 10 },
      { kind: "nps", date: "2026-10-02", score: 9 },
      { kind: "nps", date: "2026-10-02", score: 7 },
      { kind: "nps", date: "2026-10-02", score: 3 },
      // All detractors → −100. Average would be 4.
      { kind: "nps", date: "2026-10-01", score: 6 },
      { kind: "nps", date: "2026-10-01", score: 2 },
      { kind: "csat", date: "2026-10-01", score: 4 },
      { kind: "csat", date: "2026-10-01", score: 5 },
    ]);
    expect(trend).toEqual([
      { date: "2026-10-01", nps: -100, csat: 4.5 },
      { date: "2026-10-02", nps: 25, csat: undefined },
    ]);
  });

  it("leaves NPS empty on a date with only CSAT responses", () => {
    expect(buildScoreTrend([{ kind: "csat", date: "2026-10-03", score: 3 }])).toEqual([
      { date: "2026-10-03", nps: undefined, csat: 3 },
    ]);
  });

  it("matches the NPS card's formula when every response is on one date", () => {
    // 3 promoters, 3 passives, 4 detractors → −10.
    const scores = [9, 10, 9, 7, 8, 7, 0, 5, 6, 4];
    const [point] = buildScoreTrend(
      scores.map((score) => ({ kind: "nps" as const, date: "2026-10-04", score }))
    );
    expect(point.nps).toBe(-10);
  });
});
