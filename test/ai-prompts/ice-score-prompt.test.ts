// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generateIcePrompts } from "@/lib/ai-prompts/ice-score";
import { rankMethodRows } from "@/lib/prioritization/rank";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";

/**
 * The ICE prompt reads the rows as the page does: each input 1–10 (an
 * off-scale stored value marked custom, held to 10 by the score), ICE to
 * two places, and an idea missing an input named, never scored as 0.
 */

const row = (id: string, title: string, fields: Record<string, number>) =>
  ({
    id,
    framework: "ice",
    title,
    fields,
    status: "scored",
    updatedAt: "2026-10-20T09:00:00.000Z",
  }) satisfies PrioritizationItem;

const ranked = rankMethodRows("ice", [
  row("a", "Setup checklist", { impact: 6, confidence: 5, ease: 8 }),
  // An agent stored 12: shown as custom, scored as 10.
  row("b", "Referral bonus", { impact: 12, confidence: 3, ease: 2 }),
  row("c", "Dark mode", { impact: 4 }),
]);

describe("generateIcePrompts", () => {
  const [p] = generateIcePrompts({ rows: ranked, verdict: "Do first: “Setup checklist”." }, null);

  it("states each input and ICE as the rows show them", () => {
    expect(p.prompt).toContain("| 1 | Setup checklist | 6 | 5 | 8 | 240 |");
    expect(p.prompt).toContain("| 2 | Referral bonus | 12 (custom) | 3 | 2 | 60 |");
  });

  it("names an idea missing an input instead of scoring it 0", () => {
    expect(p.prompt).toContain("Not scored yet: “Dark mode” (needs confidence, ease).");
    expect(p.prompt).not.toContain("| Dark mode |");
    expect(p.prompt).toContain("Verdict: Do first: “Setup checklist”.");
    expect(generateIcePrompts({ rows: [] })).toEqual([]);
  });
});
