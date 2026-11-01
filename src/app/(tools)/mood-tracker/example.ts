import { exampleId } from "@/components/tool-frame/example-data";
import type { MoodPulse } from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";

type Counts = MoodPulse["counts"];

/**
 * Two weeks of anonymous pulses from a team of six: [days ago, counts of
 * each face 1–5]. Steady around 3.5 for the first week, a dip after a
 * missed release, then three low days in a row (2.2, 2.2, 2.0) at the end:
 * the low-mood streak the page offers to raise at the retro. Weekends have
 * no pulse.
 */
const PULSES: [daysAgo: number, counts: Counts][] = [
  [13, { 1: 0, 2: 1, 3: 2, 4: 2, 5: 1 }],
  [12, { 1: 0, 2: 1, 3: 1, 4: 3, 5: 1 }],
  [11, { 1: 0, 2: 0, 3: 2, 4: 3, 5: 1 }],
  [8, { 1: 0, 2: 1, 3: 2, 4: 2, 5: 1 }],
  [7, { 1: 0, 2: 1, 3: 3, 4: 2, 5: 0 }],
  [6, { 1: 1, 2: 1, 3: 2, 4: 2, 5: 0 }],
  [5, { 1: 0, 2: 2, 3: 2, 4: 2, 5: 0 }],
  [2, { 1: 1, 2: 3, 3: 2, 4: 0, 5: 0 }],
  [1, { 1: 2, 2: 2, 3: 1, 4: 1, 5: 0 }],
  [0, { 1: 1, 2: 3, 3: 1, 4: 0, 5: 0 }],
];

/**
 * The example's pulses, with `exampleId` ids. Pulses only, so the team
 * roster is never touched; the page shows them as a read-only preview in
 * the anonymous mode and never writes them into the workspace.
 */
export function buildExample(now: Date = new Date()): MoodPulse[] {
  const day = (n: number) =>
    todayLocalISO(new Date(now.getFullYear(), now.getMonth(), now.getDate() - n));
  return PULSES.map(([ago, counts], i) => ({
    id: exampleId(`pulse-${i + 1}`),
    date: day(ago),
    counts,
    source: "room",
    createdAt: `${day(ago)}T09:30:00.000Z`,
  }));
}
