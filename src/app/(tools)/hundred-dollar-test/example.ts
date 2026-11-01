import { exampleId } from "@/components/tool-frame/example-data";
import type { AllocationRound, PrioritizationItem } from "@/lib/stores/workspace-types";
import { allocationBandEdges } from "@/lib/realtime/vote-room/allocation";
import { HUNDRED_FRAMEWORK } from "@/lib/hundred-dollar/allocation";

/** A read-only preview: the rows and the round never reach the workspace. */
export interface HundredDollarExample {
  rows: PrioritizationItem[];
  rounds: AllocationRound[];
}

/**
 * A product team's next-quarter themes. The group's agreed split puts
 * search first; six people then split their own $100 anonymously and land
 * close to it, but give offline mode more than the room agreed, and
 * custom themes get almost nothing from anyone.
 *
 * The round's totals and bands are what these six splits fold into
 * (faster search, offline, dashboards, Slack alerts, themes):
 *   40 30 20 10 0 · 30 20 30 20 0 · 50 10 20 10 10
 *   20 40 10 30 0 · 35 25 25 15 0 · 30 30 15 10 15
 * Only the totals and bands are in the example, as in a saved round.
 */
const ITEMS: [string, string, number][] = [
  ["search", "Faster search", 35],
  ["offline", "Offline mode", 25],
  ["dashboards", "Team dashboards", 20],
  ["slack", "Slack alerts", 15],
  ["themes", "Custom themes", 5],
];

const ROUND: [string, number, number[]][] = [
  ["search", 205, [0, 0, 1, 5, 0]],
  ["offline", 155, [0, 1, 2, 3, 0]],
  ["dashboards", 120, [0, 1, 4, 1, 0]],
  ["slack", 95, [0, 3, 2, 1, 0]],
  ["themes", 25, [4, 1, 1, 0, 0]],
];

const TITLES = new Map(ITEMS.map(([key, title]) => [key, title]));

/** The day before `now`, YYYY-MM-DD (the round ran yesterday). */
function dayBefore(now: Date): string {
  const d = new Date(now);
  d.setDate(d.getDate() - 1);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function buildExample(now: Date = new Date()): HundredDollarExample {
  const updatedAt = now.toISOString();
  const date = dayBefore(now);
  return {
    rows: ITEMS.map(([key, title, allocation]) => ({
      id: exampleId(`hundred-${key}`),
      framework: HUNDRED_FRAMEWORK,
      title,
      score: allocation,
      fields: { allocation },
      status: "open",
      updatedAt,
    })),
    rounds: [
      {
        id: exampleId("hundred-round-1"),
        tool: "hundred-dollar-test",
        roundId: exampleId("round-1"),
        title: "$100 Test",
        budget: 100,
        unit: "$",
        spendAll: true,
        date,
        closedAt: `${date}T10:30:00.000Z`,
        minN: 3,
        ballots: 6,
        source: "room",
        bandEdges: allocationBandEdges(100),
        items: ROUND.map(([key, total, bands]) => ({
          itemId: exampleId(`hundred-${key}`),
          text: TITLES.get(key) ?? key,
          total,
          backers: 6 - bands[0],
          bands,
        })),
      },
    ],
  };
}
