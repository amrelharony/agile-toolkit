// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generateQualityCostPrompts } from "@/lib/ai-prompts/quality-cost";
import type { QualityCostPeriod } from "@/lib/quality/cost";

/**
 * The cost-of-quality prompt reads the quarters as the page does
 * (lib/quality/cost): every quarter's costs as entered ("Not entered",
 * never $0), its total and failure share, the change on the quarter
 * before, how far the trend test is, the verdict, and the quarter on
 * screen in detail.
 */

const PERIODS: QualityCostPeriod[] = [
  {
    id: "p1",
    period: "2026-Q1",
    costs: { prevention: 1000, detection: 1000, internalFailure: 2000, externalFailure: 1000 },
  },
  {
    id: "p2",
    period: "2026-Q2",
    costs: { prevention: 3000, detection: 1000, internalFailure: 1000 },
    note: "New `lint` gate",
  },
  { id: "p3", period: "2026-Q3", costs: { internalFailure: 500 } },
];

describe("generateQualityCostPrompts", () => {
  const [interpretation, investment] = generateQualityCostPrompts({
    periods: PERIODS,
    shownId: "p2",
  });

  it("lists every quarter as entered, with its total and failure share", () => {
    expect(interpretation.prompt).toContain(
      "| 2026-Q1 | $1,000 | $1,000 | $2,000 | $1,000 | $5,000 | 60% |"
    );
    expect(interpretation.prompt).toContain(
      "| 2026-Q2 | $3,000 | $1,000 | $1,000 | Not entered | $5,000 | 20% |"
    );
    expect(interpretation.prompt).toContain(
      "| 2026-Q3 | Not entered | Not entered | $500 | Not entered | $500 | — |"
    );
  });

  it("states the verdict, the change on the quarter before and the trend test's need", () => {
    expect(interpretation.prompt).toContain(
      "Failure costs were 20% of quality spend in 2026-Q2, down 40 points on 2026-Q1."
    );
    expect(investment.prompt).toContain(
      "The failure share fell from 60% in 2026-Q1 to 20% in 2026-Q2. Down 40 points on 2026-Q1. A trend test needs 6 quarters with a failure share (2 so far)."
    );
  });

  it("details the quarter on screen, leaving what wasn't entered out of the shares", () => {
    expect(interpretation.prompt).toContain("## 2026-Q2 in detail");
    expect(interpretation.prompt).toContain("| Prevention | $3,000 | 60% |");
    expect(interpretation.prompt).toContain("| External failure | Not entered | — |");
    expect(interpretation.prompt).toContain(
      "Conformance (prevention + detection) $4,000; non-conformance (internal + external failure) $1,000; failure share 20%. Not entered for 2026-Q2: external failure."
    );
    expect(interpretation.prompt).toContain("Note on 2026-Q2: New 'lint' gate");
  });

  it("defaults to the latest quarter, whose share needs a cost on each side", () => {
    const [p] = generateQualityCostPrompts({ periods: PERIODS });
    expect(p.prompt).toContain("## 2026-Q3 in detail");
    expect(p.prompt).toContain("failure share — (needs a cost on each side)");
    expect(p.prompt).not.toContain("$0");
    expect(generateQualityCostPrompts({ periods: [] })).toEqual([]);
  });
});
