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
import {
  currentQuarterIndex,
  dashQuarter,
  isDashQuarter,
  quarterIndex,
} from "@/lib/roadmap/quarters";
import type { FormErrors, Validation } from "@/lib/utils/form";
import {
  DORA_DESCRIPTION_MAX,
  numberErrors,
  quarterError,
  sampleFor,
  type DoraNumbers,
} from "@/lib/dora/samples";
import { editedSource, keptProvenance, type DoraDerivation } from "@/lib/dora/derive";
import { DORA_METRICS, type DoraMetric } from "@/lib/dora/bands";

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

/**
 * The quarter "Log a quarter" starts on: the latest finished quarter
 * without a sample (a quarter still running would be measured over the
 * weeks so far), else this quarter. The picker still offers this quarter,
 * marked in progress.
 */
export function nextQuarterToLog(samples: readonly DoraSample[], now: Date): string {
  const current = currentQuarterIndex(now);
  for (let i = current - 1; i > current - 40; i--) {
    const q = dashQuarter(i);
    if (!sampleFor(samples, q)) return q;
  }
  return dashQuarter(current);
}

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

const NUMBER_FIELDS = [
  "deployFreqPerWeek",
  "leadTimeHours",
  "changeFailRatePct",
  "mttrHours",
] as const;

/**
 * What was typed into a draft, for carrying it to another form (the log
 * form's "Edit 2026-Q3" opens that row's editor with these numbers in it,
 * instead of dropping them): the filled numbers and the note.
 */
export function typedOverrides(d: DoraDraft): Partial<DoraDraft> {
  const out: Partial<DoraDraft> = {};
  for (const f of NUMBER_FIELDS) if (d[f].trim() !== "") out[f] = d[f];
  if (d.description.trim() !== "") out.description = d.description;
  return out;
}

/** Each number as "Fill from your data" puts it in the draft, read back as the form reads it. */
function filledValues(x: DoraDerivation): Record<DoraMetric, number | null> {
  const d = draftWithDerivation(emptyDraft(x.quarter), x);
  const pct = typed(d.changeFailRatePct);
  return {
    deployFreqPerWeek: x.deployFreqPerWeek === null ? null : (typed(d.deployFreqPerWeek) ?? null),
    leadTimeHours: x.leadTimeHours === null ? null : (typed(d.leadTimeHours) ?? null),
    changeFailRate: x.changeFailRate === null || pct === undefined ? null : pct / 100,
    mttrHours: x.mttrHours === null ? null : (typed(d.mttrHours) ?? null),
  };
}

/**
 * What a sample saved after "Fill from your data" may say it came from:
 * the counts behind each number still as it was filled, 0 for one the data
 * couldn't give or that was typed over; null when none is left, so it is
 * saved as typed (a Fill that found nothing doesn't make a sample derived).
 */
export function savedProvenance(x: DoraDerivation, v: DoraValues): DoraDerivedFrom | null {
  if (x.quarter !== v.quarter) return null;
  const filled = filledValues(x);
  return keptProvenance(x.derivedFrom, (m) => filled[m] !== null && filled[m] === v[m]);
}

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

/**
 * A new sample; `derived` when "Fill from your data" filled it for this
 * quarter (`savedProvenance` says what of it is the data's). `savedAt`
 * stamps `updatedAt`, which says whether it was saved before its quarter
 * ended (lib/dora/samples sampleCoverage).
 */
export function newSample(
  v: DoraValues,
  id: string,
  derived?: { quarter: string; derivedFrom: DoraDerivedFrom },
  savedAt?: string
): DoraSample {
  const fromData = derived && derived.quarter === v.quarter;
  return {
    id,
    ...v,
    source: fromData ? "derived" : "manual",
    ...(fromData ? { derivedFrom: derived.derivedFrom } : {}),
    ...(savedAt ? { updatedAt: savedAt } : {}),
  };
}

const sameFrom = (a: DoraDerivedFrom | undefined, b: DoraDerivedFrom | undefined) =>
  a === b ||
  (a !== undefined &&
    b !== undefined &&
    a.releases === b.releases &&
    a.rolledBack === b.rolledBack &&
    a.items === b.items &&
    a.incidents === b.incidents);

/**
 * `s` with the editor's values and a fresh `updatedAt`, its id kept. Where
 * its numbers come from follows the edit (lib/dora/derive editedSource: a
 * derived number changed is typed now), unless the editor refilled it from
 * the data for this quarter (`refill`: what `savedProvenance` kept, null
 * for nothing). A description cleared is removed. Nothing changed: the same
 * object.
 */
export function applyValues(
  s: DoraSample,
  v: DoraValues,
  updatedAt: string,
  refill?: { quarter: string; derivedFrom: DoraDerivedFrom | null }
): DoraSample {
  const origin: Pick<DoraSample, "source" | "derivedFrom"> =
    refill && refill.quarter === v.quarter
      ? refill.derivedFrom
        ? { source: "derived", derivedFrom: refill.derivedFrom }
        : { source: "manual" }
      : editedSource(s, v);
  const same =
    s.quarter === v.quarter &&
    DORA_METRICS.every((m) => s[m] === v[m]) &&
    (s.description ?? "") === (v.description ?? "") &&
    s.source === origin.source &&
    sameFrom(s.derivedFrom, origin.derivedFrom);
  if (same) return s;
  const { description, source, derivedFrom, ...rest } = s;
  void description;
  void source;
  void derivedFrom;
  return { ...rest, ...v, ...origin, updatedAt };
}

/**
 * The samples Undo may put back into `current`: those not there already
 * and whose quarter has no other sample since (one quarter, one sample);
 * the rest are `keptOut`, for the message saying so.
 */
export function restorable(
  current: readonly DoraSample[],
  back: readonly DoraSample[]
): { restore: DoraSample[]; keptOut: DoraSample[] } {
  const restore: DoraSample[] = [];
  const keptOut: DoraSample[] = [];
  for (const b of back) {
    if (current.some((s) => s.id === b.id)) continue;
    if (sampleFor([...current, ...restore], b.quarter, b.id)) keptOut.push(b);
    else restore.push(b);
  }
  return { restore, keptOut };
}
