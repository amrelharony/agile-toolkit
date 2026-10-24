import { exampleId } from "@/components/tool-frame/example-data";
import type { IcebreakerUse } from "./store";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A team that opens every ceremony with a warm-up: "Two Truths and a Lie"
 * at planning two days ago and the weather-report retro warm-up nine days
 * ago are both recent, so the picker flags them, while the Gratitude Round
 * three weeks ago is fair game again. "Estimate This" is on screen as the
 * next one to try. The uses carry `example-` ids, so Clear example removes
 * exactly them; favourites are left alone.
 */
const USES: [key: string, icebreakerId: string, daysAgo: number, minutes: number][] = [
  ["use-1", "q-1", 2, 10],
  ["use-2", "ag-2", 9, 5],
  ["use-3", "a-7", 23, 5],
];

export const EXAMPLE_SELECTED_ID = "ag-5";

export function buildExample(now: Date = new Date()): {
  used: IcebreakerUse[];
  selectedId: string;
} {
  return {
    used: USES.map(([key, icebreakerId, days, minutes]) => ({
      id: exampleId(key),
      icebreakerId,
      usedAt: new Date(now.getTime() - days * DAY_MS).toISOString(),
      minutes,
    })),
    selectedId: EXAMPLE_SELECTED_ID,
  };
}
