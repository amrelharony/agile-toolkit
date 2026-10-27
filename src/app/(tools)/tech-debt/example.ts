import type { TechDebtItem } from "@/lib/stores/workspace-types";
import { exampleId } from "@/lib/utils/example-id";
import { todayLocalISO } from "@/lib/utils/formatters";

type Row = Omit<TechDebtItem, "id" | "raisedAt" | "resolvedAt"> & {
  /** Days before today it was raised, and paid down. */
  raised: number;
  resolved?: number;
};

/**
 * A payments team's debt, told here with the default 14-day sprints: the
 * page ages it in the team's own sprint length, so with another length
 * the ages (and which items hit the cap) shift. The hand-rolled billing
 * date maths has been piling up interest for months and hits the cap;
 * the payment SDK upgrade is the most painful item and still outranks the
 * copy-pasted form validation, which is old enough to hit the cap too but
 * trivial (the cap is why). The search queries have no interest estimate,
 * and the logging library was paid down last month.
 */
const ROWS: Row[] = [
  {
    title: "Hand-rolled date maths in billing",
    description: "Three copies of the month-end rule; each fix lands in one of them.",
    area: "billing",
    impact: 4,
    effort: 3,
    interestRate: 2,
    raised: 160,
  },
  {
    title: "Payment SDK two major versions behind",
    description: "Blocks the new wallet methods; security fixes stop next quarter.",
    area: "billing",
    impact: 5,
    effort: 4,
    interestRate: 0.5,
    raised: 40,
  },
  {
    title: "Flaky deploy script retries silently",
    area: "ci",
    impact: 4,
    effort: 2,
    interestRate: 1,
    raised: 90,
  },
  {
    title: "Copy-pasted form validation",
    area: "web",
    impact: 2,
    effort: 2,
    interestRate: 0.5,
    raised: 300,
  },
  {
    title: "Unindexed search queries",
    description: "Fine at today's volume; slow once the catalogue doubles.",
    area: "search",
    impact: 3,
    effort: 1,
    raised: 20,
  },
  {
    title: "Old logging library",
    area: "platform",
    impact: 2,
    effort: 3,
    interestRate: 0.5,
    raised: 150,
    resolved: 30,
  },
];

export function buildExample(now: Date = new Date()): TechDebtItem[] {
  const daysAgo = (n: number) =>
    todayLocalISO(new Date(now.getFullYear(), now.getMonth(), now.getDate() - n));
  return ROWS.map(({ raised, resolved, ...item }, i) => ({
    ...item,
    id: exampleId(`debt-${i + 1}`),
    raisedAt: daysAgo(raised),
    ...(resolved !== undefined ? { resolvedAt: daysAgo(resolved) } : {}),
  }));
}
