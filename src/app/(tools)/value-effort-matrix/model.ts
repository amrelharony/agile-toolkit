/**
 * Value vs Effort on the page: where each row sits, which list it goes in
 * and what to say about a value off the scale. Every number (the quadrant,
 * value ÷ effort, the order) is the method registry's
 * (lib/prioritization/methods/value-effort), read through to a linked
 * backlog item by rankMethodRows, so the page, the Prioritizer and the
 * agent actions agree. Pure.
 *
 * A stored `fields.quadrant` (display-cased from the old page, snake_case
 * from the old agent actions) is never read: the quadrant is derived from
 * value and effort every time, so an agent-written row lists like any
 * other.
 */

import type { PrioritizationItem } from "@/lib/stores/workspace-types";
import { FIBONACCI_TEXT, isFibonacci } from "@/lib/prioritization/methods/fibonacci";
import { toNumber } from "@/lib/prioritization/methods/fields";
import { VALUE_EFFORT, type Values } from "@/lib/prioritization/methods";
import {
  VE_EFFORT_STEPS,
  VE_LABEL,
  VE_MEANING,
  VE_QUADRANTS,
  VE_VALUE_STEPS,
  isValueEffortQuadrant,
  type ValueEffortQuadrant,
} from "@/lib/prioritization/methods/value-effort";
import type { RankedRow } from "@/lib/prioritization/rank";

export const FRAMEWORK = "value-effort" as const;

/** The list (and the matrix's tray) for rows without both value and effort. */
export const UNPLACED = "unplaced" as const;
export const UNPLACED_LABEL = "Not placed yet";

export type VeGroupId = ValueEffortQuadrant | typeof UNPLACED;

export interface VeGroup {
  id: VeGroupId;
  label: string;
  meaning: string;
  rows: RankedRow[];
}

/** A name short enough for a sentence or a toast. */
export function shortName(name: string, max = 40): string {
  const t = name.trim() || "Untitled item";
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** A row's derived quadrant; null while it isn't placed. */
export function quadrantOf(r: RankedRow): ValueEffortQuadrant | null {
  return isValueEffortQuadrant(r.result.bucket) ? r.result.bucket : null;
}

/**
 * Where a row sits: value and effort as it shows them (a linked row's from
 * its backlog item). An effort of 0 or less can't be divided by, so it
 * counts as not set, as the method scores it.
 */
export function placeOf(r: Pick<RankedRow, "values">): {
  value: number | null;
  effort: number | null;
} {
  const value = toNumber(r.values.value) ?? null;
  const effort = toNumber(r.values.effort);
  return { value, effort: effort !== undefined && effort > 0 ? effort : null };
}

/**
 * The lists, quadrant by quadrant in do-first order, then "Not placed
 * yet". Rows keep the order they are given in (the ranked order, or the
 * order on screen while someone edits), so a list never re-sorts itself.
 */
export function veGroups(rows: readonly RankedRow[]): VeGroup[] {
  const groups: VeGroup[] = [
    ...VE_QUADRANTS.map((q) => ({ id: q, label: VE_LABEL[q], meaning: VE_MEANING[q], rows: [] })),
    {
      id: UNPLACED,
      label: UNPLACED_LABEL,
      meaning: "Give both a value and an effort, or drag it onto the matrix.",
      rows: [],
    },
  ];
  const byId = new Map(groups.map((g) => [g.id, g]));
  for (const r of rows) byId.get(quadrantOf(r) ?? UNPLACED)?.rows.push(r);
  return groups;
}

/** "value 8, effort 3, Quick Wins" or "not placed yet": what a dot says and announces. */
export function positionText(at: { value: number | null; effort: number | null }): string {
  if (at.value === null && at.effort === null) return "not placed yet";
  const q =
    at.value !== null && at.effort !== null
      ? (VALUE_EFFORT.evaluate({ value: at.value, effort: at.effort })
          .bucket as ValueEffortQuadrant | null)
      : null;
  const parts = [`value ${at.value ?? "not set"}`, `effort ${at.effort ?? "not set"}`];
  return q ? `${parts.join(", ")}, ${VE_LABEL[q]}` : parts.join(", ");
}

/** Value ÷ effort for display ("2.67"), or null while it isn't placed. */
export function ratioText(r: RankedRow): string | null {
  return r.result.score === null ? null : VALUE_EFFORT.format(r.result.score);
}

/**
 * What to fix on a row whose stored value or effort is off its scale (an
 * old agent row's effort 0.5, a value of 4 from before the Fibonacci
 * value): it is drawn at the nearest edge or between its neighbours and
 * listed as it is, never rewritten silently. Null when both are fine.
 */
export function offScaleNote(r: Pick<RankedRow, "values">): string | null {
  const value = toNumber(r.values.value);
  const effort = toNumber(r.values.effort);
  const notes: string[] = [];
  if (value !== undefined && !isFibonacci(value)) {
    notes.push(`Value ${value} is off the scale (${FIBONACCI_TEXT}).`);
  }
  if (effort !== undefined && (effort < 1 || effort > 10 || !Number.isInteger(effort))) {
    notes.push(`Effort ${effort} is off the 1–10 scale.`);
  }
  return notes.length > 0 ? `${notes.join(" ")} Edit to fix.` : null;
}

/** Off-scale values among `values`, for the pickers' "Custom" option. */
export function customValues(values: Values | undefined): Values | undefined {
  if (!values) return undefined;
  const out: Values = {};
  const value = toNumber(values.value);
  const effort = toNumber(values.effort);
  if (value !== undefined && !VE_VALUE_STEPS.some((s) => s.value === value)) out.value = value;
  if (effort !== undefined && !VE_EFFORT_STEPS.some((s) => s.value === effort)) out.effort = effort;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** The CSV export: the quadrant derived, never the stored one. */
export function toCsv(rows: readonly RankedRow[]): {
  headers: string[];
  rows: (string | number)[][];
} {
  return {
    headers: ["Title", "Value", "Effort", "Quadrant", "Value ÷ effort"],
    rows: rows.map((r) => {
      const q = quadrantOf(r);
      const at = placeOf(r);
      return [
        r.row.title,
        at.value ?? "",
        at.effort ?? "",
        q ? VE_LABEL[q] : UNPLACED_LABEL,
        ratioText(r) ?? "",
      ];
    }),
  };
}

/**
 * The rows as the AI prompt reads them: grouped by quadrant label, each
 * with the value and effort it shows (`v8 e3`), not its stored copy.
 */
export function promptGroups(rows: readonly RankedRow[]): Record<string, PrioritizationItem[]> {
  const out: Record<string, PrioritizationItem[]> = {};
  for (const g of veGroups(rows)) {
    out[g.label] = g.rows.map((r) => {
      const at = placeOf(r);
      return { ...r.row, fields: { value: at.value ?? "—", effort: at.effort ?? "—" } };
    });
  }
  return out;
}
