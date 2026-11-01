import { exampleId } from "@/lib/utils/example-id";
import type {
  KeyResult,
  KeyResultCheckIn,
  KeyResultDirection,
  Okr,
} from "@/lib/stores/workspace-types";
import { currentQuarter } from "@/lib/roadmap/quarters";
import { todayLocalISO } from "@/lib/utils/formatters";

/** [days ago, value, confidence or null for not scored]. */
type Reading = [daysAgo: number, value: number, confidence: number | null];

interface ExampleKr {
  title: string;
  direction: KeyResultDirection;
  baseline: number;
  target: number;
  unit: string;
  readings: Reading[];
}

/**
 * A mobile checkout team's quarter, checked in every couple of weeks. The
 * first objective has a shipped key result next to a stalled one that
 * should fall (payment-step drop-off) and whose confidence is sliding,
 * last checked in over two weeks ago; the second is steadier, with a
 * decreasing key result (failed payments) on its way down.
 */
const OBJECTIVES: { objective: string; description: string; owner: string; krs: ExampleKr[] }[] = [
  {
    objective: "Make checkout effortless on mobile",
    description: "Most abandoned carts drop out at the payment step on phones.",
    owner: "Priya",
    krs: [
      {
        title: "Ship one-tap wallet checkout to every app user",
        direction: "increase",
        baseline: 0,
        target: 100,
        unit: "%",
        readings: [
          [40, 20, 7],
          [26, 60, 8],
          [12, 100, 9],
        ],
      },
      {
        title: "Returning shoppers paying with a saved card",
        direction: "increase",
        baseline: 18,
        target: 40,
        unit: "%",
        readings: [
          [40, 20, 7],
          [26, 23, 6],
          [12, 26, 6],
        ],
      },
      {
        title: "Shoppers dropping out at the payment step on phones",
        direction: "decrease",
        baseline: 34,
        target: 20,
        unit: "%",
        readings: [
          [44, 33, 6],
          [30, 33, 4],
          [16, 32, 3],
        ],
      },
    ],
  },
  {
    objective: "Stop losing orders to payment errors",
    description: "Declined and timed-out payments cost us about 1 order in 12.",
    owner: "Ana",
    krs: [
      {
        title: "Failed card payments recovered by automatic retry",
        direction: "increase",
        baseline: 0,
        target: 1000,
        unit: "payments",
        readings: [
          [38, 200, 6],
          [24, 410, 7],
          [10, 640, 7],
        ],
      },
      {
        title: "Card payments that fail",
        direction: "decrease",
        baseline: 8,
        target: 3,
        unit: "%",
        readings: [
          [38, 7, 5],
          [24, 5.5, 6],
          [10, 4.5, 7],
        ],
      },
      {
        title: "Card-declined messages rewritten in plain language",
        direction: "increase",
        baseline: 0,
        target: 12,
        unit: "messages",
        readings: [
          [24, 4, null],
          [3, 12, 10],
        ],
      },
    ],
  },
];

/** "YYYY-MM-DD", `n` local days before `now`. */
const daysBefore = (now: Date, n: number) =>
  todayLocalISO(new Date(now.getFullYear(), now.getMonth(), now.getDate() - n));

/**
 * The example objectives for the quarter `now` is in, every id an
 * `example-` one ("Clear example" removes exactly these). The key results'
 * current value and confidence are their newest check-in's, as
 * lib/okrs withCheckIn would leave them.
 */
export function buildExample(now: Date = new Date()): Okr[] {
  return OBJECTIVES.map((o, i) => ({
    id: exampleId(`okr-${i + 1}`),
    objective: o.objective,
    description: o.description,
    owner: o.owner,
    quarter: currentQuarter(now),
    keyResults: o.krs.map((kr, k): KeyResult => {
      const checkIns = kr.readings.map(
        ([ago, value, confidence], c): KeyResultCheckIn => ({
          id: exampleId(`okr-${i + 1}-kr-${k + 1}-ci-${c + 1}`),
          date: daysBefore(now, ago),
          value,
          ...(confidence !== null ? { confidence } : {}),
        })
      );
      const last = checkIns[checkIns.length - 1];
      const scored = [...checkIns].reverse().find((c) => c.confidence !== undefined);
      return {
        id: exampleId(`okr-${i + 1}-kr-${k + 1}`),
        title: kr.title,
        direction: kr.direction,
        baseline: kr.baseline,
        target: kr.target,
        unit: kr.unit,
        current: last.value,
        ...(scored?.confidence !== undefined ? { confidence: scored.confidence } : {}),
        checkIns,
      };
    }),
  }));
}
