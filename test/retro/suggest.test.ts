import { describe, expect, it } from "vitest";
import { retroFormats } from "@/lib/constants/retro-formats";
import { sayDoRatio } from "@/lib/sprints/metrics";
import { sprintOver, suggestFormat } from "@/lib/retro/suggest";
import type { RetroFacts } from "@/lib/retro/facts";

/** One format suggested from the sprint's facts: a hint, with its reason. */

type Facts = Parameters<typeof suggestFormat>[0] & object;

/** The sprint is over: its open work is unfinished. */
const OVER = { ended: true };
/** The sprint is still running. */
const RUNNING = { ended: false };

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
    expect(suggestFormat(facts(), OVER)).toBeNull();
    expect(suggestFormat(null, OVER)).toBeNull();
    expect(suggestFormat(undefined, OVER)).toBeNull();
  });

  it("suggests Mad / Sad / Glad when mood averaged 2.5 or lower", () => {
    expect(suggestFormat(facts({ mood: { average: 2.5, checkIns: 5, people: 3 } }), OVER)).toEqual({
      formatId: "mad-sad-glad",
      reason: "Mood in Sprint 12 averaged 2.5 out of 5: start with how people felt.",
    });
    expect(
      suggestFormat(facts({ mood: { average: 2.6, checkIns: 5, people: 3 } }), OVER)
    ).toBeNull();
    // Too few check-ins for an average says nothing about mood.
    expect(
      suggestFormat(facts({ mood: { average: null, checkIns: 2, people: 2 } }), OVER)
    ).toBeNull();
  });

  it("suggests Sailboat when the goal wasn't met, or only partly", () => {
    expect(
      suggestFormat(facts({ goalOutcome: { met: "not-met", decidedAt: "2026-10-24" } }), OVER)
    ).toEqual({
      formatId: "sailboat",
      reason: "Sprint 12 didn't meet its goal: look at what held it back and what lies ahead.",
    });
    expect(
      suggestFormat(facts({ goalOutcome: { met: "partly", decidedAt: "2026-10-24" } }), OVER)
        ?.reason
    ).toBe("Sprint 12 partly met its goal: look at what held it back and what lies ahead.");
    // Unanswered is not missed.
    expect(suggestFormat(facts({ goalOutcome: null }), OVER)).toBeNull();
  });

  it("suggests DAKI when under 90% of the commitment was done", () => {
    expect(suggestFormat(facts({ completed: 13, sayDo: sayDoRatio(20, 13) }), OVER)).toEqual({
      formatId: "daki",
      reason:
        "Sprint 12 left 7 of 20 committed points unfinished: agree what to drop, add, keep and improve.",
    });
    // 90% is meeting the commitment; a point or two short isn't worth a format.
    expect(suggestFormat(facts({ completed: 18, sayDo: sayDoRatio(20, 18) }), OVER)).toBeNull();
    // Points done not recorded yet: nothing to read.
    expect(suggestFormat(facts({ completed: 0, sayDo: null }), OVER)).toBeNull();
  });

  it("never calls a running sprint's open work unfinished", () => {
    // Two days into a sprint: nothing done yet, as it should be.
    const early = facts({ goalOutcome: null, completed: 0, sayDo: sayDoRatio(20, 0) });
    expect(sayDoRatio(20, 0)?.grade).toBe("missed");
    expect(suggestFormat(early, RUNNING)).toBeNull();
    expect(suggestFormat(early, OVER)?.formatId).toBe("daki");
    // How people feel, and a goal already answered, still count while it runs.
    expect(
      suggestFormat({ ...early, mood: { average: 2, checkIns: 4, people: 2 } }, RUNNING)?.formatId
    ).toBe("mad-sad-glad");
    expect(
      suggestFormat({ ...early, goalOutcome: { met: "not-met", decidedAt: "2026-10-24" } }, RUNNING)
        ?.formatId
    ).toBe("sailboat");
  });

  it("puts how people felt first, then the goal, then the unfinished work", () => {
    const all = facts({
      mood: { average: 2, checkIns: 5, people: 3 },
      goalOutcome: { met: "not-met", decidedAt: "2026-10-24" },
      completed: 5,
      sayDo: sayDoRatio(20, 5),
    });
    expect(suggestFormat(all, OVER)?.formatId).toBe("mad-sad-glad");
    expect(
      suggestFormat({ ...all, mood: { average: 4, checkIns: 5, people: 3 } }, OVER)?.formatId
    ).toBe("sailboat");
  });

  it("counts a sprint as over once it's closed or on its last day", () => {
    const sprint = { status: "active" as const, endDate: "2026-11-10" };
    expect(sprintOver(sprint, "2026-11-09")).toBe(false);
    expect(sprintOver(sprint, "2026-11-10")).toBe(true);
    expect(sprintOver(sprint, "2026-11-12")).toBe(true);
    expect(sprintOver({ ...sprint, status: "completed" }, "2026-11-01")).toBe(true);
    expect(sprintOver({ ...sprint, endDate: "" }, "2026-11-12")).toBe(false);
  });

  it("only ever suggests a built-in format", () => {
    const ids = new Set(retroFormats.map((f) => f.id));
    for (const id of ["mad-sad-glad", "sailboat", "daki"]) expect(ids.has(id)).toBe(true);
  });
});
