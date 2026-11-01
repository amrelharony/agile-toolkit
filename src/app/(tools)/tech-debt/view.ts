/**
 * Tech Debt: the page's pure edits and its CSV. Every age and score comes
 * from lib/tech-debt/model, as the Markdown and the agent read them.
 */

import type { TechDebtItem } from "@/lib/stores/workspace-types";
import { debtScale, isInterestEstimated, isOpenDebt, rankedDebt } from "@/lib/tech-debt/model";
import { exportedDebt } from "./analysis";
import type { BacklogState } from "./markdown";

/** A change to an item's fields; an optional field given as undefined or "" is removed. */
export type DebtPatch = Partial<Omit<TechDebtItem, "id">>;

/** The fields a patch may take away (required ones are never removed). */
const OPTIONAL = new Set<keyof TechDebtItem>([
  "description",
  "area",
  "interestRate",
  "resolvedAt",
  "tags",
  "sentTo",
]);

/** The item with `patch` applied, the emptied optional fields removed. */
export function withPatch(t: TechDebtItem, patch: DebtPatch): TechDebtItem {
  const next = { ...t, ...patch } as TechDebtItem;
  const fields = next as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (!OPTIONAL.has(key as keyof TechDebtItem)) continue;
    if (
      value === undefined ||
      (typeof value === "string" && !value.trim()) ||
      (Array.isArray(value) && value.length === 0)
    ) {
      delete fields[key];
    }
  }
  return next;
}

/**
 * The page's CSV, in the page's order: the team's own items while there
 * are any (exportedDebt), as the Markdown lists them.
 */
export function debtCsv(
  items: readonly TechDebtItem[],
  sprintLengthDays: number,
  today: string,
  backlog: (t: TechDebtItem) => BacklogState = () => null
): { headers: string[]; rows: (string | number)[][] } {
  return {
    headers: [
      "Title",
      "Description",
      "Area",
      "Impact",
      "Effort",
      "Interest/Sprint",
      "Raised",
      "Age (days)",
      "Age (sprints)",
      "Base",
      "Interest",
      "Score",
      "Capped",
      "Backlog",
      "Resolved",
    ],
    rows: rankedDebt(exportedDebt(items), sprintLengthDays, today).map(
      ({ item: t, ageDays, ageSprints, score }) => {
        const sent = backlog(t);
        return [
          t.title,
          t.description ?? "",
          t.area ?? "",
          debtScale(t.impact),
          debtScale(t.effort),
          isInterestEstimated(t) ? (t.interestRate as number) : "",
          t.raisedAt,
          ageDays ?? "",
          ageSprints ?? "",
          score.base,
          Math.round(score.interest * 10) / 10,
          Math.round(score.total * 10) / 10,
          score.capped ? "yes" : "",
          sent === "done" ? "Story done" : sent === "sent" ? "On the backlog" : "",
          isOpenDebt(t) ? "" : (t.resolvedAt ?? "").slice(0, 10),
        ];
      }
    ),
  };
}
