/**
 * The goal-at-risk rule (lib/sprints/risk): it reads a running sprint only,
 * each sign gives a reason with its own level and a thing to try, the
 * sprint's level is the highest reason's, and the note without AI is the
 * headline, the main reasons and the first thing to try.
 */

import { describe, expect, it } from "vitest";
import type { Impediment } from "@/lib/stores/workspace-types";
import {
  impedimentCounts,
  riskNote,
  sprintRisk,
  type ImpedimentCounts,
  type SprintRiskFacts,
} from "@/lib/sprints/risk";

const NONE: ImpedimentCounts = { open: 0, severe: 0, critical: 0, escalated: 0, overdue: 0 };

function facts(over: Partial<SprintRiskFacts> = {}): SprintRiskFacts {
  return {
    sprint: { name: "Sprint 7", goal: "Checkout works end to end", status: "active" },
    burn: {
      phase: "running",
      todayDay: 5,
      lengthDays: 10,
      source: "stories",
      done: 12,
      remaining: 18,
      scopeNow: 30,
      initialScope: 30,
      scopeAdded: 0,
      scopeRemoved: 0,
      unpointedOpen: 0,
    },
    status: { gap: 3, projectedFinishDay: 9.5, willFinishOnTime: true, cantTell: false },
    blockedStories: 0,
    impediments: NONE,
    interrupts: null,
    ...over,
  };
}

const burn = (over: Partial<SprintRiskFacts["burn"]>) => ({ ...facts().burn, ...over });
const status = (over: Partial<SprintRiskFacts["status"]>) => ({ ...facts().status, ...over });

describe("sprintRisk", () => {
  it("says a sprint on pace with nothing in its way is on track", () => {
    const risk = sprintRisk(facts());
    expect(risk).toMatchObject({ applies: true, level: "none", reasons: [] });
    expect(risk.headline).toBe("The sprint goal looks on track: nothing puts it at risk today.");
  });

  it("names the sprint when it has no goal", () => {
    const risk = sprintRisk(facts({ sprint: { name: "Sprint 7", status: "active" } }));
    expect(risk.headline).toBe("Sprint 7 looks on track: nothing puts it at risk today.");
    const blocked = sprintRisk(
      facts({ sprint: { name: "Sprint 7", status: "active" }, blockedStories: 1 })
    );
    expect(blocked.headline).toBe("Worth watching: 1 sign could put Sprint 7 at risk.");
  });

  it("is at risk when the projected finish is after the last day", () => {
    const risk = sprintRisk(
      facts({ status: status({ projectedFinishDay: 12.2, willFinishOnTime: false, gap: 2 }) })
    );
    expect(risk.level).toBe("at_risk");
    expect(risk.reasons[0]).toMatchObject({ id: "finish-late", level: "at_risk" });
    expect(risk.reasons[0].text).toBe(
      "At this pace the work left finishes around day 13, after the last day (day 10)."
    );
    expect(risk.headline).toBe("The sprint goal is at risk.");
  });

  it("watches a gap of 15% of the scope and calls 30% a risk", () => {
    expect(sprintRisk(facts({ status: status({ gap: 4 }) })).level).toBe("none");
    const watch = sprintRisk(facts({ status: status({ gap: 5 }) }));
    expect(watch.reasons).toEqual([
      expect.objectContaining({
        id: "behind",
        level: "watch",
        text: "The points left are 5 points above the ideal line on day 5.",
      }),
    ]);
    expect(sprintRisk(facts({ status: status({ gap: 9 }) })).level).toBe("at_risk");
  });

  it("flags nothing done well into the sprint", () => {
    const stalled = (day: number) =>
      sprintRisk(
        facts({
          burn: burn({ todayDay: day, done: 0, remaining: 30 }),
          status: status({ gap: 0, projectedFinishDay: null, willFinishOnTime: null }),
        })
      );
    expect(stalled(2).reasons).toEqual([]);
    expect(stalled(3).reasons[0]).toMatchObject({ id: "no-progress", level: "watch" });
    expect(stalled(5).reasons[0]).toMatchObject({
      id: "no-progress",
      level: "at_risk",
      text: "Nothing is done yet on day 5 of 10.",
    });
  });

  it("can't read the pace without numbers or with unpointed open stories", () => {
    const none = sprintRisk(facts({ burn: burn({ source: "none", done: null, remaining: null }) }));
    expect(none.reasons[0]).toMatchObject({ id: "no-data", level: "watch" });
    const cantTell = sprintRisk(
      facts({
        burn: burn({ remaining: 0, unpointedOpen: 2 }),
        status: status({ cantTell: true, gap: null }),
      })
    );
    expect(cantTell.reasons[0].text).toBe(
      "Every pointed story is done, but 2 open stories have no points, so what is left can't be told."
    );
  });

  it("watches the scope growing by a fifth since day 0", () => {
    expect(sprintRisk(facts({ burn: burn({ scopeAdded: 5 }) })).reasons).toEqual([]);
    const grew = sprintRisk(facts({ burn: burn({ scopeAdded: 8, scopeRemoved: 2 }) }));
    expect(grew.reasons).toEqual([
      expect.objectContaining({
        id: "scope-grew",
        level: "watch",
        text: "The scope grew by 6 points since day 0 (20% more).",
      }),
    ]);
  });

  it("weighs blocked stories: one to watch, three at risk", () => {
    expect(sprintRisk(facts({ blockedStories: 1 })).reasons[0]).toMatchObject({
      id: "blocked",
      level: "watch",
      text: "1 story is blocked on the board.",
    });
    expect(sprintRisk(facts({ blockedStories: 3 })).level).toBe("at_risk");
  });

  it("weighs impediments by severity, escalation and due date", () => {
    expect(sprintRisk(facts({ impediments: { ...NONE, open: 2 } })).reasons).toEqual([]);
    const one = sprintRisk(facts({ impediments: { ...NONE, open: 2, severe: 1, overdue: 1 } }));
    expect(one.reasons[0]).toMatchObject({
      id: "impediments",
      level: "watch",
      text: "2 impediments are open (1 high, 1 overdue).",
    });
    expect(
      sprintRisk(facts({ impediments: { ...NONE, open: 1, severe: 1, critical: 1 } })).level
    ).toBe("at_risk");
    expect(sprintRisk(facts({ impediments: { ...NONE, open: 2, severe: 2 } })).level).toBe(
      "at_risk"
    );
  });

  it("reads the interrupt buffer: nearly spent to watch, over at risk", () => {
    const watch = sprintRisk(
      facts({ interrupts: { state: "watch", summary: "6 of 8 points used, 2 points left." } })
    );
    expect(watch.reasons[0]).toMatchObject({
      id: "interrupts",
      level: "watch",
      text: "Interrupt buffer: 6 of 8 points used, 2 points left.",
    });
    const over = sprintRisk(
      facts({
        interrupts: { state: "over", summary: "11 of 8 points used: 3 points over the buffer." },
      })
    );
    expect(over.level).toBe("at_risk");
    expect(over.reasons[0].tryThis).toMatch(/Emergency Procedure/);
    expect(sprintRisk(facts({ interrupts: { state: "ok", summary: "x" } })).reasons).toEqual([]);
  });

  it("puts the worst reasons first and counts them in the headline", () => {
    const risk = sprintRisk(
      facts({
        blockedStories: 1,
        interrupts: { state: "over", summary: "9 of 8 points used: 1 point over the buffer." },
      })
    );
    expect(risk.reasons.map((r) => r.id)).toEqual(["interrupts", "blocked"]);
    const watch = sprintRisk(facts({ blockedStories: 1, burn: burn({ scopeAdded: 9 }) }));
    expect(watch.headline).toBe("Worth watching: 2 signs could put the sprint goal at risk.");
  });

  it("doesn't judge a sprint that isn't running", () => {
    expect(sprintRisk(facts({ burn: burn({ phase: "before" }) }))).toMatchObject({
      applies: false,
      notApplicable: "before",
      level: "none",
      headline: "Sprint 7 hasn't started yet, so there is no pace to judge.",
    });
    expect(sprintRisk(facts({ burn: burn({ phase: "over" }) })).notApplicable).toBe("over");
    expect(sprintRisk(facts({ burn: burn({ phase: "undated" }) })).notApplicable).toBe("undated");
    expect(
      sprintRisk(facts({ sprint: { name: "Sprint 7", status: "completed" }, blockedStories: 4 }))
    ).toMatchObject({ applies: false, notApplicable: "closed", reasons: [] });
  });
});

describe("impedimentCounts", () => {
  it("counts only the open ones, by what the rule weighs", () => {
    const imp = (over: Partial<Impediment>): Impediment => ({
      id: "i",
      title: "x",
      severity: "medium",
      raisedAt: "2026-11-01",
      ...over,
    });
    expect(
      impedimentCounts(
        [
          imp({ severity: "critical" }),
          imp({ severity: "high", escalatedAt: "2026-11-03" }),
          imp({ dueDate: "2026-11-04" }),
          imp({ severity: "critical", resolvedAt: "2026-11-02" }),
        ],
        "2026-11-06"
      )
    ).toEqual({ open: 3, severe: 2, critical: 1, escalated: 1, overdue: 1 });
  });
});

describe("riskNote", () => {
  it("is the headline, the two main reasons and the first thing to try", () => {
    const risk = sprintRisk(
      facts({
        status: status({ projectedFinishDay: 12, willFinishOnTime: false }),
        blockedStories: 2,
      })
    );
    expect(riskNote(risk)).toBe(
      "The sprint goal is at risk. At this pace the work left finishes around day 12, after the last day (day 10). 2 stories are blocked on the board. Try this: agree with the Product Owner what to drop or split, so the part that meets the goal lands."
    );
  });

  it("is the headline alone when nothing is at risk", () => {
    const risk = sprintRisk(facts());
    expect(riskNote(risk)).toBe(risk.headline);
  });
});
