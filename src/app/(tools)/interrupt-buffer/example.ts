/**
 * The example: a running sprint that kept 20% for interrupts, with the
 * week's unplanned work logged against it, and the sprint before it. Held
 * in memory while it is open: no example sprint or interrupt reaches the
 * workspace, where the cockpit, velocity and Amr would count them.
 */

import type { InterruptItem, Sprint } from "@/lib/stores/workspace-types";
import { exampleId } from "@/lib/utils/example-id";

export interface InterruptExample {
  sprints: Sprint[];
  items: InterruptItem[];
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function buildExample(now: Date = new Date()): InterruptExample {
  const at = (days: number, hour = 10) => {
    const d = new Date(now.getTime() + days * 86_400_000);
    d.setUTCHours(hour, 0, 0, 0);
    return d.toISOString();
  };
  const day = (days: number) => iso(new Date(now.getTime() + days * 86_400_000));
  const current = exampleId("sprint-14");
  const previous = exampleId("sprint-13");
  return {
    sprints: [
      {
        id: current,
        name: "Sprint 14",
        startDate: day(-6),
        endDate: day(7),
        pointsPlanned: 30,
        status: "active",
        goal: "Shops can refund a payment from the phone",
        interruptBuffer: { pct: 20 },
      },
      {
        id: previous,
        name: "Sprint 13",
        startDate: day(-20),
        endDate: day(-7),
        pointsPlanned: 28,
        pointsCompleted: 25,
        status: "completed",
        interruptBuffer: { points: 5 },
      },
    ],
    items: [
      {
        id: exampleId("int-1"),
        sprintId: current,
        title: "Card payments fail for one bank",
        kind: "incident",
        size: 3,
        emergency: true,
        loggedAt: at(-5, 8),
        resolvedAt: at(-5, 15),
      },
      {
        id: exampleId("int-2"),
        sprintId: current,
        title: "Shop owner can't log in after changing phone",
        kind: "support",
        size: 1,
        emergency: false,
        loggedAt: at(-3),
        resolvedAt: at(-3, 12),
      },
      {
        id: exampleId("int-3"),
        sprintId: current,
        title: "Sales asks for a refunds export for a big customer",
        kind: "request",
        size: 2,
        emergency: false,
        loggedAt: at(-1),
      },
      {
        id: exampleId("int-4"),
        sprintId: previous,
        title: "Payout report shows the wrong day",
        kind: "bug",
        size: 2,
        emergency: false,
        loggedAt: at(-15),
        resolvedAt: at(-14),
      },
      {
        id: exampleId("int-5"),
        sprintId: previous,
        title: "Help a shop move to a new bank account",
        kind: "support",
        size: 1,
        emergency: false,
        loggedAt: at(-12),
        resolvedAt: at(-12, 14),
      },
    ],
  };
}
