/**
 * The example: a payments team's backlog with the usual mix: a few stories
 * ready to pull, some vague or unsized ones near the top, one too big, two
 * that nobody has touched for months, and two sharing a place. Held in
 * memory while it is open, so no example story reaches the workspace (where
 * Sprint Planning, Refinement and the cockpit would read it).
 */

import type { Story } from "@/lib/stores/workspace-types";
import { exampleId } from "@/lib/utils/example-id";

export function buildExample(now: Date = new Date()): Story[] {
  const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  const s = (key: string, over: Omit<Story, "id" | "status">): Story => ({
    id: exampleId(key),
    status: "backlog",
    ...over,
  });
  return [
    s("refund", {
      title: "Refund a payment from the phone",
      points: 5,
      backlogRank: 1,
      notes: "Shop owners refund at the counter today by calling support.",
      acceptanceCriteria: "Full and partial refunds; the shopper gets an email.",
      gwt: [
        {
          id: "g1",
          given: "a payment taken today",
          when: "the owner taps Refund and confirms the amount",
          then: "the shopper's card is credited and they get an email",
        },
      ],
      createdAt: ago(20),
    }),
    s("payout-bank", {
      title: "Payout to a second bank account",
      points: 3,
      backlogRank: 2,
      acceptanceCriteria: "The owner picks the account for each payout.",
      createdAt: ago(12),
    }),
    s("reports", {
      title: "Reports",
      backlogRank: 3,
      createdAt: ago(9),
    }),
    s("import", {
      title: "Import orders from CSV and Excel files with currency conversion",
      points: 21,
      backlogRank: 4,
      acceptanceCriteria: "Both file types import; amounts show in the shop's currency.",
      createdAt: ago(30),
    }),
    s("tap", {
      title:
        "As a shop owner, I want to take a card by tapping it on my phone so that I need no card machine",
      points: 8,
      backlogRank: 5,
      createdAt: ago(5),
    }),
    s("tips", {
      title: "Add tips at checkout",
      points: 3,
      backlogRank: 5,
      acceptanceCriteria: "Preset tip amounts and a custom one.",
      createdAt: ago(40),
    }),
    s("offline", {
      title: "Queue payments while offline and send them later",
      points: 13,
      priorityScore: 4.2,
      createdAt: ago(25),
    }),
    s("dark", {
      title: "Fix UI",
      priorityScore: 1.1,
      createdAt: ago(140),
    }),
    s("loyalty", {
      title: "Loyalty stamps for regular shoppers",
      points: 8,
      createdAt: ago(170),
    }),
  ];
}
