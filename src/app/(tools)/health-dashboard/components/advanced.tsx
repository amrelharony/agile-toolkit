"use client";

import { AdvancedAnalysis } from "@/components/shared/advanced-analysis";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import {
  CausalAnnotationList,
  type CausalAnnotationData,
} from "@/components/charts/causal-annotation-list";
import { enoughData } from "@/lib/analytics/min-sample";
import type { HealthKpi } from "@/lib/health-dashboard/kpis";
import { MannKendallChip } from "./kpi-indicators";

/** The KPIs with a series to test, and what one point of it is. */
const SERIES_UNIT: Partial<Record<HealthKpi["id"], readonly [string, string]>> = {
  predictability: ["pointed sprint", "pointed sprints"],
  "team-health": ["saved health check", "saved health checks"],
};

/**
 * Trend tests on the KPIs that have a history (each pointed sprint's
 * say/do, each saved health check) once MIN_SAMPLE.trend points exist, and
 * the cross-tool signals. Closed by default: the verdict and the cards are
 * the headline.
 */
export function DashboardAdvanced({
  kpis,
  signals,
}: {
  kpis: readonly HealthKpi[];
  signals: CausalAnnotationData[];
}) {
  const tested = kpis.filter((k) => SERIES_UNIT[k.id]);
  return (
    <AdvancedAnalysis summary="Advanced analysis: trends and cross-tool signals">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-text">Trends (Mann-Kendall)</h3>
        <ul className="space-y-2">
          {tested.map((k) => {
            const series = k.series ?? [];
            return (
              <li key={k.id}>
                {enoughData(series.length, "trend") ? (
                  <MannKendallChip
                    label={k.id === "predictability" ? "Say/do per sprint" : k.name}
                    series={series}
                    higherIsBetter={k.higherIsBetter}
                  />
                ) : (
                  <NotEnoughData
                    have={series.length}
                    need="trend"
                    unit={SERIES_UNIT[k.id]!}
                    action="Add"
                    what={`a trend in ${k.name.toLowerCase()}`}
                  />
                )}
              </li>
            );
          })}
        </ul>
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-text">Cross-tool signals</h3>
        {signals.length > 0 ? (
          <>
            <p className="text-xs text-sub">
              Event streams in your workspace history that tend to move together. Hints to look
              into, not proof of cause.
            </p>
            <CausalAnnotationList annotations={signals} />
          </>
        ) : (
          <p className="text-sm text-sub">
            No pair of event streams moves together often enough to show yet.
          </p>
        )}
      </section>
    </AdvancedAnalysis>
  );
}
