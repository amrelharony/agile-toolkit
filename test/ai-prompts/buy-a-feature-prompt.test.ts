// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generateBuyAFeaturePrompts } from "@/lib/ai-prompts/buy-a-feature";
import type { BuyAFeatureGame, PrioritizationItem } from "@/lib/stores/workspace-types";

/**
 * The Buy-a-Feature prompt reads the game through its ledger, as the page
 * does: what a feature raised is capped at its price (an old row that took
 * more counts at the price, 100% funded at most), a price of 0 is "Not
 * priced", amounts carry the game's unit, and the pool and the verdict are
 * the page's.
 */

const feature = (id: string, title: string, fields: Record<string, number | string>) =>
  ({
    id,
    framework: "buy-feature",
    title,
    fields,
    status: "open",
    updatedAt: "2026-10-20T09:00:00.000Z",
  }) satisfies PrioritizationItem;

const items: PrioritizationItem[] = [
  feature("b", "Dark mode", { price: 200, raised: 50 }),
  // Saved before purchases were capped: it took more than its price.
  feature("a", "SSO", { price: 100, raised: 150 }),
  // A legacy price of 0.
  feature("c", "Offline sync", { price: 0, raised: 0 }),
  // Another tool's row is left out.
  { ...feature("x", "A $100 item", { allocation: 40 }), framework: "hundred-dollar" },
];

const game: BuyAFeatureGame = {
  id: "buy-a-feature",
  players: 3,
  budgetPerPlayer: 80,
  updatedAt: "2026-10-20T09:00:00.000Z",
};

describe("generateBuyAFeaturePrompts", () => {
  const [prompt] = generateBuyAFeaturePrompts({ items, game }, null);

  it("caps raised at the price and % funded at 100, most raised first", () => {
    expect(prompt.prompt).toContain("| SSO | $100 | $100 | 100% | Funded |");
    expect(prompt.prompt).toContain("| Dark mode | $200 | $50 | 25% | Pledged, $150 to go |");
    expect(prompt.prompt.indexOf("| SSO |")).toBeLessThan(prompt.prompt.indexOf("| Dark mode |"));
    expect(prompt.prompt).not.toContain("150%");
  });

  it("reads a price of 0 as not priced and leaves other tools' rows out", () => {
    expect(prompt.prompt).toContain("| Offline sync | Not priced | $0 | — | Not priced |");
    expect(prompt.prompt).not.toContain("A $100 item");
  });

  it("states the pool and the verdict as the page does", () => {
    expect(prompt.prompt).toContain(
      "3 players × $80 = $240 can buy 80% of the $300 of features. Spent: $150; left in the pool: $90."
    );
    expect(prompt.prompt).toContain(
      "Verdict: Funded 1 of 2 features (SSO), with $90 of the $240 pool left."
    );
  });

  it("uses the game's unit", () => {
    const [pts] = generateBuyAFeaturePrompts({ items, game: { ...game, unit: "pts" } });
    expect(pts.prompt).toContain("| SSO | 100 pts | 100 pts | 100% | Funded |");
  });

  it("says when the players and budget aren't set, and has nothing to ask without features", () => {
    const [unset] = generateBuyAFeaturePrompts({ items, game: null });
    expect(unset.prompt).toContain("The players and their budget aren't set yet.");
    expect(generateBuyAFeaturePrompts({ items: [], game })).toEqual([]);
  });
});
