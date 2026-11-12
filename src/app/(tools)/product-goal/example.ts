/**
 * The example: a payments product's Product Goal and two earlier ones, held
 * in memory while it is open, so a visitor sees the tool working without a
 * single goal reaching the workspace (a stored example goal would be the
 * active one on Sprint Goal and the team charter).
 */

import type { ProductGoal } from "@/lib/stores/workspace-types";
import { exampleId } from "@/lib/utils/example-id";

export const EXAMPLE_VISION =
  "Small shop owners take payments anywhere, without a card machine, and see their money the next day.";

/**
 * The example's backlog, for Ask Amr and the copyable prompts while the
 * example is open: the team's own backlog never goes with the example.
 */
export const EXAMPLE_STORY_TITLES: readonly string[] = [
  "Tap to pay on the shop owner's phone",
  "Take a payment with no signal and send it later",
  "Refund a payment from the phone",
  "See today's takings at a glance",
  "Payout to a second bank account",
  "Receipts by text message",
];

/** The example goals, stamped around `now` (an ISO time). */
export function buildExample(now: Date = new Date()): ProductGoal[] {
  const day = (offset: number) => new Date(now.getTime() + offset * 86_400_000).toISOString();
  const isoDay = (offset: number) => day(offset).slice(0, 10);
  return [
    {
      id: exampleId("goal-tap"),
      statement:
        "Shop owners take every in-person payment on their own phone, with no card machine to rent.",
      why: "Renting a card machine is the main cost our shops tell us about, and it keeps the smallest ones away.",
      measures: [
        "Share of active shops with no card machine: 40% today, 70% target",
        "Payments taken by phone each week",
      ],
      targetDate: isoDay(200),
      status: "active",
      createdAt: day(-40),
      updatedAt: day(-12),
    },
    {
      id: exampleId("goal-payout"),
      statement: "Shop owners see yesterday's takings in their bank account every morning.",
      measures: ["Payouts that arrive the next working day"],
      status: "achieved",
      closedAt: day(-41),
      note: "Next-day payouts reached 98% in the spring.",
      createdAt: day(-300),
      updatedAt: day(-41),
    },
    {
      id: exampleId("goal-invoice"),
      statement: "Shops send invoices from the app.",
      measures: [],
      status: "abandoned",
      closedAt: day(-320),
      note: "Customers kept using their accounting software for invoices; we stopped.",
      createdAt: day(-400),
      updatedAt: day(-320),
    },
  ];
}
