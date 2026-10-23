"use client";

import { useId } from "react";
import dynamic from "next/dynamic";
import { AdvancedAnalysis } from "@/components/shared/advanced-analysis";
import { CalloutAlert } from "@/components/shared/callout-alert";
import { ChartFigure } from "@/components/shared/chart-card";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { fmt } from "@/lib/charts/chart-text";
import { TREND_TEST_MIN, passRateAnalysis, trendSentence } from "./analysis";
import type { PassRecord } from "./session";

// Recharts loads with the chart, not the page; the fixed-height box below
// reserves the space while it does.
const PassRateTrendChart = dynamic(() => import("./charts").then((m) => m.PassRateTrendChart), {
  ssr: false,
});

const CHECKS = ["story check", "story checks"] as const;

/**
 * The Definition of Ready pass rate over time, its trend test and control
 * limits, closed by default: the headline above is the plain count of
 * ready stories, and these only say something once enough stories have
 * been checked.
 */
export function PassRateAdvanced({ records }: { records: readonly PassRecord[] }) {
  const headingId = useId();
  const a = passRateAnalysis(records);
  const n = a.window.length;

  return (
    <AdvancedAnalysis summary="Advanced analysis: pass-rate trend">
      <h3 id={headingId} className="text-sm font-semibold text-text">
        Definition of Ready pass rate
      </h3>
      {!a.chart ? (
        <NotEnoughData
          have={n}
          need="trend"
          unit={CHECKS}
          action="Record"
          what="the pass-rate trend"
        />
      ) : (
        <>
          <ChartFigure
            labelledBy={headingId}
            summary={a.chart.summary}
            table={a.chart.table}
            caption="Pass rate per check"
            plotClassName="h-[220px]"
          >
            <PassRateTrendChart
              data={a.window.map((r) => ({ name: r.name, passRate: r.passRate }))}
              control={a.control}
            />
          </ChartFigure>
          {a.trend ? (
            <p className="text-sm text-text">{trendSentence(a.trend)}</p>
          ) : (
            <NotEnoughData
              have={n}
              need={TREND_TEST_MIN}
              unit={CHECKS}
              action="Record"
              what="a trend test"
            />
          )}
          {a.control ? (
            <p className="text-xs text-sub">
              Control limits (p-chart over the last {n} checks): centre{" "}
              {fmt(a.control.centerLinePct, 0)}%, upper {fmt(a.control.uclPct, 0)}%, lower{" "}
              {fmt(a.control.lclPct, 0)}%.
            </p>
          ) : (
            <NotEnoughData
              have={n}
              need={MIN_SAMPLE.changePoint}
              unit={CHECKS}
              action="Record"
              what="control limits"
            />
          )}
          {a.drift && a.control && (
            <CalloutAlert tone="warning">
              <strong className="font-semibold">Readiness is drifting:</strong> the last 9 checks
              all sit on one side of the long-run pass rate ({fmt(a.control.centerLinePct, 0)}%).
              Look at what changed before it becomes the new normal.
            </CalloutAlert>
          )}
        </>
      )}
    </AdvancedAnalysis>
  );
}
