/**
 * A sprint goal links the OKRs it moves (`SprintGoal.okrIds`) instead of
 * copying their key results: the numbers stay in the OKRs tool, and the
 * goal shows them as they are today. The readers live in lib/okrs (links
 * and progress), shared with the OKR Tracker and the agent actions; this
 * page keeps the one writer, toggleOkrLink.
 */

export { resolveLinkedOkrs, type LinkedOkrs } from "@/lib/okrs/links";
export { krProgressText, objectivePercent as okrPercent } from "@/lib/okrs/progress";

/** `okrIds` with `id` linked or unlinked. */
export function toggleOkrLink(okrIds: readonly string[] | undefined, id: string): string[] {
  const ids = okrIds ?? [];
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}
