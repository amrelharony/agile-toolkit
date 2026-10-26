// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generateRicePrompts } from "@/lib/ai-prompts/rice-scoring";
import { rankMethodRows } from "@/lib/prioritization/rank";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";

/**
 * The RICE prompt reads the rows as the page does: reach as entered with
 * its period and the reach per quarter the score used, RICE to one decimal
 * place, a legacy effort below the 0.5 minimum counted as 0.5 with the
 * row's warning, and a row missing an input named as not scored, never 0.
 */

const row = (id: string, title: string, fields: Record<string, number | string>) =>
  ({
    id,
    framework: "rice",
    title,
    fields,
    status: "scored",
    updatedAt: "2026-10-20T09:00:00.000Z",
  }) satisfies PrioritizationItem;

const ranked = rankMethodRows("rice", [
  row("t", "Tiny effort", {
    reach: 100,
    reachPeriod: "quarter",
    impact: 1,
    confidence: 80,
    effort: 0.25,
  }),
  row("n", "No effort yet", { reach: 100, impact: 1, confidence: 80 }),
  row("w", "Weekly reach", {
    reach: 100,
    reachPeriod: "week",
    impact: 2,
    confidence: 50,
    effort: 1,
  }),
]);

describe("generateRicePrompts", () => {
  const [p] = generateRicePrompts(
    { rows: ranked, outliers: new Set(["w"]), verdict: "Do first: “Weekly reach”." },
    null
  );

  it("states reach per period and per quarter, and RICE as the rows show it", () => {
    // 100 a week is 1,300 a quarter: 1,300 × 2 × 50% ÷ 1 = 1,300.
    expect(p.prompt).toContain(
      "| 1 | Weekly reach | 100 per week | 1,300 | 2 | 50% | 1 | 1,300 | — |"
    );
  });

  it("counts an effort below 0.5 as 0.5 and says so", () => {
    // 100 × 1 × 80% ÷ 0.5 = 160.
    expect(p.prompt).toContain(
      "| 2 | Tiny effort | 100 per quarter | 100 | 1 | 80% | 0.25 | 160 | Effort 0.25 is below the 0.5 minimum and counts as 0.5. Edit it. |"
    );
  });

  it("names a row missing an input instead of scoring it 0", () => {
    expect(p.prompt).toContain("Not scored yet: “No effort yet” (needs effort).");
    expect(p.prompt).not.toContain("| No effort yet |");
  });

  it("lists the page's outliers and verdict inside the untrusted block", () => {
    expect(p.prompt).toContain("## Outliers (recheck inputs)\n\n- Weekly reach: RICE 1,300");
    expect(p.prompt).toContain("Verdict: Do first: “Weekly reach”.");
    expect(p.prompt.indexOf("Verdict:")).toBeGreaterThan(p.prompt.indexOf("<user_content>"));
    expect(p.prompt).toContain("under 50% is a moonshot: test it first");
    expect(generateRicePrompts({ rows: [] })).toEqual([]);
  });
});
