// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generateRiskiestAssumptionPrompts } from "@/lib/ai-prompts/riskiest-assumption";
import type { Assumption, Hypothesis } from "@/lib/stores/workspace-types";

/**
 * The assumption prompt ranks as the page does (lib/assumptions
 * rankAssumptions): risk × (6 − evidence) with its tie-breaks, tested
 * assumptions (by status or by their hypothesis) left out and listed
 * apart, unrated ones named and never scored, an inconclusive test kept
 * in the ranking.
 */

const link = (targetId: string) => [
  { route: "hypothesis" as const, targetId, at: "2026-10-01T09:00:00.000Z" },
];

const A = (id: string, statement: string, extra: Partial<Assumption> = {}): Assumption => ({
  id,
  statement,
  status: "untested",
  ...extra,
});

const ASSUMPTIONS: Assumption[] = [
  A("a2", "Admins adopt it", { riskLevel: 4, evidenceLevel: 1, testIdea: "Ask 5 admins" }),
  A("a1", "Teams pay monthly", {
    riskLevel: 5,
    evidenceLevel: 2,
    description: `Annual plans are the norm in our segment. ${"x".repeat(80)}`,
  }),
  A("a3", "Half-rated", { riskLevel: 4 }),
  A("a4", "Already proven", { riskLevel: 5, evidenceLevel: 1, status: "validated" }),
  A("a5", "Disproved by test", { riskLevel: 5, evidenceLevel: 1, sentTo: link("h1") }),
  A("a6", "Unclear result", { riskLevel: 3, evidenceLevel: 3, sentTo: link("h2") }),
];

const HYPOTHESES: Pick<Hypothesis, "id" | "status">[] = [
  { id: "h1", status: "invalidated" },
  { id: "h2", status: "inconclusive" },
];

describe("generateRiskiestAssumptionPrompts", () => {
  const [ranking, design] = generateRiskiestAssumptionPrompts({
    assumptions: ASSUMPTIONS,
    hypotheses: HYPOTHESES,
  });

  it("ranks with the tie-breaks: a tie on score goes to the higher risk", () => {
    // The description is clamped at 80 characters.
    const described = `Annual plans are the norm in our segment. ${"x".repeat(80)}`.slice(0, 80);
    expect(ranking.prompt).toContain(
      `| 1 | Teams pay monthly | 5 | 2 | 20 | Test first | Untested | — | — | ${described} |`
    );
    expect(design.prompt).toContain(`| ${described} |`);
    expect(ranking.prompt).toContain(
      "| 2 | Admins adopt it | 4 | 1 | 20 | Test first | Untested | — | Ask 5 admins | — |"
    );
    expect(design.prompt).toContain(
      "| 3 | Unclear result | 3 | 3 | 9 | Test first | Untested | tested: inconclusive (test again) | — | — |"
    );
    expect(ranking.prompt).toContain(
      "Verdict: Test “Teams pay monthly” first: risk 5, evidence 2, score 20. 1 assumption isn't rated yet."
    );
  });

  it("leaves tested assumptions out and names the unrated ones", () => {
    expect(ranking.prompt).not.toMatch(/\| Already proven \||\| Disproved by test \|/);
    expect(ranking.prompt).toContain(
      "Tested, so out of the ranking: “Already proven” (validated); “Disproved by test” (invalidated by its hypothesis)."
    );
    expect(ranking.prompt).toContain(
      "Not rated yet, so not ranked: “Half-rated” (needs evidence)."
    );
    expect(ranking.prompt).toContain(
      "6 assumptions logged: 3 ranked, 1 not rated, 2 tested. 2 ranked with risk 4 or 5 and no test yet."
    );
  });

  it("says when nothing can be ranked yet", () => {
    const [p] = generateRiskiestAssumptionPrompts({ assumptions: [A("x", "Only idea")] });
    expect(p.prompt).toContain("Nothing is ranked yet.");
    expect(p.prompt).toContain("“Only idea” (needs risk and evidence)");
    expect(generateRiskiestAssumptionPrompts({ assumptions: [] })).toEqual([]);
  });
});
