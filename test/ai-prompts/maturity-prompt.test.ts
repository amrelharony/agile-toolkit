// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generateMaturityPrompts } from "@/lib/ai-prompts/maturity";
import { MATURITY_DIMENSIONS } from "@/lib/constants/maturity-model";
import { MATURITY_ID, maturityVerdict, roadmapFor } from "@/lib/maturity/assessment";
import type { MaturityAssessment, MaturityAssessmentEntry } from "@/lib/stores/workspace-types";

/**
 * The maturity prompt reads lib/maturity/assessment: the latest saved
 * assessment on the 0-100% scale (all 1s = 0%, all 5s = 100%), or "Not
 * assessed yet" with the draft's scores as a draft. A team that only opened
 * the tool used to reach the model as "Overall Score: 0%".
 */

const all = (level: number) => Object.fromEntries(MATURITY_DIMENSIONS.map((d) => [d.id, level]));
const entry = (id: string, assessedAt: string, scores: Record<string, number>) =>
  ({ id, assessedAt, scores }) as MaturityAssessmentEntry;
const doc = (
  history: MaturityAssessmentEntry[],
  extra: Partial<MaturityAssessment> = {}
): MaturityAssessment => ({ id: MATURITY_ID, scores: {}, targetLevel: 4, history, ...extra });

const [first, second, third] = MATURITY_DIMENSIONS;

describe("generateMaturityPrompts", () => {
  it("has no prompts while nothing is scored", () => {
    expect(generateMaturityPrompts({ doc: doc([]) })).toEqual([]);
  });

  it("reads a draft as not assessed yet, never as a 0% or a level 1", () => {
    const draft = doc([], { scores: { [first.id]: 3 } });
    const [gap] = generateMaturityPrompts({ doc: draft });
    expect(gap.prompt).toContain(maturityVerdict(draft));
    expect(gap.prompt).toContain("Overall Score: Not assessed yet.");
    expect(gap.prompt).toContain(`1 of ${MATURITY_DIMENSIONS.length} dimensions scored`);
    expect(gap.prompt).not.toMatch(/Overall Score: \d+%/);
    expect(gap.prompt).toContain(`| ${first.name} | 3 | 4 | 1 |`);
    expect(gap.prompt).toContain(`| ${second.name} | Not scored | 4 | — |`);
    expect(gap.prompt).toContain(`Biggest gaps: ${first.name} (gap: 1)`);
  });

  it("reads the latest saved assessment on the 0-100% scale, with the page's roadmap", () => {
    const latest = entry("b", "2026-09-01", { ...all(3), [second.id]: 1, [third.id]: 2 });
    const saved = doc([entry("a", "2026-05-01", all(2)), latest], {
      // A draft in progress doesn't change what the saved assessment says.
      scores: all(5),
    });
    const [gap, roadmap] = generateMaturityPrompts({ doc: saved });
    // (3·6 + 1 + 2) / 8 = 2.625 → 41%, level 3.
    expect(gap.prompt).toContain("Overall Score: 41% (Level 3 · Defined, assessed on 2026-09-01)");
    expect(gap.prompt).toContain(maturityVerdict(saved));
    expect(gap.prompt).toContain(
      "Scale: 0% = every dimension at level 1, 100% = every dimension at level 5"
    );
    const steps = roadmapFor(latest, 4).slice(0, 3);
    expect(gap.prompt).toContain(
      `Biggest gaps: ${steps.map((s) => `${s.name} (gap: ${4 - s.current})`).join(", ")}`
    );
    expect(steps.slice(0, 2).map((s) => s.name)).toEqual([second.name, third.name]);
    expect(roadmap.prompt).toContain("Target Level: 4");
  });

  it("says so when every dimension is at the target", () => {
    const [gap] = generateMaturityPrompts({ doc: doc([entry("a", "2026-05-01", all(4))]) });
    expect(gap.prompt).toContain("Overall Score: 75%");
    expect(gap.prompt).toContain("Every scored dimension is at or above the target level.");
  });
});
