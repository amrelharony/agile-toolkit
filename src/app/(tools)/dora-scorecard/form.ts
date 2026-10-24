/**
 * DORA Scorecard: the draft behind the "Log a quarter" form and the row
 * editor, its checks, and how saved values land on a sample. Pure.
 *
 * The old form pre-set the quarter as free text, reported every problem in
 * a toast, clamped a change failure rate over 100% to 100% without a word,
 * and could only remove a sample, never fix one. Now the quarter is picked,
 * each field shows its own error, nothing is clamped, and a sample is
 * edited in place under the same checks (lib/dora/samples, which the agent
 * actions use too).
 */

import type { DoraDerivedFrom, DoraSample } from "@/lib/stores/workspace-types";
import { dashQuarter, isDashQuarter, quarterIndex } from "@/lib/roadmap/quarters";
import type { FormErrors, Validation } from "@/lib/utils/form";
import {
  DORA_DESCRIPTION_MAX,
  numberErrors,
  quarterError,
  type DoraNumbers,
} from "@/lib/dora/samples";
import type { DoraDerivation } from "@/lib/dora/derive";

export interface DoraDraft {
  /** "2026-Q3", or "" when none is picked. */
  quarter: string;
  deployFreqPerWeek: string;
  leadTimeHours: string;
  /** Typed as a percentage (0–100); stored as a 0–1 rate. */
  changeFailRatePct: string;
  mttrHours: string;
  description: string;
}

export type DoraDraftField = keyof DoraDraft;

export interface DoraValues {
  quarter: string;
  deployFreqPerWeek: number;
  leadTimeHours: number;
  /** 0..1. */
  changeFailRate: number;
  mttrHours: number;
  description?: string;
}

/** A number without float noise: 0.07 × 100 shows as 7, not 7.000000000000001. */
const shown = (n: number | null | undefined, digits = 4): string => {
  if (typeof n !== "number" || !Number.isFinite(n)) return "";
  const f = 10 ** digits;
  return String(Math.round(n * f) / f);
};

/** A blank form for `quarter` (a visible pick, which the user can change). */
export function emptyDraft(quarter: string): DoraDraft {
  return {
    quarter,
    deployFreqPerWeek: "",
    leadTimeHours: "",
    changeFailRatePct: "",
    mttrHours: "",
    description: "",
  };
}

/**
 * The editor's draft for a stored sample. A quarter in another form
 * ("2026 Q3") shows as its dash form; one that can't be read starts unset,
 * so saving asks for a quarter instead of keeping a broken one.
 */
export function draftFrom(s: DoraSample): DoraDraft {
  const q = isDashQuarter(s.quarter)
    ? s.quarter
    : quarterIndex(s.quarter) !== 0
      ? dashQuarter(quarterIndex(s.quarter))
      : "";
  return {
    quarter: q,
    deployFreqPerWeek: shown(s.deployFreqPerWeek),
    leadTimeHours: shown(s.leadTimeHours),
    changeFailRatePct: shown(
      typeof s.changeFailRate === "number" ? s.changeFailRate * 100 : null,
      2
    ),
    mttrHours: shown(s.mttrHours),
    description: s.description ?? "",
  };
}

/**
 * The draft with what a derivation found: each metric it could work out
 * replaces the typed one; a metric it couldn't keeps what was typed, so
 * "Fill from your data" never blanks a number the user already entered.
 */
export function draftWithDerivation(d: DoraDraft, x: DoraDerivation): DoraDraft {
  return {
    ...d,
    quarter: x.quarter,
    deployFreqPerWeek:
      x.deployFreqPerWeek !== null ? shown(x.deployFreqPerWeek, 2) : d.deployFreqPerWeek,
    leadTimeHours: x.leadTimeHours !== null ? shown(x.leadTimeHours, 1) : d.leadTimeHours,
    changeFailRatePct:
      x.changeFailRate !== null ? shown(x.changeFailRate * 100, 2) : d.changeFailRatePct,
    mttrHours: x.mttrHours !== null ? shown(x.mttrHours, 2) : d.mttrHours,
  };
}

const typed = (raw: string): number | undefined => {
  const t = raw.trim().replace(/%$/, "").trim();
  return t === "" ? undefined : Number(t);
};

/**
 * Check a draft. Blanks are errors, never a silent 0 (a blank lead time
 * used to band as Elite); a percentage over 100 is an error, not a clamp.
 * The quarter must be a started "YYYY-Qn" with no other sample
 * (`editingId` is the sample being edited, which may keep its own).
 */
export function validateDoraDraft(
  d: DoraDraft,
  {
    samples,
    today,
    editingId,
  }: { samples: readonly DoraSample[]; today: string; editingId?: string }
): Validation<DoraValues, DoraDraftField> {
  const pct = typed(d.changeFailRatePct);
  const numbers: DoraNumbers = {
    deployFreqPerWeek: typed(d.deployFreqPerWeek),
    leadTimeHours: typed(d.leadTimeHours),
    changeFailRate: pct === undefined ? undefined : pct / 100,
    mttrHours: typed(d.mttrHours),
  };
  const errors: FormErrors<DoraDraftField> = {};
  const q = quarterError(d.quarter, samples, today, editingId);
  if (q) errors.quarter = q;
  const n = numberErrors(numbers);
  if (n.deployFreqPerWeek) errors.deployFreqPerWeek = n.deployFreqPerWeek;
  if (n.leadTimeHours) errors.leadTimeHours = n.leadTimeHours;
  if (n.changeFailRate) {
    errors.changeFailRatePct =
      n.changeFailRate === "Use a rate from 0% to 100%."
        ? "Use a percentage from 0 to 100."
        : "Enter the change failure rate as a percentage, 0 to 100.";
  }
  if (n.mttrHours) errors.mttrHours = n.mttrHours;
  const description = d.description.trim();
  if (description.length > DORA_DESCRIPTION_MAX) {
    errors.description = `Keep it under ${DORA_DESCRIPTION_MAX} characters.`;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: {
      quarter: d.quarter,
      deployFreqPerWeek: numbers.deployFreqPerWeek as number,
      leadTimeHours: numbers.leadTimeHours as number,
      changeFailRate: numbers.changeFailRate as number,
      mttrHours: numbers.mttrHours as number,
      ...(description ? { description } : {}),
    },
  };
}

/** A new sample; `derived` when "Fill from your data" filled it for this quarter. */
export function newSample(
  v: DoraValues,
  id: string,
  derived?: { quarter: string; derivedFrom: DoraDerivedFrom }
): DoraSample {
  const fromData = derived && derived.quarter === v.quarter;
  return {
    id,
    ...v,
    source: fromData ? "derived" : "manual",
    ...(fromData ? { derivedFrom: derived.derivedFrom } : {}),
  };
}

/**
 * `s` with the editor's values and a fresh `updatedAt`; its id, source and
 * what it was derived from stay. A description cleared is removed.
 * Unchanged values: the same object.
 */
export function applyValues(s: DoraSample, v: DoraValues, updatedAt: string): DoraSample {
  const same =
    s.quarter === v.quarter &&
    s.deployFreqPerWeek === v.deployFreqPerWeek &&
    s.leadTimeHours === v.leadTimeHours &&
    s.changeFailRate === v.changeFailRate &&
    s.mttrHours === v.mttrHours &&
    (s.description ?? "") === (v.description ?? "");
  if (same) return s;
  const { description, ...rest } = s;
  void description;
  return { ...rest, ...v, updatedAt };
}
