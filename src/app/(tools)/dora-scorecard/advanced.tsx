"use client";

import { AdvancedAnalysis } from "@/components/shared/advanced-analysis";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import type { DoraAnalysis } from "./analysis";

const QUARTERS = ["quarter", "quarters"] as const;

/**
 * The trend tests, control limits and change points, closed by default:
 * the verdict, the tiles and the charts above are the headline.
 */
export function DoraAdvanced({ analysis }: { analysis: DoraAnalysis }) {
  const { quarters, trends, control, shifts } = analysis;
  return (
    <AdvancedAnalysis summary="Advanced analysis: trends, control limits and shifts">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-text">Trend per metric (Mann-Kendall)</h3>
        {trends ? (
          <ul className="space-y-1 text-sm text-text">
            {trends.map((t) => (
              <li key={t.metric}>{t.text}</li>
            ))}
          </ul>
        ) : (
          <NotEnoughData
            have={quarters}
            need="trend"
            unit={QUARTERS}
            action="Log"
            what="a trend test"
          />
        )}
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-text">Deploy frequency: limits and shifts</h3>
        {control && shifts ? (
          <>
            <p className="text-sm text-text">{control}</p>
            <p className="text-sm text-text">{shifts}</p>
          </>
        ) : (
          <NotEnoughData
            have={quarters}
            need="changePoint"
            unit={QUARTERS}
            action="Log"
            what="control limits and change points"
          />
        )}
      </section>
    </AdvancedAnalysis>
  );
}
