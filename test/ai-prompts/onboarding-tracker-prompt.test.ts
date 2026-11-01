// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generateOnboardingTrackerPrompts } from "@/lib/ai-prompts/onboarding-tracker";
import {
  BUILT_IN_TEMPLATES,
  milestonesFrom,
  onboardingStats,
  onboardingVerdict,
  type Milestone,
  type Onboardee,
} from "@/app/(tools)/onboarding-tracker/model";
import { markStatText } from "@/app/(tools)/onboarding-tracker/markdown";

/**
 * The onboarding prompt counts with the tracker's own definitions: overdue
 * (past the target day) and at risk (more than half of it used) apart, as
 * the page's card shows them, and no average below MIN_SAMPLE.average
 * people. It used to keep its own copy of the status rule, on the clock.
 */

const TODAY = "2026-10-26";

/** A joiner from the built-in template, with the milestones reached on those days. */
function joiner(name: string, startDate: string, reached: Record<string, string> = {}): Onboardee {
  let n = 0;
  const milestones: Milestone[] = milestonesFrom(BUILT_IN_TEMPLATES, () => `${name}-${n++}`).map(
    (m) => (reached[m.templateId ?? ""] ? { ...m, completedAt: reached[m.templateId ?? ""] } : m)
  );
  return { id: name, name, startDate, milestones };
}

// Day 10: First PR (7) overdue, First merge (14) at risk.
const ANA = joiner("Ana", "2026-10-16", { "first-commit": "2026-10-17" });
// Day 30: first PR on day 5; First production deploy (30) at risk.
const BEN = joiner("Ben", "2026-09-26", {
  "first-commit": "2026-09-27",
  "first-pr": "2026-10-01",
  "first-merge": "2026-10-05",
});
// Day 60: first PR on day 3.
const CLEO = joiner("Cleo", "2026-08-27", {
  "first-commit": "2026-08-28",
  "first-pr": "2026-08-30",
  "first-merge": "2026-09-05",
  "first-deploy": "2026-09-20",
});

describe("generateOnboardingTrackerPrompts", () => {
  it("states the page's overdue and at-risk counts apart", () => {
    const people = [ANA, BEN, CLEO];
    const stats = onboardingStats(people, TODAY);
    const [bottleneck] = generateOnboardingTrackerPrompts({ onboardees: people, today: TODAY });
    expect(bottleneck.prompt).toContain(
      `Overdue / at-risk milestones: ${stats.overdue} / ${stats.atRisk}.`
    );
    expect(bottleneck.prompt).toContain(onboardingVerdict(people, TODAY));
    // One table row per late milestone, the overdue ones first.
    const overdue = bottleneck.prompt.match(/\| Overdue \|/g) ?? [];
    const atRisk = bottleneck.prompt.match(/\| At risk \|/g) ?? [];
    expect([overdue.length, atRisk.length]).toEqual([stats.overdue, stats.atRisk]);
    expect(bottleneck.prompt).toContain("| Ana | First PR | 7 | Day 10 | Overdue |");
    expect(bottleneck.prompt).toContain("| Ana | First merge | 14 | Day 10 | At risk |");
    expect(bottleneck.prompt.indexOf("| Overdue |")).toBeLessThan(
      bottleneck.prompt.indexOf("| At risk |")
    );
  });

  it("quotes no average below three people, and the page's once three reached it", () => {
    const two = [BEN, CLEO];
    const [few] = generateOnboardingTrackerPrompts({ onboardees: two, today: TODAY });
    expect(few.prompt).toContain("Time to first PR: not enough data (2 of 3 people).");
    expect(few.prompt).toContain("Time to productivity: no one yet.");

    const dan = joiner("Dan", "2026-09-06", {
      "first-commit": "2026-09-07",
      "first-pr": "2026-09-13",
    });
    const three = [BEN, CLEO, dan];
    const stats = onboardingStats(three, TODAY);
    const [enough] = generateOnboardingTrackerPrompts({ onboardees: three, today: TODAY });
    expect(markStatText(stats.firstPr)).toBe("5.0 days (3 people)");
    expect(enough.prompt).toContain("Time to first PR: 5.0 days (3 people).");
  });

  it("says when someone has no start date or starts later", () => {
    const later = joiner("Eve", "2026-10-29");
    const undated = { ...joiner("Fay", ""), startDate: "" };
    const [bottleneck] = generateOnboardingTrackerPrompts({
      onboardees: [later, undated],
      today: TODAY,
    });
    expect(bottleneck.prompt).toContain("| Eve | — | — | 2026-10-29 | Starts in 3 days |");
    expect(bottleneck.prompt).toContain("| Fay | — | — | — | No start date |");
  });

  it("has no prompts without a joiner", () => {
    expect(generateOnboardingTrackerPrompts({ onboardees: [], today: TODAY })).toEqual([]);
  });
});
