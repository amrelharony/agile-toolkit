"use client";

import { ScaleValue } from "@/components/shared/scale-picker";
import { MethodInputs } from "@/components/prioritization/method-inputs";
import {
  validateMethodDraft,
  type MethodInputsSlotProps,
} from "@/components/prioritization/method-tool";
import { ICE, type Values } from "@/lib/prioritization/methods";
import { ICE_KEYS, ICE_STEPS, type IceKey } from "@/lib/prioritization/methods/ice";
import type { RankedRow } from "@/lib/prioritization/rank";
import type { Validation } from "@/lib/utils/form";

/**
 * ICE's inputs in the method-tool shell: the registry's three 1–10 scales
 * (lib/prioritization/methods/ice), each value with what it means as its
 * tooltip. Ten options fit one row in a column only on wide screens, so
 * the scales stack below xl and each wraps as two rows of five on a phone.
 */
export function IceInputs({ method, draft, update, errors, custom }: MethodInputsSlotProps) {
  return (
    <MethodInputs
      method={method}
      draft={draft}
      update={update}
      errors={errors}
      custom={custom}
      // Compact options keep all ten on one row from 640 px; touch targets
      // grow on phones, where two rows of five read cleanly.
      size="sm"
      className="xl:grid-cols-3"
    />
  );
}

const SHORT: Record<IceKey, string> = { impact: "I", confidence: "C", ease: "E" };
const NAME: Record<IceKey, string> = { impact: "Impact", confidence: "Confidence", ease: "Ease" };

/** A row's three scores as "I 6 · C 8 · E 9", an off-scale one tagged "custom". */
export function IceRowValues({ ranked }: { ranked: RankedRow }) {
  return (
    <dl className="flex items-center gap-3 font-mono text-xs text-sub">
      {ICE_KEYS.map((key) => (
        <div key={key} className="flex gap-1">
          <dt title={NAME[key]}>
            <span aria-hidden="true">{SHORT[key]}</span>
            <span className="sr-only">{NAME[key]}</span>
          </dt>
          <dd className="text-text">
            {ranked.values[key] === undefined ? (
              "—"
            ) : (
              <ScaleValue steps={ICE_STEPS[key]} value={ranked.values[key]} />
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The add form's draft before anything is picked (kept for callers of the pilot's API). */
export interface IceDraft {
  title: string;
  impact: number | null;
  confidence: number | null;
  ease: number | null;
}

export type IceValues = { title: string } & Record<IceKey, number>;
export type IceField = keyof IceDraft;

export const EMPTY_ICE_DRAFT: IceDraft = { title: "", impact: null, confidence: null, ease: null };

/**
 * Check a draft by the registry's rules (the shell's validateMethodDraft):
 * a missing score is an error, never a silent 5, and a score outside 1–10
 * is refused.
 */
export function validateIce(d: IceDraft): Validation<IceValues, IceField> {
  const values: Values = {};
  for (const key of ICE_KEYS) values[key] = d[key] ?? undefined;
  const checked = validateMethodDraft(ICE, { ...values, title: d.title });
  if (!checked.ok) return { ok: false, errors: checked.errors };
  const v = checked.values;
  return {
    ok: true,
    values: {
      title: v.title,
      impact: v.impact as number,
      confidence: v.confidence as number,
      ease: v.ease as number,
    },
  };
}
