"use client";

/**
 * Tab "All methods" — every backlog item scored by every method, side by side.
 *
 * MoSCoW, WSJF, RICE and Value/Effort come from the item's own inputs (the
 * table above). ICE, Kano and Cost of Delay come from the latest row in
 * those tools linked to the item; when there is none the cell links to the
 * tool with the item preselected.
 */

import Link from "next/link";
import { LayoutGrid } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";
import {
  FRAMEWORKS,
  scoreWithHref,
  type PrioritizationFramework,
} from "@/lib/prioritization/frameworks";
import { KANO_LABELS, frameworkScores, type FrameworkScores } from "@/lib/prioritization/scores";
import { method } from "@/lib/prioritization/methods";
import { VE_LABEL } from "@/lib/prioritization/methods/value-effort";
import { COD_URGENCY_LABEL } from "@/lib/prioritization/methods/cost-of-delay";
import type { BacklogItem } from "../types";
import { MOSCOW_CONFIG } from "../constants";

/** Columns whose scores are numbers, set in the data font. */
const NUMERIC = new Set<string>(["wsjf", "rice", "ice", "cost-of-delay"]);

const finite = (n: number | null | undefined): n is number =>
  typeof n === "number" && Number.isFinite(n);

/** The cell's content for one method, or null when the item has no score there yet. */
function scoreFor(f: PrioritizationFramework, s: FrameworkScores): React.ReactNode | null {
  switch (f.framework) {
    case "moscow":
      return s.moscow ? (MOSCOW_CONFIG[s.moscow]?.label ?? null) : null;
    case "wsjf":
      return finite(s.wsjf) ? method("wsjf").format(s.wsjf) : null;
    case "rice":
      return finite(s.rice) ? method("rice").format(s.rice) : null;
    case "value-effort": {
      if (!s.valueEffort) return null;
      const { value, effort, quadrant } = s.valueEffort;
      return (
        <>
          {VE_LABEL[quadrant]}
          <span className="block text-xs text-sub">
            Value {value} · Effort {effort}
          </span>
        </>
      );
    }
    case "ice":
      return finite(s.ice) ? method("ice").format(s.ice) : null;
    case "kano":
      return s.kano ? (KANO_LABELS[s.kano] ?? s.kano) : null;
    case "cost-of-delay":
      if (!finite(s.cd3)) return null;
      return (
        <>
          CD3 {method("cost-of-delay").format(s.cd3)}
          {s.urgency && (
            <span className="block text-xs text-sub">{COD_URGENCY_LABEL[s.urgency]}</span>
          )}
        </>
      );
    default:
      return null;
  }
}

export function ScoresTab({
  items,
  rows,
}: {
  items: BacklogItem[];
  rows: readonly PrioritizationItem[];
}) {
  return (
    <SectionCard title="All methods" icon={LayoutGrid}>
      <p className="mb-3 text-xs text-sub">
        MoSCoW, WSJF, RICE and Value/Effort use each item&apos;s inputs above. ICE, Kano and Cost of
        Delay show the latest score linked from those tools.
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-sub">Add backlog items to compare every method side by side.</p>
      ) : (
        <div className="table-wrap-responsive">
          <table className="w-full text-sm">
            <caption className="sr-only">Each backlog item&apos;s score in every method</caption>
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-sub">
                <th scope="col" className="p-2 font-medium min-w-[160px]">
                  Item
                </th>
                {FRAMEWORKS.map((f) => (
                  <th key={f.id} scope="col" className="p-2 font-medium">
                    {f.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const scores = frameworkScores(item, rows);
                const name = item.name?.trim() || "Untitled item";
                return (
                  <tr key={item.id} className="border-b border-border align-top">
                    <th scope="row" className="p-2 text-left font-normal text-text">
                      {name}
                    </th>
                    {FRAMEWORKS.map((f) => {
                      const score = scoreFor(f, scores);
                      return (
                        <td key={f.id} className="whitespace-nowrap p-2">
                          {score !== null ? (
                            <span className={NUMERIC.has(f.framework) ? "font-data" : undefined}>
                              {score}
                            </span>
                          ) : (
                            <Link
                              href={scoreWithHref(f, item.id)}
                              className="text-xs text-accent underline-offset-2 hover:underline"
                            >
                              Score with {f.label}
                              <span className="sr-only">: {name}</span>
                            </Link>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}
