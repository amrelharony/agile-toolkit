import { exampleId } from "@/components/tool-frame/example-data";
import type { Cause } from "./markdown";

export const EXAMPLE_SCENARIO =
  "It's April. The new mobile checkout launched two months late, conversion is down 8%, and support is flooded with failed-payment tickets.";

/**
 * A mobile checkout team's premortem. The late payment integration is the
 * obvious top cause; the surprise is the flaky test suite, which scores
 * nearly as high because everyone has learned to ignore red builds. Two
 * causes tie at 12. Every cause has a preventive action and an owner.
 */
const ROWS: Omit<Cause, "id">[] = [
  {
    text: "Payment provider integration took far longer than estimated",
    description: "Nobody on the team has built a wallet integration before.",
    likelihood: 4,
    impact: 4,
    preventiveAction: "Spike the wallet integration in sprint 1 and get sandbox access this week.",
    owner: "Diego (iOS)",
  },
  {
    text: "Flaky end-to-end tests taught everyone to ignore red builds",
    description: "The login test alone fails one run in five.",
    likelihood: 5,
    impact: 3,
    preventiveAction: "Quarantine a flaky test within a day; show the count on the team board.",
    owner: "Sam (Backend)",
  },
  {
    text: "Nobody tested on older Android phones",
    likelihood: 3,
    impact: 4,
    preventiveAction: "Add three low-end devices to the test matrix.",
    owner: "Amara (QA)",
  },
  {
    text: "Launch date announced before the team estimated",
    description: "Marketing needs a date for the holiday campaign.",
    likelihood: 3,
    impact: 4,
    preventiveAction: "Share a forecast range, not a date, in the launch brief.",
    owner: "Priya (PM)",
  },
  {
    text: "Legal review of the new payment terms landed in release week",
    likelihood: 2,
    impact: 5,
    preventiveAction: "Book the legal review for sprint 3.",
    owner: "Priya (PM)",
  },
  {
    text: "Missing analytics hid the conversion drop for weeks",
    likelihood: 2,
    impact: 3,
    preventiveAction: "Ship the checkout funnel dashboard before launch.",
    owner: "Mei (Android)",
  },
];

export function buildExample(): { scenario: string; causes: Cause[] } {
  return {
    scenario: EXAMPLE_SCENARIO,
    causes: ROWS.map((row, i) => ({ ...row, id: exampleId(`cause-${i + 1}`) })),
  };
}
