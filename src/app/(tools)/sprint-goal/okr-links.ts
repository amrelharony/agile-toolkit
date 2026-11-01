/**
 * A sprint goal links the OKRs it moves (`SprintGoal.okrIds`) instead of
 * copying their key results: the numbers stay in the OKRs tool, and the
 * goal shows them as they are today. The readers live in lib/okrs (links
 * and progress), shared with the OKR Tracker and the agent actions; this
 * page keeps the one writer, toggleOkrLink.
 */

import { objectivePercent } from "@/lib/okrs/progress";
import type { Okr } from "@/lib/stores/workspace-types";

export { resolveLinkedOkrs, type LinkedOkrs } from "@/lib/okrs/links";
export { krProgressText, objectivePercent as okrPercent } from "@/lib/okrs/progress";

/**
 * An objective's progress as a whole percentage, or null while it has no
 * key result: not measured yet, as the OKR page reads it, never 0%.
 */
export function okrMeasuredPercent(okr: Pick<Okr, "keyResults">): number | null {
  return (okr.keyResults ?? []).length > 0 ? objectivePercent(okr) : null;
}

/** "63% of the way", or "not measured yet" for an objective with no key result. */
export function okrProgressLabel(okr: Pick<Okr, "keyResults">): string {
  const pct = okrMeasuredPercent(okr);
  return pct === null ? "not measured yet" : `${pct}% of the way`;
}

/** `okrIds` with `id` linked or unlinked. */
export function toggleOkrLink(okrIds: readonly string[] | undefined, id: string): string[] {
  const ids = okrIds ?? [];
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}
