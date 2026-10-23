import type { KeyResult, Okr } from "@/lib/stores/workspace-types";
import { fmt } from "@/lib/charts/chart-text";
import { objectiveHealth } from "@/app/(tools)/okrs/progress";

/**
 * A sprint goal links the OKRs it moves (`SprintGoal.okrIds`) instead of
 * copying their key results: the numbers stay in the OKRs tool, and the
 * goal shows them as they are today.
 */

export interface LinkedOkrs {
  /** Linked OKRs that exist, in link order. */
  linked: Okr[];
  /** Linked ids whose OKR was deleted. */
  missing: string[];
}

export function resolveLinkedOkrs(
  okrIds: readonly string[] | undefined,
  okrs: readonly Okr[]
): LinkedOkrs {
  const byId = new Map(okrs.map((o) => [o.id, o]));
  const linked: Okr[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const id of okrIds ?? []) {
    if (seen.has(id)) continue;
    seen.add(id);
    const okr = byId.get(id);
    if (okr) linked.push(okr);
    else missing.push(id);
  }
  return { linked, missing };
}

/** `okrIds` with `id` linked or unlinked. */
export function toggleOkrLink(okrIds: readonly string[] | undefined, id: string): string[] {
  const ids = okrIds ?? [];
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

/** An objective's progress as a whole percentage (the OKRs tool's mean of key results). */
export function okrPercent(okr: Okr): number {
  return Math.round(objectiveHealth(okr) * 100);
}

/** "12% of 30%", "40 of 120 sign-ups". */
export function krProgressText(kr: KeyResult): string {
  const unit = kr.unit?.trim() ?? "";
  const show = (n: number) => (unit === "%" ? `${fmt(n)}%` : fmt(n));
  return `${show(kr.current)} of ${show(kr.target)}${unit && unit !== "%" ? ` ${unit}` : ""}`;
}
