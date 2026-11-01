"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { AdvancedAnalysis } from "@/components/shared/advanced-analysis";
import { ChartFigure } from "@/components/shared/chart-card";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { offDayRanges, type BurnSeries } from "@/lib/sprints/burn";
import { burnAnalysis, forecastText, type BurnPick } from "./analysis";

// Recharts loads with the chart, and only once the section is opened and has data.
const ForecastChart = dynamic(() => import("./charts").then((m) => m.ForecastChart), {
  ssr: false,
  loading: () => <div className="h-[240px]" />,
});

const WORKING_DAYS = ["working day", "working days"] as const;

/**
 * Holt's forecast, CUSUM's pace shifts and (Burnup) the Mann-Kendall trend
 * test, closed by default: the verdict, the tiles and the chart above are
 * the headline. Each fits the working-day samples of the burn shown, and
 * says how many more days it needs until it has its minimum sample.
 */
export function BurnAdvanced({
  burn,
  pick,
  trend = false,
}: {
  burn: BurnSeries;
  pick: BurnPick;
  /** Run the Mann-Kendall trend test too (Burnup). */
  trend?: boolean;
}) {
  const analysis = useMemo(() => burnAnalysis(burn, pick, { trend }), [burn, pick, trend]);
  const text = useMemo(() => forecastText(analysis, pick), [analysis, pick]);
  const offDays = useMemo(() => offDayRanges(burn), [burn]);
  const n = analysis.samples.length;
  const name = pick === "remaining" ? "Points left" : "Points done";
  // The board fills its days in itself: there is nothing to log, only days to wait for.
  const action = burn.source === "stories" ? "Wait for" : "Log";

  return (
    <AdvancedAnalysis summary="Advanced analysis: forecast and pace shifts">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-text">Forecast</h3>
        {analysis.forecastReady ? (
          <ChartFigure
            label={`Forecast of the ${name.toLowerCase()}`}
            summary={text.summary}
            table={text.table}
          >
            <ForecastChart
              data={analysis.rows}
              name={name}
              shifts={analysis.shifts}
              offDays={offDays}
              todayDay={burn.todayDay}
            />
          </ChartFigure>
        ) : (
          <NotEnoughData
            have={n}
            need="forecast"
            unit={WORKING_DAYS}
            action={action}
            what="a forecast"
          />
        )}
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-text">Pace shifts</h3>
        {analysis.shiftsReady ? (
          <p className="text-sm text-text">
            {analysis.shifts.length === 0
              ? `CUSUM sees no lasting shift in the pace over ${n} working days.`
              : `CUSUM sees the pace shift around ${analysis.shifts
                  .map((s) => `day ${s.day} (${s.direction === "up" ? "up" : "down"})`)
                  .join(", ")}.`}
          </p>
        ) : (
          <NotEnoughData
            have={n}
            need="changePoint"
            unit={WORKING_DAYS}
            action={action}
            what="pace shifts"
          />
        )}
      </section>
      {trend && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-text">Trend test</h3>
          {analysis.trend ? (
            <p className="text-sm text-text">
              {analysis.trend.significant
                ? `Mann-Kendall: the points done trend ${
                    analysis.trend.trend === "up" ? "up" : "down"
                  } (p = ${analysis.trend.pValue.toFixed(2)}).`
                : `Mann-Kendall: no significant trend (p = ${analysis.trend.pValue.toFixed(2)}).`}
            </p>
          ) : (
            <NotEnoughData
              have={n}
              need="trend"
              unit={WORKING_DAYS}
              action={action}
              what="a trend test"
            />
          )}
        </section>
      )}
    </AdvancedAnalysis>
  );
}
