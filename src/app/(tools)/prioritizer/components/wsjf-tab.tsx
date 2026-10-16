"use client";

/**
 * Tab 2 — WSJF. Ranks items by Weighted Shortest Job First:
 * (Business Value + Time Criticality + Risk Reduction) / Job Size.
 */

import { useMemo } from "react";
import { SectionCard } from "@/components/shared/section-card";
import type { BacklogItem } from "../types";
import { wsjfScore } from "../scoring";
import { ScoreBadge } from "./cells";

export function WSJFTab({ items }: { items: BacklogItem[] }) {
  const sorted = useMemo(
    () => [...items].map((i) => ({ ...i, score: wsjfScore(i) })).sort((a, b) => b.score - a.score),
    [items]
  );

  return (
    <SectionCard
      title="WSJF Prioritization"
      titleSuffix="Score = (Business Value + Time Criticality + Risk Reduction) / Job Size"
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
                Biz Value
              </th>
              <th className="text-center text-xs text-sub font-medium uppercase tracking-wider pb-2 px-2">
                Time Crit
              </th>
              <th className="text-center text-xs text-sub font-medium uppercase tracking-wider pb-2 px-2">
                Risk Red
              </th>
              <th className="text-center text-xs text-sub font-medium uppercase tracking-wider pb-2 px-2">
                CoD
              </th>
              <th className="text-center text-xs text-sub font-medium uppercase tracking-wider pb-2 px-2">
                Job Size
              </th>
              <th className="text-center text-xs text-sub font-medium uppercase tracking-wider pb-2 px-2">
                WSJF
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
                <td className="py-3 px-2 text-center font-data text-sub">{item.businessValue}</td>
                <td className="py-3 px-2 text-center font-data text-sub">{item.timeCriticality}</td>
                <td className="py-3 px-2 text-center font-data text-sub">{item.riskReduction}</td>
                <td className="py-3 px-2 text-center">
                  <ScoreBadge
                    value={item.businessValue + item.timeCriticality + item.riskReduction}
                    color="#ffaa00"
                  />
                </td>
                <td className="py-3 px-2 text-center font-data text-sub">{item.jobSize}</td>
                <td className="py-3 px-2 text-center">
                  <ScoreBadge value={item.score} color="#00f0ff" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
