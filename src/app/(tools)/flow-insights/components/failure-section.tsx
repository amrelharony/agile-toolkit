"use client";

/**
 * Failure demand: the share of finished work that was repeat work (a
 * defect, a reopened item, or marked), per sprint or week; its trend over
 * every period once there are enough; and the latest period's repeat work,
 * each saying why, with the places to take it.
 */

import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { FAILURE_WHY_LABEL, FLOW_TREND_MIN, type FlowInsights } from "@/lib/flow/distribution";

export function FailureSection({ x }: { x: FlowInsights }) {
  const unit =
    x.board === "sprint" ? (["sprint", "sprints"] as const) : (["week", "weeks"] as const);
  const withWork = x.all.filter((p) => p.failurePct !== null).length;
  const latest = [...x.periods].reverse().find((p) => p.finished > 0);
  const repeat = latest ? latest.items.filter((it) => it.failure) : [];

  return (
    <SectionCard title="Repeat work" icon={RotateCcw} contentClassName="space-y-4">
      <p className="text-xs text-sub">
        Failure demand: work caused by an earlier failure. A defect, an item reopened after Done, or
        one marked as repeat work counts.
      </p>
      {x.periods.some((p) => p.finished > 0) && (
        <ul className="flex flex-wrap gap-2" aria-label="Repeat work per period">
          {x.periods
            .filter((p) => p.finished > 0)
            .map((p) => (
              <li key={p.id} className="rounded-md border border-border px-2 py-1 text-xs text-sub">
                <span className="text-text">{p.label}</span>{" "}
                <span className="font-data">{p.failurePct}%</span> ({p.failure} of {p.finished})
              </li>
            ))}
        </ul>
      )}
      {x.trend ? (
        <p className="text-sm text-text">{x.trend.sentence}</p>
      ) : (
        <NotEnoughData
          have={withWork}
          need={FLOW_TREND_MIN}
          unit={unit}
          action="Keep finishing work for"
          what="a trend in repeat work"
        />
      )}
      {latest && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-text">Repeat work in {latest.label}</h3>
          {repeat.length === 0 ? (
            <p className="text-sm text-sub">None: everything finished was new value.</p>
          ) : (
            <ul className="space-y-1">
              {repeat.map((it) => (
                <li key={`${it.kind}-${it.id}`} className="text-sm text-text">
                  {it.title || "Untitled"}{" "}
                  <span className="text-xs text-sub">
                    ({it.failureWhy ? FAILURE_WHY_LABEL[it.failureWhy] : "repeat work"})
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <Link
          href="/root-cause"
          className="inline-flex items-center text-accent underline-offset-2 hover:underline pointer-coarse:min-h-11"
        >
          Find the cause with Root Cause
        </Link>
        <Link
          href="/retro"
          className="inline-flex items-center text-accent underline-offset-2 hover:underline pointer-coarse:min-h-11"
        >
          Take it to the retro
        </Link>
      </p>
    </SectionCard>
  );
}
