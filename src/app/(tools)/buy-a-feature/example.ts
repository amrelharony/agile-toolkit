import { exampleId } from "@/components/tool-frame/example-data";
import {
  BUY_A_FEATURE_ID,
  type AllocationRound,
  type BuyAFeatureGame,
  type PrioritizationItem,
} from "@/lib/stores/workspace-types";
import { allocationBandEdges } from "@/lib/realtime/vote-room/allocation";
import { newFeatureRow, withRaised } from "@/lib/buy-a-feature/game";

/** A read-only preview: none of it reaches the workspace. */
export interface BuyAFeatureExample {
  rows: PrioritizationItem[];
  game: BuyAFeatureGame;
  rounds: AllocationRound[];
}

/**
 * Five customer advisers plan a reporting product's next release, $100
 * each: a $500 pool against $1,150 of features, so they can fund well
 * under half. In the first round they pooled money on saved searches
 * (funded), put a deposit on single sign-on and the CSV export, and left
 * dark mode and offline mode alone.
 *
 * The round's totals and bands are what these five splits fold into
 * (saved searches, CSV export, SSO, dark mode, offline, usage dashboard):
 *   40 20 40 0 0 0 · 30 10 30 0 0 10 · 30 20 0 0 0 20 · 20 0 20 0 0 0 · 0 0 10 0 0 0
 * Only the totals and bands are in the example, as in a saved round.
 */
const FEATURES: [string, string, number, number][] = [
  ["searches", "Saved searches", 120, 120],
  ["export", "Bulk export to CSV", 80, 50],
  ["sso", "Single sign-on", 300, 100],
  ["dark", "Dark mode", 60, 0],
  ["offline", "Offline mode", 400, 0],
  ["usage", "Usage dashboard", 190, 30],
];

const ROUND: [string, number, number[]][] = [
  ["searches", 120, [1, 0, 1, 3, 0]],
  ["export", 50, [2, 1, 2, 0, 0]],
  ["sso", 100, [1, 1, 1, 2, 0]],
  ["dark", 0, [5, 0, 0, 0, 0]],
  ["offline", 0, [5, 0, 0, 0, 0]],
  ["usage", 30, [3, 1, 1, 0, 0]],
];

/** The day before `now`, YYYY-MM-DD (the round ran yesterday). */
function dayBefore(now: Date): string {
  const d = new Date(now);
  d.setDate(d.getDate() - 1);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function buildExample(now: Date = new Date()): BuyAFeatureExample {
  const updatedAt = now.toISOString();
  const date = dayBefore(now);
  const byKey = new Map(FEATURES.map(([key, title, price]) => [key, { title, price }]));
  return {
    rows: FEATURES.map(([key, title, price, raised]) =>
      withRaised(newFeatureRow(exampleId(`buy-${key}`), title, price, updatedAt), raised, updatedAt)
    ),
    game: { id: BUY_A_FEATURE_ID, players: 5, budgetPerPlayer: 100, unit: "$", updatedAt },
    rounds: [
      {
        id: exampleId("buy-round-1"),
        tool: "buy-a-feature",
        roundId: exampleId("round-1"),
        title: "Buy-a-Feature, round 1",
        budget: 100,
        unit: "$",
        spendAll: false,
        date,
        closedAt: `${date}T15:00:00.000Z`,
        minN: 3,
        ballots: 5,
        source: "room",
        bandEdges: allocationBandEdges(100),
        items: ROUND.map(([key, total, bands]) => ({
          itemId: exampleId(`buy-${key}`),
          text: byKey.get(key)?.title ?? key,
          // Nothing was raised before the round, so each cap was its price.
          cap: byKey.get(key)?.price,
          total,
          backers: 5 - bands[0],
          bands,
        })),
      },
    ],
  };
}
