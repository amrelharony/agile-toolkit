"use client";

import { MethodInputs } from "@/components/prioritization/method-inputs";
import type { MethodInputsSlotProps } from "@/components/prioritization/method-tool";
import { ScaleValue } from "@/components/shared/scale-picker";
import {
  FIBONACCI_STEPS,
  WSJF_KEYS,
  WSJF_LEGEND,
  type WsjfKey,
} from "@/lib/prioritization/methods/wsjf";
import type { RankedRow } from "@/lib/prioritization/rank";

/**
 * WSJF's inputs in the method-tool shell: the registry's four parts, each
 * on the modified Fibonacci scale 1, 2, 3, 5, 8, 13, 20 (one row of seven
 * from 640 px), under the relative-scoring legend. A title with no parts
 * is allowed: it waits as "Not scored" for the column-by-column scoring
 * above the list (between the add form and the list).
 */
export function WsjfInputs({ method, draft, update, errors, custom, size }: MethodInputsSlotProps) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-sub">
        {WSJF_LEGEND} Or add titles only and score each column across every feature below.
      </p>
      <MethodInputs
        method={method}
        draft={draft}
        update={update}
        errors={errors}
        custom={custom}
        size={size}
        className="xl:grid-cols-2"
      />
    </div>
  );
}

/** Short names for a row's parts. */
export const WSJF_SHORT: Record<WsjfKey, string> = {
  businessValue: "BV",
  timeCriticality: "TC",
  rrOe: "RR/OE",
  jobSize: "Size",
};

const NAME: Record<WsjfKey, string> = {
  businessValue: "Business value",
  timeCriticality: "Time criticality",
  rrOe: "Risk reduction / opportunity enablement",
  jobSize: "Job size",
};

/** A row's parts as "BV 8 · TC 13 · RR/OE 3 · Size 2", an off-scale one tagged "custom", a blank "—". */
export function WsjfRowValues({ ranked }: { ranked: RankedRow }) {
  return (
    <dl className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-sub">
      {WSJF_KEYS.map((key) => (
        <div key={key} className="flex gap-1">
          <dt title={NAME[key]}>
            <span aria-hidden="true">{WSJF_SHORT[key]}</span>
            <span className="sr-only">{NAME[key]}</span>
          </dt>
          <dd className="text-text">
            {ranked.values[key] === undefined ? (
              "—"
            ) : (
              <ScaleValue steps={FIBONACCI_STEPS} value={ranked.values[key]} />
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
