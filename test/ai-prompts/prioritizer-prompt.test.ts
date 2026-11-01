// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generatePrioritizerPrompts } from "@/lib/ai-prompts/prioritizer";
import type { BacklogItem } from "@/lib/stores/workspace-types";

/**
 * The Prioritizer prompt reads the backlog as the hub's table does: every
 * hub method's cell in the hub's own words (method-text over the method
 * registry), each method's "not yet" for an item it hasn't scored, never
 * 0, and "Not ordered yet" for an item Decide order hasn't placed.
 */

const STAMP = "2026-10-20T09:00:00.000Z";

const items: BacklogItem[] = [
  { id: "b", name: "Dark mode", updatedAt: STAMP },
  {
    id: "a",
    name: "Checkout",
    rank: 1,
    moscow: "must",
    businessValue: 8,
    timeCriticality: 5,
    riskReduction: 3,
    jobSize: 2,
    reach: 1000,
    reachPeriod: "quarter",
    impact: 1,
    confidence: 80,
    effort: 2,
    matrixEffort: 3,
    updatedAt: STAMP,
  },
];

describe("generatePrioritizerPrompts", () => {
  const [validate, quick] = generatePrioritizerPrompts({
    items,
    rows: [],
    verdict: "Checkout is first.",
  });

  it("gives every hub method's cell as the hub shows it, in the decided order", () => {
    expect(validate.prompt).toContain(
      "| Order | Item | MoSCoW | WSJF | RICE | Value/Effort | ICE | Kano | Cost of Delay | RICE effort (person-months) | Description |"
    );
    // WSJF (8 + 5 + 3) ÷ 2 = 8.00; RICE 1,000 × 1 × 80% ÷ 2 = 400.
    expect(validate.prompt).toContain(
      "| 1 | Checkout | Must have | 8.00 | 400 | Quick Wins (value 8, effort 3) | Not scored | Not scored | Not scored | 2 | — |"
    );
    expect(validate.prompt.indexOf("| Checkout |")).toBeLessThan(
      validate.prompt.indexOf("| Dark mode |")
    );
  });

  it("reads each method's not yet, never 0, and an unplaced item as not ordered", () => {
    expect(validate.prompt).toContain(
      "| Not ordered yet | Dark mode | Not sorted yet | Not scored | Not scored | Not placed yet | Not scored | Not scored | Not scored | — | — |"
    );
    expect(validate.prompt).toContain("Verdict: Checkout is first.");
    expect(quick.prompt).toContain("| 1 | Checkout |");
    expect(generatePrioritizerPrompts({ items: [] })).toEqual([]);
  });
});
