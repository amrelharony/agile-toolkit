import { exampleId } from "@/components/tool-frame/example-data";
import type { KeyResult, Okr } from "@/lib/stores/workspace-types";

type Kr = [title: string, current: number, target: number, confidence: number];

/**
 * A mobile checkout team's quarter. The first objective (63%) has a shipped
 * KR next to a stalled, low-confidence one; the second (71%) is steadier.
 */
const OBJECTIVES: { objective: string; description: string; owner: string; krs: Kr[] }[] = [
  {
    objective: "Make checkout effortless on mobile",
    description: "Most abandoned carts drop out at the payment step on phones.",
    owner: "Priya (PM)",
    krs: [
      ["Ship one-tap wallet checkout to 100% of app users", 100, 100, 9],
      ["40% of returning shoppers pay with a saved card", 26, 40, 6],
      ["500 shoppers try guest checkout in its first month", 120, 500, 3],
    ],
  },
  {
    objective: "Stop losing orders to payment errors",
    description: "Declined and timed-out payments cost us about 1 order in 12.",
    owner: "Ana (Backend)",
    krs: [
      ["Automatic retry recovers 1,000 failed card payments", 640, 1000, 7],
      ["Rewrite all 12 card-declined messages in plain language", 12, 12, 10],
      ["4 straight weeks without a flaky checkout test in CI", 2, 4, 5],
    ],
  },
];

function quarterOf(d: Date): string {
  return `${d.getFullYear()} Q${Math.floor(d.getMonth() / 3) + 1}`;
}

export function buildExample(now: Date = new Date()): Okr[] {
  return OBJECTIVES.map((o, i) => ({
    id: exampleId(`okr-${i + 1}`),
    objective: o.objective,
    description: o.description,
    owner: o.owner,
    quarter: quarterOf(now),
    keyResults: o.krs.map(
      ([title, current, target, confidence], k): KeyResult => ({
        id: exampleId(`okr-${i + 1}-kr-${k + 1}`),
        title,
        current,
        target,
        confidence,
      })
    ),
  }));
}
