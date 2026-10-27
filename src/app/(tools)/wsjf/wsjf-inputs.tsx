"use client";

import { MethodInputs } from "@/components/prioritization/method-inputs";
import { shortName, type MethodInputsSlotProps } from "@/components/prioritization/method-tool";
import { ScaleValue } from "@/components/shared/scale-picker";
import type { BacklogItem } from "@/lib/stores/workspace-types";
import { clearedKeys, ownedPatch, withSharedValueKept } from "@/lib/prioritization/binding";
import { readBacklogItem } from "@/lib/prioritization/defaults";
import type { Values } from "@/lib/prioritization/methods";
import {
  FIBONACCI_STEPS,
  WSJF_KEYS,
  WSJF_LEGEND,
  type WsjfKey,
} from "@/lib/prioritization/methods/wsjf";
import type { RankedRow } from "@/lib/prioritization/rank";

const isBlank = (v: unknown) => v === undefined || (typeof v === "string" && v.trim() === "");

/**
 * The business value a save with every part blank leaves on the backlog
 * item, because the Value/Effort matrix still places the item with it
 * (the binding's withSharedValueKept); null when the save clears it or
 * there is no item.
 */
export function keptBusinessValue(draft: Values, item: BacklogItem | undefined): number | null {
  if (!item || !WSJF_KEYS.every((k) => isBlank(draft[k]))) return null;
  const read = readBacklogItem(item);
  if (read.businessValue === undefined) return null;
  const clears: Values = Object.fromEntries(WSJF_KEYS.map((k) => [k, undefined]));
  const patch = withSharedValueKept(read, ownedPatch("wsjf", clears, clearedKeys(clears)));
  return "businessValue" in patch ? null : read.businessValue;
}

/**
 * WSJF's inputs in the method-tool shell: the registry's four parts, each
 * on the modified Fibonacci scale 1, 2, 3, 5, 8, 13, 20 (one row of seven
 * from 640 px), under the relative-scoring legend. A title with no parts
 * is allowed: it waits as "Not scored" for the column-by-column scoring
 * above the list (between the add form and the list). Blanking every part
 * of a feature whose backlog item sits on the Value/Effort matrix says
 * that its business value stays there.
 */
export function WsjfInputs({
  method,
  draft,
  update,
  errors,
  custom,
  size,
  item,
}: MethodInputsSlotProps) {
  const kept = keptBusinessValue(draft, item);
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
      {kept !== null && item && (
        <p role="note" className="text-xs text-sub">
          Its business value {kept} stays on the backlog item “{shortName(item.name)}”: the
          Value/Effort matrix places it with the same field.
        </p>
      )}
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
