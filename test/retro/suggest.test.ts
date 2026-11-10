import { describe, expect, it } from "vitest";
import { retroFormats } from "@/lib/constants/retro-formats";
import { sayDoRatio } from "@/lib/sprints/metrics";
import { suggestFormat } from "@/lib/retro/suggest";
import type { RetroFacts } from "@/lib/retro/facts";

/** One format suggested from the sprint's facts: a hint, with its reason. */

type Facts = Parameters<typeof suggestFormat>[0] & object;

function facts(over: Partial<RetroFacts> = {}): Facts {
  return {
    sprintName: "Sprint 12",
    goalOutcome: { met: "met", decidedAt: "2026-10-24" },
    committed: 20,
    completed: 20,
    sayDo: sayDoRatio(20, 20),
    mood: { average: 3.8, checkIns: 6, people: 3 },
    ...over,
  };
}

describe("suggestFormat", () => {
  it("suggests nothing for a sprint that went fine, or with no facts", () => {
    expect(suggestFormat(facts())).toBeNull();
    expect(suggestFormat(null)).toBeNull();
    expect(suggestFormat(undefined)).toBeNull();
  });

  it("suggests Mad / Sad / Glad when mood averaged 2.5 or lower", () => {
    expect(suggestFormat(facts({ mood: { average: 2.5, checkIns: 5, people: 3 } }))).toEqual({
      formatId: "mad-sad-glad",
      reason: "Mood in Sprint 12 averaged 2.5 out of 5: start with how people felt.",
    });
    expect(suggestFormat(facts({ mood: { average: 2.6, checkIns: 5, people: 3 } }))).toBeNull();
    // Too few check-ins for an average says nothing about mood.
    expect(suggestFormat(facts({ mood: { average: null, checkIns: 2, people: 2 } }))).toBeNull();
  });

  it("suggests Sailboat when the goal wasn't met, or only partly", () => {
    expect(
      suggestFormat(facts({ goalOutcome: { met: "not-met", decidedAt: "2026-10-24" } }))
    ).toEqual({
      formatId: "sailboat",
      reason: "Sprint 12 didn't meet its goal: look at what held it back and what lies ahead.",
    });
    expect(
      suggestFormat(facts({ goalOutcome: { met: "partly", decidedAt: "2026-10-24" } }))?.reason
    ).toBe("Sprint 12 partly met its goal: look at what held it back and what lies ahead.");
    // Unanswered is not missed.
    expect(suggestFormat(facts({ goalOutcome: null }))).toBeNull();
  });

  it("suggests DAKI when under 90% of the commitment was done", () => {
    expect(suggestFormat(facts({ completed: 13, sayDo: sayDoRatio(20, 13) }))).toEqual({
      formatId: "daki",
      reason:
        "Sprint 12 left 7 of 20 committed points unfinished: agree what to drop, add, keep and improve.",
    });
    // 90% is meeting the commitment; a point or two short isn't worth a format.
    expect(suggestFormat(facts({ completed: 18, sayDo: sayDoRatio(20, 18) }))).toBeNull();
    // Points done not recorded yet: nothing to read.
    expect(suggestFormat(facts({ completed: 0, sayDo: null }))).toBeNull();
  });

  it("puts how people felt first, then the goal, then the unfinished work", () => {
    const all = facts({
      mood: { average: 2, checkIns: 5, people: 3 },
      goalOutcome: { met: "not-met", decidedAt: "2026-10-24" },
      completed: 5,
      sayDo: sayDoRatio(20, 5),
    });
    expect(suggestFormat(all)?.formatId).toBe("mad-sad-glad");
    expect(suggestFormat({ ...all, mood: { average: 4, checkIns: 5, people: 3 } })?.formatId).toBe(
      "sailboat"
    );
  });

  it("only ever suggests a built-in format", () => {
    const ids = new Set(retroFormats.map((f) => f.id));
    for (const id of ["mad-sad-glad", "sailboat", "daki"]) expect(ids.has(id)).toBe(true);
  });
});
