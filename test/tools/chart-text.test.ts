import { describe, it, expect } from "vitest";
import { burndownChartText } from "@/app/(tools)/burndown/chart-text";
import { burnupChartText } from "@/app/(tools)/burnup/chart-text";
import { velocityChartText } from "@/app/(tools)/velocity/chart-text";
import { sprintRadarText } from "@/app/(tools)/sprint-compare/chart-text";
import { doraTrendText } from "@/app/(tools)/dora-scorecard/chart-text";
import { flowChartText, wipChartText } from "@/app/(tools)/cumulative-flow/chart-text";
import { simulationHistogramText } from "@/app/(tools)/release-planner/chart-text";
import { healthTrendText } from "@/app/(tools)/health-check/chart-text";
import { histogramText } from "@/app/(tools)/cycle-time/chart-text";
import { scoreTrendText } from "@/app/(tools)/nps-csat/chart-text";
import { dailyMoodText } from "@/app/(tools)/mood-tracker/chart-text";
import { fmt, move, plural } from "@/lib/charts/chart-text";

/**
 * Each chart's summary sentence and table come from the data it plots, so
 * they read the same numbers a sighted user sees.
 */

describe("chart-text helpers", () => {
  it("rounds, pluralises and describes a move", () => {
    expect(fmt(6.649)).toBe("6.6");
    expect(fmt(-0.01)).toBe("0");
    expect(plural(1, "day")).toBe("1 day");
    expect(plural(3, "day")).toBe("3 days");
    expect(move(40, 27)).toBe("fell from 40 to 27");
    expect(move(2, 5)).toBe("rose from 2 to 5");
    expect(move(8, 8.01)).toBe("stayed at 8");
  });
});

describe("burndown", () => {
  // A 10-day sprint of 40 points: the ideal line drops 4 a day.
  const rows = (actual: (number | null)[]) =>
    Array.from({ length: 11 }, (_, day) => ({
      day,
      ideal: 40 - 4 * day,
      actual: actual[day] ?? null,
    }));

  it("says how far remaining moved and where it sits against the ideal line", () => {
    expect(burndownChartText(rows([40, 37, 35, 31, 30, 27])).summary).toBe(
      "Remaining points fell from 40 to 27 over 5 days; 7 points behind the ideal line."
    );
    expect(burndownChartText(rows([40, 30, 25, 22, 20, 18])).summary).toBe(
      "Remaining points fell from 40 to 18 over 5 days; 2 points ahead of the ideal line."
    );
    // The shared gap: on the line only at 0, never within a local half-point.
    expect(burndownChartText(rows([40, 36, 32, 28.4])).summary).toBe(
      "Remaining points fell from 40 to 28.4 over 3 days; 0.4 points behind the ideal line."
    );
    expect(burndownChartText(rows([40, 36, 32, 28])).summary).toBe(
      "Remaining points fell from 40 to 28 over 3 days; on the ideal line."
    );
    expect(burndownChartText(rows([40])).summary).toBe(
      "No days logged yet; the ideal line falls from 40 points to 0 by day 10."
    );
  });

  it("tables every day, with the forecast columns only when there is one", () => {
    const plain = burndownChartText(rows([40, 37]));
    expect(plain.table.columns).toEqual(["Day", "Ideal", "Remaining"]);
    expect(plain.table.rows[2]).toEqual([2, 32, "—"]);

    const withForecast = rows([40, 37]);
    Object.assign(withForecast[2], { forecast: 33.46, band80Lower: 30, band80Upper: 36.9 });
    const t = burndownChartText(withForecast).table;
    expect(t.columns).toEqual(["Day", "Ideal", "Remaining", "Forecast", "80% range"]);
    expect(t.rows[2]).toEqual([2, 32, "—", 33.5, "30–36.9"]);
    expect(t.rows[1]).toEqual([1, 36, 37, "—", "—"]);
  });
});

describe("burnup", () => {
  it("gives points done against the scope in force and how the scope moved", () => {
    const completed = [0, 4, 9, 12];
    const rows = Array.from({ length: 11 }, (_, day) => ({
      day,
      scope: day < 3 ? 30 : 34,
      completed: completed[day] ?? null,
      forecast: undefined,
      band80Lower: undefined,
      band80Upper: undefined,
    }));
    const text = burnupChartText(rows);
    expect(text.summary).toBe(
      "12 of 34 points done by day 3 (35%); scope rose from 30 to 34 points."
    );
    expect(text.table.columns).toEqual(["Day", "Scope", "Done"]);
    expect(text.table.rows[4]).toEqual([4, 34, "—"]);

    const none = rows.map((r) => ({ ...r, scope: 30, completed: r.day === 0 ? 0 : null }));
    expect(burnupChartText(none).summary).toBe("No points logged yet; scope stayed at 30 points.");
  });
});

describe("velocity", () => {
  const rows = [
    { name: "Sprint 1", committed: 20, completed: 18 },
    { name: "Sprint 2", committed: 25, completed: 22 },
    // The last finished sprint carries the band's bridge point.
    {
      name: "Sprint 3",
      committed: 30,
      completed: 26,
      forecast: 26,
      band80Lower: 0,
      band80Upper: 26,
    },
    { name: "Sprint 4", committed: 28, completed: null },
    {
      name: "Next",
      committed: 0,
      completed: null,
      forecast: 27.4,
      band80Lower: 21,
      band80Upper: 33.8,
      forecastOnly: true,
    },
  ];

  it("averages the finished sprints and gives the last one and the forecast", () => {
    expect(velocityChartText(rows).summary).toBe(
      "Completed points averaged 22 over 3 finished sprints; Sprint 3 completed 26 of 30 committed, and the next sprint is forecast at 27.4."
    );
    expect(velocityChartText([{ name: "Sprint 1", committed: 20, completed: null }]).summary).toBe(
      "No finished sprints yet; 1 sprint planned."
    );
  });

  it("shows the forecast only on the forecast row", () => {
    const t = velocityChartText(rows).table;
    expect(t.columns).toEqual(["Sprint", "Committed", "Completed", "Forecast", "80% range"]);
    expect(t.rows[2]).toEqual(["Sprint 3", 30, 26, "—", "—"]);
    expect(t.rows[3]).toEqual(["Sprint 4", 28, "—", "—", "—"]);
    expect(t.rows[4]).toEqual(["Next", "—", "—", 27.4, "21–33.8"]);
  });
});

describe("sprint compare", () => {
  const rows = [
    { dimension: "Velocity", a: 6, b: 9 },
    { dimension: "Quality", a: 7, b: 8 },
    { dimension: "Morale", a: 8, b: null },
  ];
  const a = { id: "a", name: "Sprint 7" };
  const b = { id: "b", name: "Sprint 8" };

  it("names the highest and lowest average", () => {
    const text = sprintRadarText(rows, [a, b]);
    expect(text.summary).toBe(
      "2 sprints compared; Sprint 8 has the highest average score (8.5 out of 10) and Sprint 7 the lowest (7)."
    );
    expect(text.table.columns).toEqual(["Dimension", "Sprint 7", "Sprint 8"]);
    expect(text.table.rows[2]).toEqual(["Morale", 8, "Not scored"]);
  });

  it("describes a single sprint by its average and best dimension", () => {
    expect(sprintRadarText(rows, [a]).summary).toBe(
      "Sprint 7 averages 7 out of 10 across 3 scored dimensions; its highest is Morale (8)."
    );
  });
});

describe("DORA scorecard", () => {
  it("gives each metric's move from the first quarter to the last", () => {
    const rows = [
      {
        quarter: "2026-Q1",
        deployFreqPerWeek: 2,
        leadTimeHours: 48,
        changeFailRatePct: 15,
        mttrHours: 6,
      },
      {
        quarter: "2026-Q2",
        deployFreqPerWeek: 2.5,
        leadTimeHours: 36,
        changeFailRatePct: 15,
        mttrHours: 4,
      },
      {
        quarter: "2026-Q3",
        deployFreqPerWeek: 5,
        leadTimeHours: 20,
        changeFailRatePct: 8,
        mttrHours: 2,
      },
    ];
    const text = doraTrendText(rows);
    expect(text.summary).toBe(
      "From 2026-Q1 to 2026-Q3, deploys a week rose from 2 to 5, lead time fell from 48 hours to 20 hours, change failure rate fell from 15% to 8% and time to restore fell from 6 hours to 2 hours."
    );
    expect(text.table.rows[1]).toEqual(["2026-Q2", 2.5, 36, 15, 4]);
    expect(doraTrendText([]).summary).toBe("No quarters added yet.");
  });
});

describe("cumulative flow", () => {
  const columns = [
    { id: "1", name: "To Do", color: "#64748b" },
    { id: "2", name: "In Progress", color: "#00f0ff" },
    { id: "3", name: "In Review", color: "#ff00aa" },
    { id: "4", name: "Done", color: "#00ff88" },
  ];

  it("follows the last column and the work in progress", () => {
    const rows = [
      { date: "2026-10-01", "To Do": 10, "In Progress": 3, "In Review": 1, Done: 2 },
      { date: "2026-10-12", "To Do": 4, "In Progress": 5, "In Review": 4, Done: 14 },
    ];
    const text = flowChartText(rows, columns);
    expect(text.summary).toBe(
      "Done rose from 2 to 14 items between 2026-10-01 and 2026-10-12; 9 items in progress on the last day."
    );
    expect(text.table.columns).toEqual(["Date", "To Do", "In Progress", "In Review", "Done"]);
    expect(text.table.rows[1]).toEqual(["2026-10-12", 4, 5, 4, 14]);
  });

  it("counts out-of-control points once and checks the WIP limit", () => {
    const series = [
      { date: "2026-10-01", value: 4 },
      { date: "2026-10-02", value: 6 },
      { date: "2026-10-03", value: 9 },
      { date: "2026-10-04", value: 5 },
    ];
    const signals = [
      { index: 2, rule: "Rule 1", description: "beyond 3σ" },
      { index: 2, rule: "Rule 2", description: "2 of 3 beyond 2σ" },
    ];
    expect(wipChartText(series, signals, 8).summary).toBe(
      "WIP rose from 4 to 5 over 4 snapshots, ranging from 4 to 9; 1 point out of control; above the WIP limit of 8 on 1 snapshot."
    );
  });
});

describe("release planner", () => {
  it("gives the percentiles and the share of runs within the target", () => {
    const text = simulationHistogramText({
      histogram: [
        { sprints: 4, count: 1000 },
        { sprints: 5, count: 4000 },
        { sprints: 6, count: 3500 },
        { sprints: 7, count: 1500 },
      ],
      total: 10_000,
      p50: 5,
      p85: 6,
      p95: 7,
      target: 6,
    });
    expect(text.summary).toBe(
      "In 10,000 simulated runs, half finish within 5 sprints, 85% within 6 and 95% within 7; 85% finish within the target of 6 sprints."
    );
    expect(text.table.rows[1]).toEqual([5, 4000, "40%"]);
  });

  it("doesn't repeat a percentile that equals a higher one", () => {
    const base = { total: 10_000, target: null };
    const spread = [
      { sprints: 6, count: 200 },
      { sprints: 7, count: 9700 },
      { sprints: 8, count: 100 },
    ];
    expect(
      simulationHistogramText({ ...base, histogram: spread, p50: 7, p85: 7, p95: 7 }).summary
    ).toBe("In 10,000 simulated runs, 95% finish within 7 sprints.");
    expect(
      simulationHistogramText({
        ...base,
        histogram: [{ sprints: 7, count: 10_000 }],
        p50: 7,
        p85: 7,
        p95: 7,
      }).summary
    ).toBe("In 10,000 simulated runs, every run finishes in 7 sprints.");
  });
});

describe("health check", () => {
  it("counts the latest check's lights and names them in the table", () => {
    const light = (g: number[]) => ({
      "Delivering Value": g[0],
      "Easy to Release": g[1],
      Fun: g[2],
      "Health of Codebase": g[3],
      Learning: g[4],
      Mission: g[5],
      Speed: g[6],
      Teamwork: g[7],
    });
    const text = healthTrendText([
      { name: "Sprint 1", ...light([1, 1, 1, 1, 1, 1, 1, 1]) },
      { name: "Sprint 2", ...light([2, 2, 2, 2, 2, 1, 1, 0]) },
    ]);
    expect(text.summary).toBe(
      "2 checks from Sprint 1 to Sprint 2; the latest has 5 green, 2 yellow and 1 red of 8 dimensions."
    );
    expect(text.table.rows[1].slice(0, 2)).toEqual(["Sprint 2", "Green"]);
    expect(text.table.rows[1][8]).toBe("Red");
  });
});

describe("cycle time, NPS / CSAT and mood", () => {
  it("summarises the cycle-time histogram", () => {
    const bars = [
      { bucket: "≤1 day", count: 2 },
      { bucket: "2 days", count: 3 },
      { bucket: "3-4 days", count: 5 },
      { bucket: "5-7 days", count: 2 },
      { bucket: "8-14 days", count: 1 },
      { bucket: "15+ days", count: 0 },
    ];
    expect(histogramText(bars, { median: 3, p85: 7 }, 14).summary).toBe(
      "13 items: half finished within 3 days, 85% within 7 and 95% within 14; the most common range is 3-4 days (5 items)."
    );
  });

  it("summarises the score trend", () => {
    const text = scoreTrendText([
      { date: "2026-10-01", nps: -20, csat: 3.8 },
      { date: "2026-10-02", nps: 10 },
      { date: "2026-10-03", nps: 35, csat: 4.25 },
    ]);
    expect(text.summary).toBe(
      "NPS rose from -20 to 35 and CSAT rose from 3.8 to 4.3 across 3 dates, 2026-10-01 to 2026-10-03."
    );
    expect(text.table.rows[1]).toEqual(["2026-10-02", 10, "—"]);
  });

  it("summarises the daily-average mood", () => {
    expect(
      dailyMoodText([
        { date: "2026-10-01", avg: 3.5 },
        { date: "2026-10-02", avg: 4 },
        { date: "2026-10-03", avg: 3.2 },
      ]).summary
    ).toBe(
      "Daily average mood fell from 3.5 to 3.2 out of 5 over 3 days with entries, from 2026-10-01 to 2026-10-03; lowest 3.2, highest 4."
    );
  });
});
