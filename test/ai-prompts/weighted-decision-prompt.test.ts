// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generateWeightedPrompts } from "@/lib/ai-prompts/weighted-decision";
import { matrixResult } from "@/lib/weighted/model";
import type { WeightedCriterion, WeightedOption } from "@/lib/stores/workspace-types";

/**
 * The Weighted Decision prompt reads one matrix as its table does: a cell
 * not scored is "—", never 0 (on a weight-0 criterion too), an option with
 * an empty cell has a partial total and no star, and the verdict and the
 * weight changes that flip the leader are the page's.
 */

const M = "matrix-1";

const criteria: WeightedCriterion[] = [
  { id: "cost", name: "Cost", weight: 3, matrixId: M },
  { id: "speed", name: "Speed", weight: 2, matrixId: M },
  // Weighted 0: not counted, and nobody scored it.
  { id: "legacy", name: "Legacy fit", weight: 0, matrixId: M },
];

const options: WeightedOption[] = [
  { id: "a", name: "Vendor A", scores: { cost: 8, speed: 6 }, matrixId: M },
  { id: "b", name: "Vendor B", scores: { cost: 5, speed: 9 }, matrixId: M },
  // Speed not scored yet.
  { id: "c", name: "Vendor C", scores: { cost: 9 }, matrixId: M },
];

const result = matrixResult(M, criteria, options);
const [prompt] = generateWeightedPrompts({
  result,
  options,
  matrix: { name: "Vendors", question: "Which vendor do we pick?" },
});

describe("generateWeightedPrompts", () => {
  it("prints a cell not scored as —, never 0, and stars only a complete leader", () => {
    expect(prompt.prompt).toContain(
      "| Option | Cost (w3) | Speed (w2) | Legacy fit (w0, not counted) | Total |"
    );
    expect(prompt.prompt).toContain("| Vendor A | 8 | 6 | — | 36 ★ |");
    expect(prompt.prompt).toContain("| Vendor B | 5 | 9 | — | 33 |");
    expect(prompt.prompt).toContain("| Vendor C | 9 | — | — | partial 27 (1 not scored) |");
    const scores = prompt.prompt.slice(
      prompt.prompt.indexOf("## Scores"),
      prompt.prompt.indexOf("## Sensitivity")
    );
    expect(scores).not.toMatch(/\| 0 \|/);
  });

  it("states the criteria's shares, the verdict and the flips as the page does", () => {
    expect(prompt.prompt).toContain("Decision: Which vendor do we pick?");
    expect(prompt.prompt).toContain("| Cost | 3 | 60% |");
    expect(prompt.prompt).toContain("| Legacy fit | 0 | not counted |");
    expect(prompt.prompt).toContain(`Verdict: ${result.verdict}`);
    expect(result.verdict).toMatch(/^Vendor A leads with 36/);
    expect(prompt.prompt).toContain("- Weighting Cost 34% less makes Vendor B the winner.");
  });

  it("keeps the names inside the untrusted block", () => {
    const open = prompt.prompt.indexOf("<user_content>");
    expect(open).toBeGreaterThan(-1);
    expect(prompt.prompt.indexOf("Vendor A")).toBeGreaterThan(open);
  });

  it("has nothing to ask about a matrix without options or criteria", () => {
    expect(generateWeightedPrompts({ result: matrixResult(M, criteria, []), options: [] })).toEqual(
      []
    );
  });
});
