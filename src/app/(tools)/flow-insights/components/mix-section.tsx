"use client";

/**
 * Work mix: one stacked bar per sprint or week (Feature, Defect, Debt, Risk,
 * Not sorted), the guessed part of each kind hatched, and each bar's split
 * said in words under it, so colour is never the only cue. A table holds the
 * same numbers. Below: the target mix, its form, and the gaps to it.
 */

import { useState } from "react";
import { ChartColumnStacked, Pencil } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { WORK_TYPE_LABEL, type TargetSplit } from "@/lib/flow/work-types";
import { gapLabel, type FlowInsights } from "@/lib/flow/distribution";
import { cn } from "@/lib/utils";
import { SEGMENT_LABEL, SEGMENT_SWATCH, segmentsOf, splitWords, type SegmentKey } from "../model";
import { TargetForm } from "./target-form";

/** Stripes over a segment's guessed part (the card colour over the kind's own). */
const HATCH = {
  backgroundImage: "repeating-linear-gradient(135deg, transparent 0 3px, var(--card) 3px 5px)",
} as const;

const LEGEND: SegmentKey[] = ["feature", "defect", "debt", "risk", "unsorted"];

export function MixSection({
  x,
  onSaveTarget,
}: {
  x: FlowInsights;
  onSaveTarget: (split: TargetSplit | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const unit = x.board === "sprint" ? "Sprint" : "Week";
  const shown = [...x.periods].reverse();

  return (
    <SectionCard title="Work mix" icon={ChartColumnStacked} contentClassName="space-y-4">
      <ul aria-label="Kinds of work in the bars" className="flex flex-wrap gap-x-3 gap-y-1">
        {LEGEND.map((k) => (
          <li key={k} className="flex items-center gap-1.5 text-xs text-sub">
            <span className={cn("h-2.5 w-2.5 rounded-sm", SEGMENT_SWATCH[k])} aria-hidden="true" />
            {SEGMENT_LABEL[k]}
          </li>
        ))}
        <li className="flex items-center gap-1.5 text-xs text-sub">
          <span className="h-2.5 w-2.5 rounded-sm bg-sub" style={HATCH} aria-hidden="true" />
          Striped: a guess, not set by hand
        </li>
      </ul>

      {shown.length === 0 ? (
        <p className="text-sm text-sub">Nothing finished in this window yet.</p>
      ) : (
        <ul className="space-y-3" aria-label={`Work mix per ${unit.toLowerCase()}, newest first`}>
          {shown.map((p) => (
            <li key={p.id} className="space-y-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
                <span className="min-w-0 font-medium text-text">{p.label}</span>
                <span className="font-data text-xs text-sub">
                  {p.finished} finished
                  {p.failurePct !== null ? ` · ${p.failurePct}% repeat work` : ""}
                </span>
              </div>
              {p.finished > 0 ? (
                <div className="flex h-4 w-full gap-px overflow-hidden rounded" aria-hidden="true">
                  {segmentsOf(p).map((s) => (
                    <div key={s.key} className="flex h-full" style={{ width: `${s.pct}%` }}>
                      <span
                        className={cn("h-full", SEGMENT_SWATCH[s.key])}
                        style={{ width: `${((s.count - s.guessed) / s.count) * 100}%` }}
                      />
                      <span
                        className={cn("h-full", SEGMENT_SWATCH[s.key])}
                        style={{ width: `${(s.guessed / s.count) * 100}%`, ...HATCH }}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div
                  className="h-4 w-full rounded border border-dashed border-border"
                  aria-hidden="true"
                />
              )}
              <p className="text-xs text-sub">{splitWords(p)}</p>
            </li>
          ))}
        </ul>
      )}

      {x.periods.length > 0 && (
        <div className="relative overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[32rem] text-sm">
            <caption className="sr-only">Finished work by kind, per {unit.toLowerCase()}</caption>
            <thead>
              <tr className="border-b border-border bg-surface-deep text-xs uppercase tracking-wider text-sub">
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  {unit}
                </th>
                <th scope="col" className="px-2 py-2 text-right font-medium">
                  Finished
                </th>
                {(["feature", "defect", "debt", "risk"] as const).map((t) => (
                  <th key={t} scope="col" className="px-2 py-2 text-right font-medium">
                    {WORK_TYPE_LABEL[t]}
                  </th>
                ))}
                <th scope="col" className="px-2 py-2 text-right font-medium">
                  Not sorted
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Repeat work
                </th>
              </tr>
            </thead>
            <tbody>
              {x.periods.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0">
                  <th scope="row" className="px-3 py-2 text-left font-normal text-text">
                    {p.label}
                  </th>
                  <td className="px-2 py-2 text-right font-data">{p.finished}</td>
                  {(["feature", "defect", "debt", "risk"] as const).map((t) => (
                    <td key={t} className="px-2 py-2 text-right font-data">
                      {p.counts[t]}
                    </td>
                  ))}
                  <td className="px-2 py-2 text-right font-data">{p.unsorted}</td>
                  <td className="px-3 py-2 text-right font-data">
                    {p.failurePct === null ? "—" : `${p.failurePct}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="space-y-2 rounded-lg border border-border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-text">Target mix</h3>
          {!editing && (
            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil aria-hidden="true" />
              {x.target ? "Change the target" : "Set a target"}
            </Button>
          )}
        </div>
        {editing ? (
          <TargetForm
            target={x.target}
            onSave={(split) => {
              onSaveTarget(split);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        ) : x.target ? (
          <>
            <p className="text-sm text-text">
              {(["feature", "defect", "debt", "risk"] as const)
                .map((t) => `${WORK_TYPE_LABEL[t]} ${x.target?.[t]}%`)
                .join(" · ")}
            </p>
            <ul className="flex flex-wrap gap-2" aria-label="Against the target">
              {x.gaps.map((g) => (
                <li
                  key={g.type}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-xs",
                    g.gap !== null && Math.abs(g.gap) >= 5
                      ? "border-warning/40 text-warning"
                      : "border-border text-sub"
                  )}
                >
                  {gapLabel(g)}
                </li>
              ))}
            </ul>
            <p className="text-xs text-sub">
              Shares of the sorted work in the window; items not sorted yet are left out.
              Kanban&apos;s Definition of Workflow shows the same target.
            </p>
          </>
        ) : (
          <p className="text-sm text-sub">
            No target yet. Agree one with the Product Owner: four numbers that add up to 100.
          </p>
        )}
      </div>
    </SectionCard>
  );
}
