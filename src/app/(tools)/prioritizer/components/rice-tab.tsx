"use client";

/**
 * Tab 3 — RICE. Ranks items by (Reach × Impact × Confidence%) / Effort.
 */

import { useMemo } from "react";
import { SectionCard } from "@/components/shared/section-card";
import type { BacklogItem } from "../types";
import { readBacklogItem } from "@/lib/prioritization/defaults";
import { method } from "@/lib/prioritization/methods";
import { REACH_PERIOD_LABEL } from "@/lib/prioritization/methods/rice";
import { riceScore } from "../scoring";
import { ScoreBadge } from "./cells";

export function RICETab({ items }: { items: BacklogItem[] }) {
  const sorted = useMemo(
    () =>
      [...items]
        // The engine's reading: an item that isn't RICE-scored shows "Not
        // scored" and sorts last.
        .map((i) => ({ ...readBacklogItem(i), score: riceScore(i) }))
        .sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity)),
    [items]
  );

  return (
    <SectionCard
      title="RICE Prioritization"
      titleSuffix="Score = (Reach × Impact × Confidence%) / Effort"
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left text-xs text-sub font-medium uppercase tracking-wider pb-2 pr-3">
                Rank
              </th>
              <th className="text-left text-xs text-sub font-medium uppercase tracking-wider pb-2 pr-3 min-w-[160px]">
                Item
              </th>
              <th className="text-center text-xs text-sub font-medium uppercase tracking-wider pb-2 px-2">
                Reach
              </th>
              <th className="text-center text-xs text-sub font-medium uppercase tracking-wider pb-2 px-2">
                Impact
              </th>
              <th className="text-center text-xs text-sub font-medium uppercase tracking-wider pb-2 px-2">
                Confidence
              </th>
              <th className="text-center text-xs text-sub font-medium uppercase tracking-wider pb-2 px-2">
                Effort
              </th>
              <th className="text-center text-xs text-sub font-medium uppercase tracking-wider pb-2 px-2">
                RICE
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((item, idx) => (
              <tr key={item.id} className="border-b border-border hover:bg-card-hover">
                <td className="py-3 pr-3 align-top">
                  <span className="font-data text-sub text-xs">#{idx + 1}</span>
                </td>
                <td className="py-3 pr-3 font-medium text-text align-top">
                  <div>{item.name}</div>
                  {item.description && (
                    <div className="text-sub text-xs mt-0.5 mb-0.5 whitespace-pre-wrap break-words font-normal">
                      {item.description}
                    </div>
                  )}
                </td>
                <td className="py-3 px-2 text-center font-data text-sub">
                  {item.reach === undefined
                    ? "—"
                    : `${item.reach} ${REACH_PERIOD_LABEL[item.reachPeriod ?? "quarter"]}`}
                </td>
                <td className="py-3 px-2 text-center font-data text-sub">
                  {item.impact === undefined ? "—" : `${item.impact}x`}
                </td>
                <td className="py-3 px-2 text-center font-data text-sub">
                  {item.confidence === undefined ? "—" : `${item.confidence}%`}
                </td>
                <td className="py-3 px-2 text-center font-data text-sub">
                  {item.effort === undefined ? "—" : `${item.effort} pm`}
                </td>
                <td className="py-3 px-2 text-center">
                  {item.score === null ? (
                    <span className="text-xs text-sub">Not scored</span>
                  ) : (
                    <ScoreBadge value={method("rice").format(item.score)} color="#00f0ff" />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
