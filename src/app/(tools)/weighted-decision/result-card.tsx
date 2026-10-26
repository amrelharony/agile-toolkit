"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { AlertTriangle, BookCheck, Scale } from "lucide-react";
import { AdvancedAnalysis } from "@/components/shared/advanced-analysis";
import { ChartFigure } from "@/components/shared/chart-card";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { SendToMenu } from "@/components/handoff/send-to-menu";
import { getHandoffRoute, liveLink } from "@/lib/handoffs/registry";
import type { HandoffLink } from "@/lib/handoffs/types";
import type { WeightedMatrix } from "@/lib/stores/workspace-types";
import {
  SENSITIVITY_LIMIT,
  TIE_MARGIN,
  changePercent,
  decisionSourceOf,
  formatTotal,
  sendError,
  sensitivityText,
  type MatrixResult,
} from "@/lib/weighted/model";
import { totalsChartText } from "./markdown";

// Recharts loads with the chart, not the page; the box keeps the space meanwhile.
const WeightedScoreChart = dynamic(() => import("./charts").then((m) => m.WeightedScoreChart), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full animate-pulse rounded-lg bg-muted/30" aria-hidden="true" />
  ),
});

const ROUTES = ["decision"] as const;

/**
 * The result: the verdict, a tie or a close call named, the complete
 * options' totals as a chart (with its summary and table), the full
 * sensitivity table under Advanced analysis, and "Send to decision record",
 * which proposes a record with the options in rank order and the leader as
 * the recommendation, leaving the outcome to the team.
 */
export function ResultCard({
  matrix,
  result,
  onLinksChange,
  getLinks,
}: {
  matrix: WeightedMatrix;
  result: MatrixResult;
  onLinksChange: (update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]) => void;
  getLinks: () => readonly HandoffLink[] | undefined;
}) {
  const complete = result.options.filter((o) => o.total !== null);
  const text = totalsChartText(result);
  const bars = complete.map((o) => ({
    name: `${o.rank}. ${o.name.length > 16 ? `${o.name.slice(0, 15)}…` : o.name}`,
    total: Math.round((o.total ?? 0) * 100) / 100,
    leader: o.id === result.leaderId,
  }));
  const flip = result.sensitivity[0];
  const why = sendError(matrix, result);
  const link = liveLink(matrix.sentTo, "decision");
  const decided = link ? getHandoffRoute("decision").isDone?.(link.targetId) === true : false;
  const active = result.criteria.filter((c) => c.active);

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium text-text">{result.verdict}</p>

      {result.tie && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-text"
        >
          <Scale className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          Too close to call: the top totals are within {Math.round(TIE_MARGIN * 100)}% of each other
          ({formatTotal(result.tie.gap)} apart). Treat it as a tie and talk it through.
        </p>
      )}
      {flip && !result.tie && (
        <p className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-text">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          {sensitivityText(flip)} Check that weight before you decide.
        </p>
      )}

      {complete.length > 0 ? (
        <ChartFigure
          label="Weighted totals"
          summary={text.summary}
          table={text.table}
          caption="Weighted totals"
          plotClassName="h-64"
        >
          <WeightedScoreChart data={bars} />
        </ChartFigure>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-sub">
          {text.summary}
        </p>
      )}

      <AdvancedAnalysis summary="How sensitive is the result?">
        {result.sensitivityChecked ? (
          <div className="table-wrap-responsive">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Weight change that flips the leader, per criterion
              </caption>
              <thead>
                <tr className="text-left text-xs text-sub">
                  <th scope="col" className="p-2">
                    Criterion
                  </th>
                  <th scope="col" className="p-2">
                    Weight
                  </th>
                  <th scope="col" className="p-2">
                    Change that flips the leader
                  </th>
                </tr>
              </thead>
              <tbody>
                {active.map((c) => {
                  const f = result.sensitivity.find((s) => s.criterionId === c.id);
                  return (
                    <tr key={c.id} className="border-t border-border">
                      <th scope="row" className="p-2 text-left font-normal">
                        {c.name}
                      </th>
                      <td className="p-2 font-mono">{c.weight}</td>
                      <td className="p-2">
                        {f
                          ? `${changePercent(f.changePct)}% ${f.direction} (to ${formatTotal(f.weightAt)}): ${f.newLeader} leads`
                          : `None within ±${Math.round(SENSITIVITY_LIMIT * 100)}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <NotEnoughData
            have={Math.min(complete.length, active.length)}
            need={2}
            unit={[
              "fully scored option (and weighted criterion)",
              "fully scored options (and weighted criteria)",
            ]}
            action="Score"
            what="how sensitive the result is to each weight"
          />
        )}
        <p className="text-xs text-sub">
          For each criterion, the smallest change to its weight (up to{" "}
          {Math.round(SENSITIVITY_LIMIT * 100)}% either way) that hands the lead to another fully
          scored option.
        </p>
      </AdvancedAnalysis>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <SendToMenu
          routes={ROUTES}
          item={decisionSourceOf(matrix, result)}
          sentTo={matrix.sentTo}
          onLinksChange={onLinksChange}
          getLinks={getLinks}
          itemLabels={{ decision: "Decision record (proposed)" }}
          disabled={why !== null}
        />
        {why ? (
          <span className="text-xs text-sub">{why}</span>
        ) : link ? (
          <Link
            href={getHandoffRoute("decision").targetHref(link.targetId)}
            className="inline-flex items-center gap-1 text-xs text-success underline-offset-2 hover:underline"
          >
            <BookCheck className="h-3.5 w-3.5" aria-hidden="true" />
            {decided ? "Decided in the Decision Log · Open" : "Proposed in the Decision Log · Open"}
          </Link>
        ) : (
          <span className="text-xs text-sub">
            Send the result to a decision record: the team writes down what it decides.
          </span>
        )}
      </div>
    </div>
  );
}
