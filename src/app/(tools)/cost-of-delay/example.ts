import { exampleId } from "@/lib/utils/example-id";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";
import { methodRow } from "@/lib/prioritization/binding";
import type { CodUrgency } from "@/lib/prioritization/methods/cost-of-delay";
import { isoDayNumber, isoFromDayNumber } from "@/lib/sprints/calendar";
import { todayIso } from "@/lib/sprints/series";

type Inputs = {
  perWeekUsd: number;
  durationWeeks: number;
  urgency: CodUrgency;
  /** Weeks from today the work must land by (fixed date only). */
  landsInWeeks?: number;
};

/**
 * A mobile checkout team's queue, one of each urgency profile. The
 * double-charge bug is an expedite: drop everything. The accessibility
 * deadline is a fixed date six weeks out with four weeks of work, so it
 * must start within two weeks. Of the standard work, saved cards beat the
 * wallet on CD3 (a shorter job with nearly the same cost of waiting), and
 * the framework migration is intangible: cheap to wait on now.
 */
const ROWS: [string, Inputs][] = [
  ["Fix the double-charge bug", { perWeekUsd: 40000, durationWeeks: 1, urgency: "expedite" }],
  [
    "Meet the accessibility deadline",
    { perWeekUsd: 25000, durationWeeks: 4, urgency: "fixed_date", landsInWeeks: 6 },
  ],
  ["One-tap wallet checkout", { perWeekUsd: 12000, durationWeeks: 3, urgency: "standard" }],
  [
    "Saved cards for returning shoppers",
    { perWeekUsd: 9000, durationWeeks: 2, urgency: "standard" },
  ],
  ["Address autocomplete", { perWeekUsd: 3000, durationWeeks: 1, urgency: "standard" }],
  [
    "Move payments off the old framework",
    { perWeekUsd: 2000, durationWeeks: 6, urgency: "intangible" },
  ],
];

/**
 * The example rows, scored by the registry (example- ids, so Clear example
 * removes them). The fixed date is counted from `now`, so the example
 * always reads as a deadline ahead.
 */
export function buildExample(now: Date = new Date()): PrioritizationItem[] {
  const updatedAt = now.toISOString();
  const today = isoDayNumber(todayIso(now)) as number;
  return ROWS.map(([title, { landsInWeeks, ...values }], i) =>
    methodRow({
      id: exampleId(`cod-${i + 1}`),
      framework: "cost-of-delay",
      title,
      values: {
        ...values,
        fixedDate:
          landsInWeeks === undefined ? undefined : isoFromDayNumber(today + landsInWeeks * 7),
      },
      now: updatedAt,
    })
  );
}
