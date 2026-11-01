/**
 * quarterIndex reads "Qn YYYY" as well as "YYYY Qn" (the OKR intent wrote
 * the quarter-first form before Phase 8, and people type it), and still
 * refuses what isn't a quarter.
 */

import { describe, expect, it } from "vitest";
import { quarterIndex, quarterLabel } from "@/lib/roadmap/quarters";

describe("quarterIndex", () => {
  it('reads "Qn YYYY" as the same quarter as "YYYY Qn"', () => {
    expect(quarterIndex("Q2 2026")).toBe(quarterIndex("2026 Q2"));
    expect(quarterIndex("Q2 2026")).not.toBe(0);
    expect(quarterIndex("q4-2026")).toBe(quarterIndex("2026-Q4"));
    expect(quarterLabel(quarterIndex("Q1 2027"))).toBe("2027 Q1");
  });

  it("keeps refusing what isn't a quarter", () => {
    expect(quarterIndex("Q5 2026")).toBe(0);
    expect(quarterIndex("Q1 1800")).toBe(0);
    expect(quarterIndex("Q1 20261")).toBe(0);
    expect(quarterIndex("Spring 2026")).toBe(0);
    expect(quarterIndex("")).toBe(0);
    expect(quarterIndex(null)).toBe(0);
  });

  it("reads the year-first form first when a string holds both", () => {
    expect(quarterIndex("2026 Q3 (was Q1 2027)")).toBe(quarterIndex("2026 Q3"));
  });
});
