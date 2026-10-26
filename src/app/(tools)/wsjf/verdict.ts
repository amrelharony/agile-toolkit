import { shortName } from "@/components/prioritization/method-tool";
import { WSJF } from "@/lib/prioritization/methods";
import { formatNumber, toNumber } from "@/lib/prioritization/methods/fields";
import { WSJF_LABEL, columnsWithoutOne, type WsjfKey } from "@/lib/prioritization/methods/wsjf";
import type { RankedRow } from "@/lib/prioritization/rank";
import { listAnd, plural } from "@/lib/charts/chart-text";

/** The relative hint's columns, by the registry (at least two scored values, no 1). */
export const columnsMissingOne = (rows: readonly RankedRow[]): WsjfKey[] =>
  columnsWithoutOne(rows.map((r) => r.values));

/** "No feature has a 1 for Time criticality: give the smallest a 1 and size the others against it." */
export function relativeHint(keys: readonly WsjfKey[]): string {
  const names = listAnd(keys.map((k) => WSJF_LABEL[k]));
  return `No feature has a 1 for ${names}: give the smallest a 1 and size the others against it.`;
}

/**
 * The one-sentence answer over the list: what to do first and why (its
 * cost of delay against its job size), ties named, the relative hint when
 * a column has no 1, and how many features still wait for a score. The
 * ranks are the registry's (rankMethodRows).
 */
export function wsjfVerdict(rows: readonly RankedRow[]): string {
  if (rows.length === 0) return "No features scored yet.";
  const top = rows.filter((r) => r.rank === 1 && r.result.score !== null);
  const unscored = rows.filter((r) => r.result.score === null).length;
  if (top.length === 0) {
    return `None of the ${plural(rows.length, "feature")} is scored yet: score them by column.`;
  }
  const waiting =
    unscored > 0 ? ` ${plural(unscored, "feature")} not scored yet: score them by column.` : "";
  const score = WSJF.format(top[0].result.score as number);
  const names = listAnd(top.map((r) => `“${shortName(r.row.title)}”`));
  let lead: string;
  if (top.length === 1) {
    const cod = toNumber(top[0].result.extra?.costOfDelay);
    const size = toNumber(top[0].values.jobSize);
    const why =
      cod !== undefined && size !== undefined
        ? `: cost of delay ${formatNumber(cod, 2)} ÷ job size ${formatNumber(size, 2)}`
        : "";
    lead = `Do first: ${names} (WSJF ${score}${why}).`;
  } else {
    lead = `Do first: ${names} tie at WSJF ${score}.`;
  }
  const missingOne = columnsMissingOne(rows);
  const hint = missingOne.length > 0 ? ` ${relativeHint(missingOne)}` : "";
  return `${lead}${hint}${waiting}`;
}
