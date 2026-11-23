/**
 * The example: eight bugs for a shop's checkout, in our own words, dated
 * from today, so the ages and fix-by targets always read the same way. A
 * critical payment bug is past its two-day target, two bugs read like the
 * same problem, one is closed as a duplicate and one already sits on the
 * grid. Example ids are never sent to another tool.
 */

import type { BugReport } from "@/lib/stores/workspace-types";
import { exampleId } from "@/lib/utils/example-id";

const DAY = 24 * 60 * 60 * 1000;

export function buildExample(now: Date = new Date()): BugReport[] {
  const at = (daysAgo: number, hour = 10) => {
    const d = new Date(now.getTime() - daysAgo * DAY);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  };
  return [
    {
      id: exampleId("bug-1"),
      title: "Card payments over 1,000 fail at checkout",
      steps: "Add items worth more than 1,000 to the basket, go to checkout, pay by card.",
      expected: "The payment goes through and the order is confirmed.",
      actual: "The pay button spins for a while, then shows an error. No order is made.",
      environment: "Web, every browser tried",
      area: "Checkout",
      reportedBy: "Support desk",
      severity: "critical",
      priority: "now",
      checks: { dataLoss: false, security: false, workaround: false, reach: "some" },
      status: "triaged",
      triagedAt: at(3, 11),
      createdAt: at(3),
      updatedAt: at(3, 11),
    },
    {
      id: exampleId("bug-2"),
      title: "The receipt shows the wrong currency",
      steps: "Switch the shop to euros, buy anything, open the emailed receipt.",
      expected: "The receipt shows euros.",
      actual: "The total is right but the symbol is pounds.",
      area: "Receipts",
      reportedBy: "Priya",
      status: "new",
      createdAt: at(1),
      updatedAt: at(1),
    },
    {
      id: exampleId("bug-3"),
      title: "Typo on the delivery page: “adress”",
      area: "Delivery",
      status: "new",
      createdAt: at(0, 9),
      updatedAt: at(0, 9),
    },
    {
      id: exampleId("bug-4"),
      title: "Search misses words with accents",
      steps: "Search for “cafe” when a product is called “café”.",
      expected: "The product shows up.",
      actual: "No results.",
      area: "Search",
      status: "new",
      createdAt: at(4),
      updatedAt: at(4),
    },
    {
      id: exampleId("bug-5"),
      title: "Paying with a saved card fails",
      actual: "Picking a saved card and paying shows “Something went wrong”.",
      area: "Checkout",
      reportedBy: "Sam",
      status: "new",
      createdAt: at(2),
      updatedAt: at(2),
    },
    {
      id: exampleId("bug-6"),
      title: "Paying with a saved card fails on a phone",
      environment: "Phone browser",
      area: "Checkout",
      status: "new",
      createdAt: at(0, 8),
      updatedAt: at(0, 8),
    },
    {
      id: exampleId("bug-7"),
      title: "Receipt currency symbol is wrong",
      area: "Receipts",
      status: "closed",
      closeReason: "duplicate",
      duplicateOf: exampleId("bug-2"),
      closedAt: at(0, 9),
      createdAt: at(1, 14),
      updatedAt: at(0, 9),
    },
    {
      id: exampleId("bug-8"),
      title: "The delivery date picker offers Sundays",
      expected: "Sundays can't be picked: nobody delivers then.",
      actual: "A Sunday can be picked, and the order then waits a week.",
      area: "Delivery",
      severity: "major",
      priority: "next",
      checks: { workaround: true, reach: "many" },
      status: "triaged",
      triagedAt: at(5, 12),
      createdAt: at(6),
      updatedAt: at(5, 12),
    },
  ];
}
