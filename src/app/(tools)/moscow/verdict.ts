import type { BacklogItem } from "@/lib/stores/workspace-types";
import { formatNumber } from "@/lib/prioritization/methods/fields";
import {
  MOSCOW_BUCKETS,
  MUST_BUDGET_SHARE,
  type MoscowBucket,
  type MoscowBudget,
} from "@/lib/prioritization/methods/moscow";
import type { RankedRow } from "@/lib/prioritization/rank";
import { plural } from "@/lib/charts/chart-text";
import { bucketOf, budgetOf, type MoscowPageBudget } from "./budget";

/** Short bucket names for counts ("3 Must, 2 Should"). */
const SHORT: Record<MoscowBucket, string> = {
  must: "Must",
  should: "Should",
  could: "Could",
  wont: "Won't",
};

/** "42%" */
export const pct = (share: number) => `${Math.round(share * 100)}%`;

/** The limit as words: "about 60%". */
export const LIMIT_TEXT = `about ${pct(MUST_BUDGET_SHARE)}`;

/** The rows counted by bucket, unsorted ones last. */
export function bucketCounts(rows: readonly RankedRow[]): Record<MoscowBucket | "none", number> {
  const out: Record<MoscowBucket | "none", number> = {
    must: 0,
    should: 0,
    could: 0,
    wont: 0,
    none: 0,
  };
  for (const r of rows) out[bucketOf(r) ?? "none"] += 1;
  return out;
}

/** "3 Must, 2 Should, 1 Could, 1 Won't and 1 not sorted yet" (empty buckets left out). */
function countsText(rows: readonly RankedRow[]): string {
  const c = bucketCounts(rows);
  const parts = MOSCOW_BUCKETS.filter((b) => c[b] > 0).map((b) => `${c[b]} ${SHORT[b]}`);
  if (c.none > 0) parts.push(`${c.none} not sorted yet`);
  return parts.length <= 1
    ? parts.join("")
    : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * "Move about 6 points of Musts down to Should or Could." Rounded up (the
 * epsilon absorbs float noise such as 1.0000000000000009), so moving that
 * much does bring the Musts to the limit or under it: 2.4 points over
 * reads 3, never 2.
 */
export function excessText(budget: MoscowBudget): string {
  const points = Math.max(1, Math.ceil(budget.excess - 1e-9));
  return `Move about ${plural(points, "point")} of Musts down to Should or Could.`;
}

/**
 * The Musts the budget couldn't count: "The Must has no effort yet",
 * "The 2 Musts have…" when none is sized, "1 more Must has…" when some are.
 */
export function unsizedMustsText(budget: MoscowPageBudget, musts: number): string {
  const n = budget.unsizedMusts;
  if (n < musts) return `${plural(n, "more Must has", "more Musts have")} no effort yet`;
  return n === 1 ? "The Must has no effort yet" : `The ${n} Musts have no effort yet`;
}

/**
 * The one-sentence answer over the buckets: the counts, and once three
 * planned items have an effort, the Musts' share of the planned effort
 * against the ~60% limit (what to move when it's over). The budget is
 * the registry's mustBudget over the same entries the agent reads. An
 * unsized Must isn't in the share, so while one is the share is a floor:
 * never "inside the limit", and with no Must sized, no share at all.
 */
export function moscowVerdict(rows: readonly RankedRow[], items: readonly BacklogItem[]): string {
  if (rows.length === 0) return "Nothing sorted yet.";
  const c = bucketCounts(rows);
  const lead = `${plural(rows.length, "item")}: ${countsText(rows)}.`;
  const budget = budgetOf(rows, items);
  if (budget.share === null) return lead;
  if (c.must === 0) return `${lead} No Musts yet: the whole plan can bend.`;
  const unsized = budget.unsizedMusts;
  if (unsized >= c.must) {
    return `${lead} ${unsizedMustsText(budget, c.must)}, so the Must budget can't be judged: size ${
      unsized === 1 ? "it" : "them"
    }.`;
  }
  const take =
    unsized > 0
      ? `The sized ${c.must - unsized === 1 ? "Must takes" : "Musts take"}`
      : c.must === 1
        ? "The Must takes"
        : `The ${c.must} Musts take`;
  const share = `${take} ${pct(budget.share)} of the planned effort`;
  if (budget.over) {
    const more = unsized > 0 ? `, and ${unsizedMustsText(budget, c.must)}` : "";
    return `${lead} ${share}, over the limit of ${LIMIT_TEXT}${more}. ${excessText(budget)}`;
  }
  return unsized > 0
    ? `${lead} ${share}, but ${unsizedMustsText(budget, c.must)}, so the share can only rise: size ${
        unsized === 1 ? "it" : "them"
      } before trusting the budget.`
    : `${lead} ${share}, inside the limit of ${LIMIT_TEXT}.`;
}

/**
 * The budget as one line for the Markdown export and the panel ("Musts:
 * 42% of the planned effort (11 of 26 points; limit about 60%)."). With a
 * Must unsized the share is a floor ("at least 42%"); with none of the
 * `musts` sized there is no share to give (null, as below three sized).
 */
export function budgetLine(budget: MoscowPageBudget, musts: number): string | null {
  if (budget.share === null) return null;
  if (musts > 0 && budget.unsizedMusts >= musts) return null;
  const floor = budget.unsizedMusts > 0;
  const unsized = floor
    ? `; ${plural(budget.unsizedMusts, "more Must", "more Musts")} not sized`
    : "";
  return `Musts: ${floor ? "at least " : ""}${pct(budget.share)} of the planned effort (${formatNumber(
    budget.mustEffort,
    2
  )} of ${formatNumber(budget.plannedEffort, 2)} points; limit ${LIMIT_TEXT}${unsized}).`;
}
