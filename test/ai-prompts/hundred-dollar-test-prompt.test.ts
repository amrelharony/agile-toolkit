// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generateHundredDollarPrompts } from "@/lib/ai-prompts/hundred-dollar-test";
import { allocationBandEdges } from "@/lib/realtime/vote-room/allocation";
import { teamAverages } from "@/lib/hundred-dollar/allocation";
import type { AllocationRound, PrioritizationItem } from "@/lib/stores/workspace-types";

/**
 * The $100 Test prompt reads the agreed split and the latest team round as
 * the page does: an item with no amount yet is "—", never $0, and each
 * item's team average, backers and middle half come from the round's
 * aggregates (lib/hundred-dollar teamAverages / compareSplit).
 */

const item = (id: string, title: string, allocation?: number): PrioritizationItem => ({
  id,
  framework: "hundred-dollar",
  title,
  fields: allocation === undefined ? {} : { allocation },
  status: "open",
  updatedAt: "2026-10-20T09:00:00.000Z",
});

const items: PrioritizationItem[] = [
  item("b", "Exports", 40),
  item("a", "Search", 60),
  // No amount given yet: not a $0.
  item("c", "Themes"),
  // Added after the round.
  item("d", "Later item", 0),
];

const round = (over: Partial<AllocationRound> = {}): AllocationRound => ({
  id: "allocationRound_1",
  tool: "hundred-dollar-test",
  roundId: "room-1",
  title: "$100 Test",
  budget: 100,
  unit: "$",
  spendAll: true,
  date: "2026-10-20",
  closedAt: "2026-10-20T10:00:00.000Z",
  minN: 3,
  ballots: 4,
  source: "room",
  bandEdges: allocationBandEdges(100),
  items: [
    { itemId: "a", text: "Search", total: 200, backers: null, bands: null },
    { itemId: "b", text: "Exports", total: 120, backers: null, bands: null },
    { itemId: "c", text: "Themes", total: 80, backers: null, bands: null },
  ],
  ...over,
});

describe("generateHundredDollarPrompts", () => {
  it("reads an item with no amount as —, never $0, without a round", () => {
    const [p] = generateHundredDollarPrompts({ items, rounds: [] }, null);
    expect(p.prompt).toContain("| Search | $60 |");
    expect(p.prompt).toContain("| Themes | — |");
    expect(p.prompt).toContain("| Later item | $0 |");
    // Biggest amount first, as the page lists them.
    expect(p.prompt.indexOf("| Search |")).toBeLessThan(p.prompt.indexOf("| Exports |"));
    expect(p.prompt).toContain("All $100 of the agreed split is given out.");
    expect(p.prompt).toContain("Verdict: Agreed split: Search leads with $60.");
  });

  it("gives each item's team average from the latest round beside the agreed split", () => {
    const older = round({ id: "allocationRound_0", date: "2026-10-01" });
    const [p] = generateHundredDollarPrompts({ items, rounds: [older, round()] }, null);
    expect(p.prompt).toContain("Latest team round (2026-10-20, live): 4 people each split $100.");
    expect(p.prompt).toContain("The spread shows from 5 answers; this round had 4.");
    expect(p.prompt).toContain("| Search | $60 | $50 | — | — |");
    expect(p.prompt).toContain("| Themes | — | $20 | — | — |");
    expect(p.prompt).toContain("| Later item | $0 | Not in this round | — | — |");
    expect(p.prompt).toContain(
      "Verdict: 4 people split $100 each: Search leads with $50 on average."
    );
  });

  it("shows backers and the middle half once the round kept its spread", () => {
    const withBands = round({
      ballots: 6,
      items: [
        { itemId: "a", text: "Search", total: 300, backers: 5, bands: [1, 0, 1, 2, 2] },
        { itemId: "b", text: "Exports", total: 200, backers: 4, bands: [2, 1, 1, 1, 1] },
        { itemId: "c", text: "Themes", total: 100, backers: 3, bands: [3, 1, 1, 1, 0] },
      ],
    });
    const middle = teamAverages(withBands).find((a) => a.itemId === "a")?.middleHalf;
    expect(middle).toBeTruthy();
    const [p] = generateHundredDollarPrompts({ items, rounds: [withBands] }, null);
    expect(p.prompt).toContain(`| Search | $60 | $50 | 5 | ${middle} |`);
    expect(p.prompt).not.toContain("The spread shows from");
  });

  it("leaves other tools' rows out and has nothing to ask without items or rounds", () => {
    const other: PrioritizationItem = { ...item("x", "A feature", 10), framework: "buy-feature" };
    expect(generateHundredDollarPrompts({ items: [other] })).toEqual([]);
  });
});
