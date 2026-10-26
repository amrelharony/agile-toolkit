import { shortName } from "@/components/prioritization/method-tool";
import { ICE } from "@/lib/prioritization/methods";
import { toNumber } from "@/lib/prioritization/methods/fields";
import type { RankedRow } from "@/lib/prioritization/rank";
import { listAnd, plural } from "@/lib/charts/chart-text";

/** At or below this, the top idea is still a guess (contract item 7: say so). */
const LOW_CONFIDENCE = 3;

/**
 * The one-sentence answer above the list: what to do first, ties named,
 * a warning when the front-runner rests on a hunch, and how many ideas
 * still wait for a score. The ranks are the registry's (rankMethodRows).
 */
export function iceVerdict(rows: readonly RankedRow[]): string {
  if (rows.length === 0) return "No ideas scored yet.";
  const top = rows.filter((r) => r.rank === 1 && r.result.score !== null);
  const unscored = rows.filter((r) => r.result.score === null).length;
  if (top.length === 0) return `None of the ${plural(rows.length, "idea")} is scored yet.`;
  const score = ICE.format(top[0].result.score as number);
  const names = listAnd(top.map((r) => `“${shortName(r.row.title)}”`));
  const lead =
    top.length === 1
      ? `Do first: ${names} (ICE ${score}).`
      : `Do first: ${names} tie at ICE ${score}.`;
  const shaky = top.some((r) => (toNumber(r.values.confidence) ?? 10) <= LOW_CONFIDENCE);
  const warn = shaky
    ? ` Confidence is low, so test ${top.length === 1 ? "it" : "them"} cheaply before building.`
    : "";
  const rest = unscored > 0 ? ` ${plural(unscored, "idea")} not scored yet.` : "";
  return `${lead}${warn}${rest}`;
}
