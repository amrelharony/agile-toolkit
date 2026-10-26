// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generateValueEffortPrompts } from "@/lib/ai-prompts/value-effort-matrix";
import { veVerdict } from "@/app/(tools)/value-effort-matrix/verdict";
import { rankMethodRows } from "@/lib/prioritization/rank";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";

/**
 * The Value vs Effort prompt reads the matrix as the page does: value on
 * the Fibonacci scale (high from 8), effort 1–10 (high from 6), the
 * quadrant derived from both, never stored, value ÷ effort, items not
 * placed yet, and the rows' notes on an off-scale or old 1–10 value.
 */

const row = (id: string, title: string, fields: Record<string, number | string>) =>
  ({
    id,
    framework: "value-effort",
    title,
    fields,
    status: "open",
    updatedAt: "2026-10-20T09:00:00.000Z",
  }) satisfies PrioritizationItem;

const ranked = rankMethodRows("value-effort", [
  row("t", "Tooltip", { businessValue: 2, effort: 1 }),
  row("s", "Search", { businessValue: 13, effort: 3 }),
  // A stored quadrant is never read: 20 and 9 are a Big Bet.
  row("p", "Platform rewrite", { businessValue: 20, effort: 9, quadrant: "Quick Wins" }),
  // The old 1–10 value: 4 reads as 5.
  row("l", "Legacy row", { value: 4, effort: 7 }),
  row("o", "Odd value", { businessValue: 7, effort: 2 }),
  row("i", "Idea", {}),
]);

describe("generateValueEffortPrompts", () => {
  const [p] = generateValueEffortPrompts({ rows: ranked, items: [] }, null);

  it("derives each quadrant from the Fibonacci value and the 1–10 effort", () => {
    expect(p.prompt).toContain("| Search | Quick Wins | 13 | 3 | 4.33 |");
    expect(p.prompt).toContain("| Platform rewrite | Big Bets | 20 | 9 | 2.22 |");
    expect(p.prompt).toContain("| Tooltip | Fill-Ins | 2 | 1 | 2 |");
    expect(p.prompt).toContain("| Legacy row | Time Wasters | 5 | 7 | 0.71 |");
    expect(p.prompt).toContain("| Idea | Not placed yet | — | — | — |");
    expect(p.prompt).toContain(
      "Quick Wins 1 · Big Bets 1 · Fill-Ins 2 · Time Wasters 1 · Not placed yet 1"
    );
  });

  it("says what the rows say about an off-scale or old value", () => {
    expect(p.prompt).toContain(
      "- Odd value: Value 7 is off the scale (1, 2, 3, 5, 8, 13 or 20). Edit to fix."
    );
    expect(p.prompt).toContain(
      "- Legacy row: Value 5 is read from the old 1–10 value 4: edit and save to keep it, or pick another."
    );
    expect(p.prompt).toContain(`Verdict: ${veVerdict(ranked)}`);
    expect(p.prompt).toContain("high from 8");
    expect(p.prompt).toContain("high from 6");
  });

  it("has nothing to ask about an empty matrix", () => {
    expect(generateValueEffortPrompts({ rows: [] })).toEqual([]);
  });
});
