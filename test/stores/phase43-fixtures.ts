/**
 * One full record of each Phase 43 workspace collection (the tools plan's
 * phase 2), every optional field set, for the store and CRUD tests. Chains
 * import them read-only; extra cases go in their own phase43-<chain> files.
 */
import type { ExampleMap, PokerAsyncRound } from "@/lib/stores/workspace-types";

export const AT = "2026-11-12T09:00:00.000Z";
export const LATER = "2026-11-12T10:30:00.000Z";

/* P2.1 */

export const EXAMPLE_MAP: ExampleMap = {
  id: "exmap_1",
  title: "Refund a card payment",
  storyId: "story_7",
  rules: [
    { id: "r1", text: "Only the shop owner can refund" },
    {
      id: "r2",
      text: "A refund can't be more than the payment",
      sentTo: [{ route: "backlog-story", targetId: "story_8", at: LATER }],
    },
  ],
  examples: [
    { id: "e1", ruleId: "r1", text: "A cashier taps Refund and is told to ask the owner" },
    {
      id: "e2",
      ruleId: "r2",
      text: "Refund 12 of a 10 payment",
      given: "a payment of 10",
      when: "the owner refunds 12",
      then: "the refund is refused",
    },
  ],
  questions: [
    { id: "q1", text: "Can a refund be split?", ruleId: "r2", owner: "Ana", status: "open" },
    { id: "q2", text: "Do refunds need a reason?", status: "answered", answer: "No." },
  ],
  verdict: "split",
  timeboxMinutes: 25,
  sentAt: LATER,
  sentTo: [{ route: "backlog-story", targetId: "story_7", at: LATER }],
  createdAt: AT,
  updatedAt: LATER,
};

export const POKER_ASYNC_ROUND: PokerAsyncRound = {
  id: "async_1",
  title: "Checkout stories",
  scaleType: "fibonacci",
  deck: ["1", "2", "3", "5", "8", "13", "?"],
  stories: [
    { id: "s1", title: "Pay by phone", finalEstimate: "5" },
    { id: "s2", title: "Refund a payment", discuss: true },
  ],
  expected: ["Ana", "Bo"],
  dueDate: "2026-11-14",
  withMeanings: true,
  replies: [
    {
      id: "rep1",
      name: "Ana",
      votes: [
        { storyId: "s1", card: "5" },
        { storyId: "s2", card: "8" },
      ],
      notes: [{ storyId: "s2", text: "Needs the bank's API" }],
      at: AT,
    },
  ],
  status: "revealed",
  revealedAt: LATER,
  closedAt: LATER,
  createdAt: AT,
  updatedAt: LATER,
};
