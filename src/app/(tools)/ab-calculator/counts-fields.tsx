"use client";

/**
 * Read: visitors and conversions for A and B, and the result they give
 * at the plan's confidence and sides. Below the planned sample the verdict
 * reads "Too early to call", and the numbers still show; with no plan it
 * shows with a note to decide the sample first next time.
 */

import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { AbTestPlan } from "@/lib/stores/workspace-types";
import {
  countsTyped,
  readResult,
  validateCounts,
  type CountsDraft,
  type CountsField,
} from "@/lib/experiments/model";
import { ResultView } from "./result-view";
import { shownErrors } from "./plan-fields";

const FIELDS: { key: CountsField; label: string; placeholder: string }[] = [
  { key: "aVisitors", label: "A visitors", placeholder: "e.g. 4020" },
  { key: "aConversions", label: "A conversions", placeholder: "e.g. 402" },
  { key: "bVisitors", label: "B visitors", placeholder: "e.g. 3980" },
  { key: "bConversions", label: "B conversions", placeholder: "e.g. 477" },
];

export function CountsFields({
  draft,
  plan,
  onChange,
  showAll,
}: {
  draft: CountsDraft;
  /** The plan as typed, when it checks out: its confidence, sides and sample read the result. */
  plan: AbTestPlan | null;
  onChange: (patch: Partial<CountsDraft>) => void;
  showAll: boolean;
}) {
  const checked = validateCounts(draft);
  const errors = shownErrors<CountsField>(
    checked.ok ? {} : checked.errors,
    draft as unknown as Record<CountsField, unknown>,
    showAll && countsTyped(draft)
  );
  const reading = checked.ok ? readResult(plan, checked.values) : null;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {FIELDS.map((f) => (
          <Field key={f.key} label={f.label} error={errors[f.key]}>
            {(props) => (
              <Input
                {...props}
                inputMode="numeric"
                value={draft[f.key]}
                placeholder={f.placeholder}
                onChange={(e) => onChange({ [f.key]: e.target.value } as Partial<CountsDraft>)}
              />
            )}
          </Field>
        ))}
      </div>
      {reading ? (
        <ResultView reading={reading} live />
      ) : (
        <p className="text-sm text-sub" role="status">
          Type both versions&apos; visitors and conversions to read the result.
        </p>
      )}
    </div>
  );
}
