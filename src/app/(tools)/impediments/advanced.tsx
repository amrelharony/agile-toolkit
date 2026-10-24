"use client";

import { AdvancedAnalysis } from "@/components/shared/advanced-analysis";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { TREND_TEST_MIN, type ImpedimentAnalysis } from "./analysis";

const WEEKS = ["week", "weeks"] as const;
const IMPEDIMENTS = ["impediment", "impediments"] as const;

/**
 * The trend test, change points and the median time to resolve, closed by
 * default: the verdict and the weekly chart above are the headline, and
 * these only say something once there are enough weeks or resolved ones.
 */
export function ImpedimentsAdvanced({ analysis }: { analysis: ImpedimentAnalysis }) {
  const { weeks, trend, shifts, resolvedCount, median } = analysis;
  return (
    <AdvancedAnalysis summary="Advanced analysis: trend and time to resolve">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-text">Impediments raised per week</h3>
        {trend ? (
          <p className="text-sm text-text">{trend}</p>
        ) : (
          <NotEnoughData
            have={weeks}
            need={TREND_TEST_MIN}
            unit={WEEKS}
            action="Keep logging for"
            what="a trend test"
          />
        )}
        {shifts ? (
          <p className="text-sm text-text">{shifts}</p>
        ) : (
          <NotEnoughData
            have={weeks}
            need="changePoint"
            unit={WEEKS}
            action="Keep logging for"
            what="change points"
          />
        )}
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-text">Time to resolve</h3>
        {median ? (
          <p className="text-sm text-text">{median}</p>
        ) : (
          <NotEnoughData
            have={resolvedCount}
            need="distribution"
            unit={IMPEDIMENTS}
            action="Resolve"
            what="the median time to resolve with its range"
          />
        )}
      </section>
    </AdvancedAnalysis>
  );
}
