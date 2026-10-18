import { exampleId } from "@/components/tool-frame/example-data";
import type { Risk } from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";

type Row = Omit<Risk, "id" | "raisedAt" | "resolvedAt" | "mitigationDueAt"> & {
  /** Days before today it was raised, resolved, or is due (negative: ahead). */
  raised: number;
  resolved?: number;
  due?: number;
};

/**
 * A mobile checkout team's register, five weeks before a holiday release.
 * The payment sandbox outage is the clear top risk; the surprise is the
 * single developer who knows the checkout service, a close second. Two
 * risks tie at 8, and two are already resolved, so the time-to-mitigate
 * and open-risk charts have history to show.
 */
const ROWS: Row[] = [
  {
    title: "Payment provider sandbox outages block wallet testing",
    probability: 4,
    impact: 4,
    status: "open",
    mitigation:
      "Record provider responses and test against a local stub; raise it at the provider's weekly call.",
    raised: 20,
    due: -5,
  },
  {
    title: "Only one developer knows the checkout service",
    probability: 3,
    impact: 5,
    status: "mitigating",
    mitigation: "Pair on every checkout change for two sprints and write a runbook.",
    raised: 34,
    due: -10,
  },
  {
    title: "Card data handling fails the security review",
    probability: 2,
    impact: 5,
    status: "open",
    mitigation:
      "Keep card numbers inside the provider's hosted fields; book the review for sprint 2.",
    raised: 12,
  },
  {
    title: "Flaky login test hides real failures",
    probability: 4,
    impact: 2,
    status: "closed",
    mitigation: "Quarantined the test and fixed the race in the session mock.",
    raised: 30,
    resolved: 9,
  },
  {
    title: "Holiday traffic spike slows checkout",
    probability: 2,
    impact: 4,
    status: "mitigating",
    mitigation: "Load test at three times last year's peak before the code freeze.",
    raised: 16,
    due: -14,
  },
  {
    title: "App store review delays the release",
    probability: 3,
    impact: 2,
    status: "accepted",
    mitigation: "Accepted: submit early and ship whenever it's approved.",
    raised: 25,
  },
  {
    title: "Analytics update breaks checkout funnel events",
    probability: 1,
    impact: 3,
    status: "closed",
    mitigation: "Pinned the analytics library and added an event smoke test.",
    raised: 27,
    resolved: 20,
  },
];

export function buildExample(now: Date = new Date()): Risk[] {
  const daysAgo = (n: number) =>
    todayLocalISO(new Date(now.getFullYear(), now.getMonth(), now.getDate() - n));
  return ROWS.map(({ raised, resolved, due, ...risk }, i) => ({
    ...risk,
    id: exampleId(`risk-${i + 1}`),
    raisedAt: daysAgo(raised),
    ...(resolved !== undefined ? { resolvedAt: daysAgo(resolved) } : {}),
    ...(due !== undefined ? { mitigationDueAt: daysAgo(due) } : {}),
  }));
}
