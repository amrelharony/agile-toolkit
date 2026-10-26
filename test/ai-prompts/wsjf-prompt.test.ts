// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generateWsjfPrompts } from "@/lib/ai-prompts/wsjf";
import { rankMethodRows } from "@/lib/prioritization/rank";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";

/**
 * The WSJF prompt reads the rows as the page does: every part on the
 * Fibonacci scale (an off-scale stored value marked custom, never
 * snapped), the cost of delay, WSJF to two places with the job size floor
 * of 1 and its warning, and a title-only row named as not scored.
 */

const row = (id: string, title: string, fields: Record<string, number>) =>
  ({
    id,
    framework: "wsjf",
    title,
    fields,
    status: "scored",
    updatedAt: "2026-10-20T09:00:00.000Z",
  }) satisfies PrioritizationItem;

const ranked = rankMethodRows("wsjf", [
  row("odd", "Odd value", { businessValue: 7, timeCriticality: 1, rrOe: 1, jobSize: 3 }),
  row("login", "Login", { businessValue: 8, timeCriticality: 13, rrOe: 3, jobSize: 2 }),
  // Saved before the floor: a job size of 0.5 counts as 1.
  row("legacy", "Legacy size", { businessValue: 5, timeCriticality: 3, rrOe: 2, jobSize: 0.5 }),
  row("title", "Title only", {}),
]);

describe("generateWsjfPrompts", () => {
  const [p] = generateWsjfPrompts({ rows: ranked, verdict: "Do first: “Login”." }, null);

  it("states each part, the cost of delay and WSJF to two places", () => {
    expect(p.prompt).toContain("| 1 | Login | 8 | 13 | 3 | 2 | 24 | 12.00 | — |");
    expect(p.prompt).toContain("| 3 | Odd value | 7 (custom) | 1 | 1 | 3 | 9 | 3.00 | — |");
  });

  it("divides by the job size floor of 1 and says so", () => {
    expect(p.prompt).toContain(
      "| 2 | Legacy size | 5 | 3 | 2 | 0.5 (custom) | 10 | 10.00 | Job size 0.5 is below 1, the smallest on the scale: it counts as 1. |"
    );
  });

  it("names a title-only row as not scored, with the parts it needs", () => {
    expect(p.prompt).toContain(
      "Not scored yet: “Title only” (needs business value, time criticality, risk reduction / opportunity enablement, job size)."
    );
    expect(p.prompt).toContain("Verdict: Do first: “Login”.");
    expect(p.prompt).toContain("1, 2, 3, 5, 8, 13 or 20");
    expect(generateWsjfPrompts({ rows: [] })).toEqual([]);
  });
});
