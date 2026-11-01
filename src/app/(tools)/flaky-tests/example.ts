import { exampleId } from "@/components/tool-frame/example-data";
import { periodBounds, periodOf } from "@/lib/analytics/periods";
import { addDays } from "@/lib/impediments/model";
import { FLAKY_BOARD_ID } from "@/lib/quality/flaky";
import type { FlakyStatus, FlakyTestBoard } from "@/lib/stores/workspace-types";

interface Row {
  key: string;
  name: string;
  suite: string;
  owner?: string;
  failures: number;
  runs: number;
  status: FlakyStatus;
  /** Days before today. */
  seen: number;
  quarantined?: number;
  description?: string;
}

/**
 * Eight flaky tests first seen across two months: one quarantined for
 * three weeks (the alert), one quarantined this week, one with only six
 * runs (the "few runs" note), one fixed this quarter, and a spread of rates
 * so the worst-offender chart and the weighted rate have something to say.
 */
const ROWS: readonly Row[] = [
  {
    key: "vat",
    name: "checkout › VAT rounding",
    suite: "checkout.e2e.ts",
    owner: "Priya",
    failures: 30,
    runs: 200,
    status: "quarantined",
    seen: 45,
    quarantined: 20,
    description: "Fails when the run crosses midnight UTC.",
  },
  {
    key: "debounce",
    name: "search › debounces input",
    suite: "search.spec.ts",
    owner: "Lee",
    failures: 4,
    runs: 6,
    status: "active",
    seen: 6,
  },
  {
    key: "token",
    name: "auth › refreshes the token",
    suite: "auth.spec.ts",
    failures: 12,
    runs: 160,
    status: "active",
    seen: 30,
  },
  {
    key: "coupon",
    name: "cart › applies a coupon",
    suite: "cart.e2e.ts",
    owner: "Sam",
    failures: 9,
    runs: 300,
    status: "active",
    seen: 52,
  },
  {
    key: "avatar",
    name: "profile › uploads an avatar",
    suite: "profile.spec.ts",
    failures: 2,
    runs: 120,
    status: "fixed",
    seen: 38,
  },
  {
    key: "paging",
    name: "orders › paginates",
    suite: "orders.e2e.ts",
    owner: "Sam",
    failures: 18,
    runs: 90,
    status: "active",
    seen: 14,
  },
  {
    key: "socket",
    name: "notifications › reconnects the websocket",
    suite: "notify.spec.ts",
    owner: "Priya",
    failures: 7,
    runs: 50,
    status: "quarantined",
    seen: 21,
    quarantined: 3,
  },
  {
    key: "csv",
    name: "reports › exports CSV",
    suite: "reports.spec.ts",
    failures: 3,
    runs: 250,
    status: "active",
    seen: 60,
  },
];

/** The example board, held in memory by the page: nothing in it is saved. */
export function buildExample(today: string): FlakyTestBoard {
  const quarterStart = periodBounds(periodOf(today, "quarter") ?? "")?.from ?? today;
  // Fixed a few days ago, but inside this quarter, so it counts as "fixed this quarter".
  const fixedAt = [addDays(today, -3), quarterStart].sort().at(-1) as string;
  return {
    id: FLAKY_BOARD_ID,
    tests: ROWS.map((r) => ({
      id: exampleId(`ft-${r.key}`),
      name: r.name,
      suite: r.suite,
      ...(r.owner ? { owner: r.owner } : {}),
      failures: r.failures,
      runs: r.runs,
      failureRate: r.failures / r.runs,
      status: r.status,
      firstSeenAt: addDays(today, -r.seen),
      ...(r.quarantined !== undefined ? { quarantinedAt: addDays(today, -r.quarantined) } : {}),
      ...(r.status === "fixed" ? { fixedAt } : {}),
      ...(r.description ? { description: r.description } : {}),
    })),
  };
}
