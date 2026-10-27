import { exampleId } from "@/components/tool-frame/example-data";
import { currentQuarterIndex, dashQuarter } from "@/lib/roadmap/quarters";
import type { QualityCostPeriod, QualityCostState } from "@/lib/quality/cost";

/** The example's blended rate: what one hour of the team's time costs. */
export const EXAMPLE_RATE = 75;

/**
 * Six quarters ending with the last full one: failure costs climb for three
 * quarters, then fall once the team spends more on prevention (review
 * pairing, a test day), so the trend and its verdict have a story to tell.
 * The last quarter's prevention cost is 200 hours at the example's rate.
 */
const QUARTERS: readonly {
  prevention: number;
  detection: number;
  internalFailure: number;
  externalFailure: number;
  note?: string;
  preventionHours?: number;
}[] = [
  { prevention: 8000, detection: 12000, internalFailure: 9000, externalFailure: 6000 },
  { prevention: 8500, detection: 12500, internalFailure: 10500, externalFailure: 8000 },
  {
    prevention: 9000,
    detection: 13000,
    internalFailure: 11000,
    externalFailure: 9500,
    note: "Two production incidents on checkout.",
  },
  {
    prevention: 12000,
    detection: 14000,
    internalFailure: 9500,
    externalFailure: 7000,
    note: "Started pairing on reviews and a monthly test day.",
  },
  { prevention: 14000, detection: 15000, internalFailure: 8000, externalFailure: 5000 },
  {
    prevention: 15000,
    detection: 15500,
    internalFailure: 7000,
    externalFailure: 4000,
    preventionHours: 200,
  },
];

/** The example's blob, held in memory by the page: nothing in it is saved. */
export function buildExample(now: Date = new Date()): QualityCostState {
  const last = currentQuarterIndex(now) - 1;
  const periods: QualityCostPeriod[] = QUARTERS.map((q, k) => {
    const period = dashQuarter(last - (QUARTERS.length - 1 - k));
    return {
      id: exampleId(`qcp-${k + 1}`),
      period,
      costs: {
        prevention: q.prevention,
        detection: q.detection,
        internalFailure: q.internalFailure,
        externalFailure: q.externalFailure,
      },
      ...(q.preventionHours !== undefined ? { hours: { prevention: q.preventionHours } } : {}),
      ...(q.note ? { note: q.note } : {}),
    };
  });
  return { periods, hourlyRate: EXAMPLE_RATE };
}
