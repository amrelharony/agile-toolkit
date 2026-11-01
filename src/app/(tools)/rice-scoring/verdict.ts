import { shortName } from "@/components/prioritization/method-tool";
import { RICE } from "@/lib/prioritization/methods";
import type { RankedRow } from "@/lib/prioritization/rank";
import { listAnd, plural } from "@/lib/charts/chart-text";
import { confidenceOf } from "./analysis";

/** At or below this, the front-runner rests on a guess (the rubric's "Low"). */
const LOW_CONFIDENCE = 50;

/**
 * The one-sentence answer above the list: what to do first (ties named),
 * a warning when the front-runner's confidence is 50% or less, and how
 * many initiatives still wait for a score. Ranks are the registry's.
 */
export function riceVerdict(rows: readonly RankedRow[]): string {
  if (rows.length === 0) return "No initiatives scored yet.";
  const top = rows.filter((r) => r.rank === 1 && r.result.score !== null);
  const unscored = rows.filter((r) => r.result.score === null).length;
  if (top.length === 0) return `None of the ${plural(rows.length, "initiative")} is scored yet.`;
  const score = RICE.format(top[0].result.score as number);
  const names = listAnd(top.map((r) => `“${shortName(r.row.title)}”`));
  const lead =
    top.length === 1
      ? `Do first: ${names} (RICE ${score}).`
      : `Do first: ${names} tie at RICE ${score}.`;
  const shaky = top
    .map(confidenceOf)
    .filter((c): c is number => c !== undefined && c <= LOW_CONFIDENCE);
  const warn =
    shaky.length > 0
      ? ` Confidence is only ${Math.min(...shaky)}%, so test ${top.length === 1 ? "it" : "them"} before building.`
      : "";
  const rest = unscored > 0 ? ` ${plural(unscored, "initiative")} not scored yet.` : "";
  return `${lead}${warn}${rest}`;
}
