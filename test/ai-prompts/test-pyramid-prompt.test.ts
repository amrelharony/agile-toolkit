// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generateTestPyramidPrompts } from "@/lib/ai-prompts/test-pyramid";
import type { TestPyramid } from "@/lib/stores/workspace-types";

/**
 * The pyramid prompt reads the document as the page does
 * (lib/quality/pyramid): the shape from all three layers (an hourglass,
 * not just "e2e above unit"), by count or by run time, the run cost on
 * the basis in use, and the shape over the snapshots.
 */

const HOURGLASS: TestPyramid = {
  id: "testPyramid:current",
  unit: 48,
  integration: 6,
  e2e: 46,
  description: "Mobile `app` suite",
  snapshots: [
    { id: "s2", takenOn: "2026-10-01", unit: 48, integration: 6, e2e: 46 },
    { id: "s1", takenOn: "2026-07-01", unit: 70, integration: 20, e2e: 10 },
  ],
};

describe("generateTestPyramidPrompts", () => {
  const [diagnosis, rebalance] = generateTestPyramidPrompts({ doc: HOURGLASS });

  it("names the shape from all three layers, with the tolerance", () => {
    expect(diagnosis.prompt).toContain(
      "Shape: Hourglass: 48% unit, 6% integration, 46% e2e. The middle layer is thin. The shape is weighed by test count."
    );
    expect(diagnosis.prompt).toContain("layers within 5 points count as level");
    expect(diagnosis.prompt).toContain("The page reads the suite as hourglass");
  });

  it("gives each layer's count, share and relative run cost", () => {
    expect(diagnosis.prompt).toContain("| Unit | 48 | 48% | 48 (× 1) |");
    expect(diagnosis.prompt).toContain("| End-to-end | 46 | 46% | 1,150 (× 25) |");
    expect(diagnosis.prompt).toContain(
      "Run cost: 1,228 (index: each unit test 1, integration 5, e2e 25)."
    );
  });

  it("reads the shape over the snapshots, oldest first", () => {
    expect(rebalance.prompt).toContain("| 2026-07-01 | Pyramid | 70% | 20% | 10% |");
    expect(rebalance.prompt).toContain("| 2026-10-01 | Hourglass | 48% | 6% | 46% |");
    expect(rebalance.prompt).toContain(
      "From 1 Jul 2026 to 1 Oct 2026 the suite went from pyramid to hourglass; unit tests fell from 70% to 48%."
    );
    expect(rebalance.prompt).toContain("Mobile 'app' suite");
  });

  it("weighs by run time when the page does, with the minutes as the cost", () => {
    const [p] = generateTestPyramidPrompts({
      doc: {
        id: "testPyramid:current",
        unit: 500,
        integration: 100,
        e2e: 20,
        runtime: { unit: 2, integration: 6, e2e: 12 },
        weighting: "runtime",
      },
    });
    expect(p.prompt).toContain(
      "Shape: Ice-cream cone by run time: 10% unit, 30% integration, 60% e2e."
    );
    expect(p.prompt).toContain("| Unit | 500 | 81% | 2 min | 2 min |");
    expect(p.prompt).toContain("Run cost: 20 min (minutes of CI time for one full run).");
    expect(p.prompt).toContain("No snapshots taken yet.");
    expect(generateTestPyramidPrompts({ doc: null })).toEqual([]);
    expect(
      generateTestPyramidPrompts({ doc: { id: "x", unit: 0, integration: 0, e2e: 0 } })
    ).toEqual([]);
  });

  it("lists the latest 12 snapshots, says so, and reads the summary over all of them", () => {
    // A pyramid in January, then an hourglass every week after it: 13 in all.
    const snapshots = [
      { id: "s0", takenOn: "2026-01-05", unit: 70, integration: 20, e2e: 10 },
      ...Array.from({ length: 12 }, (_, i) => ({
        id: `s${i + 1}`,
        takenOn: new Date(Date.UTC(2026, 6, 6 + 7 * i)).toISOString().slice(0, 10),
        unit: 48,
        integration: 6,
        e2e: 46,
      })),
    ];
    const [p] = generateTestPyramidPrompts({ doc: { ...HOURGLASS, snapshots } });
    expect(p.prompt).toContain("(Showing the latest 12 of 13 snapshots)");
    expect(p.prompt).not.toContain("| 2026-01-05 |");
    expect(p.prompt).toContain("| 2026-07-06 | Hourglass |");
    // As the page's chart reads it: from the first snapshot, not the first one listed.
    expect(p.prompt).toContain("From 5 Jan 2026 to 21 Sept 2026 the suite went from pyramid");
  });
});
