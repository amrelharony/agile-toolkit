/**
 * The DEEP scan (lib/backlog/health.ts): the backlog in the shared order,
 * each of the four checks with its reasons, the per-story flags, the score
 * and verdict, and the no-AI splits and scenarios.
 */

import { describe, expect, it } from "vitest";
import type { Story } from "@/lib/stores/workspace-types";
import {
  DEEP_TOP_N,
  backlogForHealth,
  backlogHealth,
  draftScenarios,
  isVagueTitle,
  lastTouched,
  splitPatternsFor,
  splitTitles,
  storyFlags,
} from "@/lib/backlog/health";

const TODAY = "2026-11-12";

const story = (over: Partial<Story> = {}): Story => ({
  id: "st",
  title: "Pay with a saved card",
  status: "backlog",
  points: 3,
  acceptanceCriteria: "Charged once.",
  createdAt: "2026-11-01T09:00:00.000Z",
  ...over,
});

const ids = (list: { id: string }[]) => list.map((s) => s.id);

describe("the backlog it reads", () => {
  it("takes backlog stories in no sprint, in the decided order, without examples", () => {
    const list = backlogForHealth([
      story({ id: "b", priorityScore: 2 }),
      story({ id: "a", backlogRank: 1 }),
      story({ id: "c", priorityScore: 9 }),
      story({ id: "in-sprint", sprintId: "s1", status: "todo" }),
      story({ id: "done", status: "done" }),
      story({ id: "example-x" }),
    ]);
    expect(ids(list)).toEqual(["a", "c", "b"]);
  });

  it("reads the live rank of an item the story was pulled from", () => {
    const list = backlogForHealth(
      [
        story({ id: "x", backlogRank: 1, sourceRef: { tool: "prioritizer", id: "item-x" } }),
        story({ id: "y", backlogRank: 2, sourceRef: { tool: "prioritizer", id: "item-y" } }),
      ],
      [
        { id: "item-x", rank: 2 },
        { id: "item-y", rank: 1 },
      ]
    );
    expect(ids(list)).toEqual(["y", "x"]);
  });
});

describe("per-story flags", () => {
  it("names a vague title", () => {
    expect(isVagueTitle("Login")).toBe(true);
    expect(isVagueTitle("Fix bugs")).toBe(true);
    expect(isVagueTitle("Update the UI")).toBe(true);
    expect(isVagueTitle("Pay with a saved card")).toBe(false);
    expect(isVagueTitle("Fix the refund rounding on partial refunds")).toBe(false);
  });

  it("asks the top stories for criteria and points, and every story to fit and stay fresh", () => {
    const flags = (s: Story, top = true) => storyFlags(s, { top, today: TODAY }).map((f) => f.id);
    expect(flags(story())).toEqual([]);
    expect(flags(story({ acceptanceCriteria: undefined, points: undefined }))).toEqual([
      "no-criteria",
      "no-points",
    ]);
    // Further down, a rough story is fine.
    expect(flags(story({ acceptanceCriteria: undefined, points: undefined }), false)).toEqual([]);
    // Given/When/Then counts as criteria.
    expect(
      flags(
        story({
          acceptanceCriteria: undefined,
          gwt: [{ id: "g", given: "a", when: "b", then: "c" }],
        })
      )
    ).toEqual([]);
    expect(flags(story({ points: 21 }), false)).toEqual(["too-big"]);
    expect(flags(story({ createdAt: "2026-08-01T00:00:00.000Z" }), false)).toEqual(["stale"]);
    const reason = storyFlags(story({ points: 21 }), { top: false, today: TODAY })[0].reason;
    expect(reason).toBe("21 points, above 13: split it before a sprint takes it.");
  });

  it("reads the last day a story was touched from any of its stamps", () => {
    expect(
      lastTouched(
        story({
          createdAt: "2026-06-01T00:00:00Z",
          statusHistory: [{ status: "backlog", at: "2026-09-10T00:00:00Z" }],
          readiness: { checked: [], ready: false, updatedAt: "2026-10-02T00:00:00Z" },
        })
      )
    ).toBe("2026-10-02");
    expect(lastTouched(story({ createdAt: undefined }))).toBeNull();
  });

  it("counts a recent refinement, so a story created long ago is not stale", () => {
    const flags = (s: Story, top = true) => storyFlags(s, { top, today: TODAY }).map((f) => f.id);
    const old = story({ createdAt: "2026-06-01T00:00:00.000Z" });
    expect(flags(old, false)).toEqual(["stale"]);
    const refined = { ...old, refinedAt: "2026-10-20T00:00:00.000Z" };
    expect(lastTouched(refined)).toBe("2026-10-20");
    expect(flags(refined, false)).toEqual([]);
    expect(storyFlags(old, { top: false, today: TODAY })[0].reason).toMatch(
      /^Not changed for \d+ weeks\. Refine it or drop it\.$/
    );
  });
});

describe("the DEEP scan", () => {
  it("scores a healthy backlog high", () => {
    const backlog = Array.from({ length: 5 }, (_, i) =>
      story({ id: `s${i}`, title: `Story number ${i} for shoppers`, backlogRank: i + 1 })
    );
    const h = backlogHealth(backlog, { today: TODAY });
    expect(h.checks.map((c) => [c.id, c.score])).toEqual([
      ["detailed", 1],
      ["estimated", 1],
      ["emergent", 1],
      ["prioritized", 1],
    ]);
    expect(h).toMatchObject({ score: 100, verdict: "healthy", flagged: 0 });
    expect(h.summary).toBe("100% DEEP: the backlog is in good shape. No story is flagged.");
  });

  it("finds what is missing, with reasons, and points at the weakest check", () => {
    const backlog = [
      story({
        id: "a",
        title: "Login",
        acceptanceCriteria: undefined,
        points: undefined,
        backlogRank: 1,
      }),
      story({ id: "b", points: 21, backlogRank: 1 }),
      story({ id: "c", createdAt: "2026-07-01T00:00:00.000Z" }),
      story({ id: "d" }),
    ];
    const h = backlogHealth(backlog, { today: TODAY });
    const byId = Object.fromEntries(h.checks.map((c) => [c.id, c]));
    expect(byId.detailed.score).toBe(0.75);
    expect(byId.detailed.reasons).toEqual([
      "3 of the top 4 stories have acceptance criteria and a clear title.",
      "1 has no acceptance criteria.",
      "1 title is too vague to build from.",
    ]);
    expect(byId.estimated.score).toBe(0.5);
    expect(byId.estimated.reasons).toEqual([
      "2 of the top 4 stories have points that fit a sprint.",
      "1 has no points yet.",
      "1 is above 13 points: split it.",
    ]);
    expect(byId.emergent.score).toBe(0.75);
    expect(byId.emergent.reasons[2]).toBe("1 story is stale: refine or drop it in Refinement.");
    // Two ranked 1: a tie; two with no place at all.
    expect(byId.prioritized.score).toBe(0);
    expect(byId.prioritized.reasons).toEqual([
      "2 of 4 stories have a rank or a priority score; the rest have no place yet.",
      "2 stories share a place with another: decide which comes first.",
    ]);
    expect(h.score).toBe(50);
    expect(h.verdict).toBe("needs-work");
    expect(h.summary).toBe(
      "50% DEEP. Start with “Prioritized”: 2 of 4 stories have a rank or a priority score; the rest have no place yet."
    );
    expect(h.flagged).toBe(3);
  });

  it("can't tell emergence with no dates, and leaves it out of the score", () => {
    const h = backlogHealth([story({ createdAt: undefined, backlogRank: 1 })], { today: TODAY });
    const emergent = h.checks.find((c) => c.id === "emergent");
    expect(emergent?.score).toBeNull();
    expect(h.score).toBe(100);
  });

  it("only the top stories need detail", () => {
    const backlog = Array.from({ length: DEEP_TOP_N + 5 }, (_, i) =>
      story({
        id: `s${i}`,
        title: `Story number ${i} for shoppers`,
        backlogRank: i + 1,
        ...(i >= DEEP_TOP_N ? { acceptanceCriteria: undefined, points: undefined } : {}),
      })
    );
    const h = backlogHealth(backlog, { today: TODAY });
    expect(h.score).toBe(100);
    expect(h.stories.filter((s) => s.top)).toHaveLength(DEEP_TOP_N);
  });

  it("says so when the backlog is empty", () => {
    expect(backlogHealth([], { today: TODAY })).toMatchObject({
      verdict: "empty",
      score: null,
      summary: "The backlog is empty: there is nothing to check yet.",
    });
  });
});

describe("splits and scenarios without AI", () => {
  it("picks patterns by the title's words", () => {
    expect(splitPatternsFor("Import orders from CSV and Excel").map((p) => p.id)).toEqual([
      "path",
      "data",
    ]);
    expect(splitPatternsFor("Discount rules for members").map((p) => p.id)).toEqual([
      "rules",
      "path",
    ]);
    expect(splitPatternsFor("Reporting").map((p) => p.id)).toEqual(["path", "spike"]);
  });

  it("writes smaller titles from a pattern", () => {
    expect(splitTitles("Checkout", "path")).toEqual([
      "Checkout: the main path only",
      "Checkout: errors and rare cases",
    ]);
    expect(splitTitles("Bank sync", "spike")).toEqual([
      "Spike: find out what it needs: Bank sync",
      "Bank sync: the rest, once the spike is done",
    ]);
  });

  it("drafts scenarios from a user story, or from the title", () => {
    expect(draftScenarios("As a shopper, I want to save my card so that I pay faster")).toEqual([
      { given: "I am a shopper", when: "I save my card", then: "I pay faster" },
    ]);
    const plain = draftScenarios("Refund a payment");
    expect(plain).toHaveLength(2);
    expect(plain[0].when).toBe("someone uses “Refund a payment”");
  });
});
