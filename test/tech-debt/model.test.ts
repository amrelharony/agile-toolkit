/**
 * lib/tech-debt/model: age in sprints of the team's cadence, the capped
 * score (an old trivial item never outranks a fresh critical one), the
 * page's order, the summary and verdict without examples, the backlog
 * link, and a stored row read into today's shape.
 */

import { describe, expect, it } from "vitest";
import type { Story, TechDebtItem } from "@/lib/stores/workspace-types";
import {
  INTEREST_CAP,
  UNASSIGNED_AREA,
  backlogLinkOf,
  compareDebt,
  debtAgeDays,
  debtAgeSprints,
  debtComparator,
  debtPayDownObservations,
  debtScale,
  debtScore,
  debtStoryOf,
  debtSummary,
  debtTimeToResolve,
  debtVerdict,
  interestOf,
  isInterestEstimated,
  isOpenDebt,
  normalizeTechDebt,
  rankDebt,
  rankedDebt,
} from "@/lib/tech-debt/model";

const TODAY = "2026-10-27";
const AT = "2026-10-01T00:00:00.000Z";

const item = (over: Partial<TechDebtItem> = {}): TechDebtItem => ({
  id: "d1",
  title: "Flaky deploy script",
  impact: 3,
  effort: 3,
  raisedAt: "2026-10-27",
  ...over,
});

describe("age", () => {
  it("counts calendar days from raised to resolved (today while open), never negative", () => {
    expect(debtAgeDays(item(), TODAY)).toBe(0);
    expect(debtAgeDays(item({ raisedAt: "2026-10-13" }), TODAY)).toBe(14);
    expect(debtAgeDays(item({ raisedAt: "2026-09-01", resolvedAt: "2026-09-15" }), TODAY)).toBe(14);
    // A timestamp an old agent write stored reads as its date.
    expect(debtAgeDays(item({ raisedAt: "2026-10-20T23:59:00.000Z" }), TODAY)).toBe(7);
    expect(debtAgeDays(item({ raisedAt: "2026-11-01" }), TODAY)).toBe(0);
    expect(debtAgeDays(item({ raisedAt: "soon" }), TODAY)).toBeNull();
  });

  it("is ⌊days ÷ sprint length⌋ at 7, 14 and 21-day cadences; 14 when the length isn't usable", () => {
    const old = item({ raisedAt: "2026-09-29" }); // 28 days
    expect(debtAgeSprints(item({ raisedAt: "2026-10-14" }), 14, TODAY)).toBe(0);
    expect(debtAgeSprints(item({ raisedAt: "2026-10-13" }), 14, TODAY)).toBe(1);
    expect(debtAgeSprints(old, 7, TODAY)).toBe(4);
    expect(debtAgeSprints(old, 14, TODAY)).toBe(2);
    expect(debtAgeSprints(old, 21, TODAY)).toBe(1);
    expect(debtAgeSprints(old, 0, TODAY)).toBe(2);
    expect(debtAgeSprints(item({ raisedAt: "" }), 14, TODAY)).toBeNull();
    // Resolved: the age stops at the day it was paid down.
    expect(
      debtAgeSprints(item({ raisedAt: "2026-01-01", resolvedAt: "2026-01-29" }), 14, TODAY)
    ).toBe(2);
  });
});

describe("debtScore", () => {
  it("is impact × 4 − effort plus interest × age in sprints, capped at 10", () => {
    expect(debtScore(item({ impact: 5, effort: 1 }), 0)).toEqual({
      base: 19,
      interest: 0,
      capped: false,
      total: 19,
    });
    expect(debtScore(item({ impact: 2, effort: 3, interestRate: 1.5 }), 4)).toEqual({
      base: 5,
      interest: 6,
      capped: false,
      total: 11,
    });
    expect(debtScore(item({ impact: 1, effort: 5, interestRate: 3 }), 52)).toEqual({
      base: -1,
      interest: INTEREST_CAP,
      capped: true,
      total: 9,
    });
  });

  it("an old trivial item never outranks a fresh critical one", () => {
    const trivial = debtScore(item({ impact: 1, effort: 5, interestRate: 100 }), 1000);
    const critical = debtScore(item({ impact: 5, effort: 1 }), 0);
    expect(trivial.total).toBeLessThan(critical.total);
  });

  it("reads off-scale ratings on the scale, a non-number as 3, and no interest as 0", () => {
    expect(debtScore({ impact: 2.5, effort: 9 }, 2).base).toBe(3 * 4 - 5);
    expect(debtScale(Number.NaN)).toBe(3);
    expect(debtScore(item({ interestRate: -2 }), 5).interest).toBe(0);
    expect(debtScore(item({ interestRate: 2 }), null).interest).toBe(0);
    expect(interestOf(item({ interestRate: Number.NaN }))).toBe(0);
    expect(isInterestEstimated(item({ interestRate: 0 }))).toBe(true);
    expect(isInterestEstimated(item())).toBe(false);
  });
});

describe("the order", () => {
  it("open before resolved, then total, then age, then title", () => {
    const list = [
      item({ id: "resolved", title: "A", impact: 5, effort: 1, resolvedAt: "2026-10-20" }),
      item({ id: "low", title: "B", impact: 1, effort: 5 }),
      item({ id: "top", title: "C", impact: 5, effort: 1 }),
      item({ id: "tie-old", title: "D", impact: 3, effort: 3, raisedAt: "2026-09-01" }),
      item({ id: "tie-b", title: "F", impact: 3, effort: 3 }),
      item({ id: "tie-a", title: "E", impact: 3, effort: 3 }),
    ];
    expect(rankedDebt(list, 14, TODAY).map((r) => r.item.id)).toEqual([
      "top",
      "tie-old",
      "tie-a",
      "tie-b",
      "low",
      "resolved",
    ]);
    expect([...list].sort(debtComparator(14, TODAY)).map((t) => t.id)).toEqual(
      rankedDebt(list, 14, TODAY).map((r) => r.item.id)
    );
    expect(compareDebt(rankDebt(list[2], 14, TODAY), rankDebt(list[1], 14, TODAY))).toBeLessThan(0);
  });
});

describe("the backlog link", () => {
  const stories = [
    { id: "s1", status: "backlog" },
    { id: "s2", status: "done" },
  ] as Pick<Story, "id" | "status">[];

  it("finds the newest backlog-story link and its story while it exists", () => {
    const sent = item({
      sentTo: [
        { route: "backlog-story", targetId: "gone", at: AT },
        { route: "backlog-story", targetId: "s2", at: AT },
      ],
    });
    expect(backlogLinkOf(sent)?.targetId).toBe("s2");
    expect(debtStoryOf(sent, stories)).toEqual({ storyId: "s2", done: true });
    expect(
      debtStoryOf(item({ sentTo: [{ route: "backlog-story", targetId: "gone", at: AT }] }), stories)
    ).toBeNull();
    expect(debtStoryOf(item(), stories)).toBeNull();
  });
});

describe("debtSummary and debtVerdict", () => {
  const list = [
    item({
      id: "a",
      title: "Flaky deploy script",
      area: "ci",
      impact: 4,
      effort: 2,
      interestRate: 2,
      raisedAt: "2026-07-21", // 98 days: 7 sprints
      sentTo: [{ route: "backlog-story", targetId: "s1", at: AT }],
    }),
    item({ id: "b", title: "Old ORM", area: "api", impact: 3, effort: 4, interestRate: 0.5 }),
    item({ id: "c", title: "No area", impact: 5, effort: 5 }),
    item({ id: "d", title: "Paid", area: "ci", impact: 5, resolvedAt: "2026-10-01" }),
    item({ id: "example-debt-1", title: "Example", area: "ci", impact: 5, interestRate: 9 }),
  ];

  it("counts real items only: open ones' interest, age, areas and backlog", () => {
    expect(debtSummary(list, 14, TODAY)).toEqual({
      open: 3,
      resolved: 1,
      interestPerSprint: 2.5,
      unestimated: 1,
      oldestSprints: 7,
      openByArea: { ci: 1, api: 1, [UNASSIGNED_AREA]: 1 },
      hotspot: { area: "ci", impact: 4 },
      inBacklog: 1,
    });
    // With the stories, only a link whose story still exists counts.
    expect(debtSummary(list, 14, TODAY, []).inBacklog).toBe(0);
  });

  it("says what the open debt costs a sprint and how old the top item is", () => {
    expect(debtVerdict(list, 14, TODAY)).toBe(
      "3 open items cost about 2.5 points a sprint (1 not estimated); the top one, “Flaky deploy script”, is 7 sprints old and scores 24 (interest capped)."
    );
    expect(debtVerdict([list[2]], 14, TODAY)).toBe(
      "1 open item, none with an interest estimate; the top one, “No area”, was raised this sprint and scores 15."
    );
  });

  it("says so when everything is paid down, or nothing is logged (examples aside)", () => {
    expect(debtVerdict([list[3]], 14, TODAY)).toBe("The one debt item logged is paid down.");
    expect(debtVerdict([list[3], { ...list[3], id: "e" }], 14, TODAY)).toBe(
      "All 2 debt items are paid down."
    );
    expect(debtVerdict([list[4]], 14, TODAY)).toBe("No tech debt logged yet.");
  });

  it("counts example rows when asked, for a page holding only its example", () => {
    const opts = { includeExamples: true };
    expect(debtSummary([list[4]], 14, TODAY, undefined, opts)).toMatchObject({
      open: 1,
      interestPerSprint: 9,
      hotspot: { area: "ci", impact: 5 },
    });
    expect(debtSummary(list, 14, TODAY, undefined, opts)).toMatchObject({
      open: 4,
      interestPerSprint: 11.5,
      hotspot: { area: "ci", impact: 9 },
    });
    expect(debtVerdict([list[4]], 14, TODAY, opts)).toBe(
      "1 open item costs about 9 points a sprint; the top one, “Example”, was raised this sprint and scores 17."
    );
  });
});

describe("debtTimeToResolve", () => {
  const paid = (id: string, resolvedAt: string) => item({ id, raisedAt: "2026-10-01", resolvedAt });

  it("reads days raised → resolved, open items waiting at today, the median from 5 paid down", () => {
    const four = [
      paid("a", "2026-10-03"),
      paid("b", "2026-10-05"),
      paid("c", "2026-10-07"),
      paid("d", "2026-10-09"),
      item({ id: "open", raisedAt: "2026-10-01" }),
      // No raised day: its duration isn't known.
      item({ id: "undated", raisedAt: "" }),
    ];
    expect(debtPayDownObservations(four, TODAY)).toEqual([
      { duration: 2, event: true },
      { duration: 4, event: true },
      { duration: 6, event: true },
      { duration: 8, event: true },
      { duration: 26, event: false },
    ]);
    expect(debtTimeToResolve(four, TODAY)).toEqual({ resolved: 4, medianDays: null });
    expect(debtTimeToResolve([...four, paid("e", "2026-10-11")], TODAY)).toEqual({
      resolved: 5,
      medianDays: 6,
    });
  });
});

describe("normalizeTechDebt", () => {
  it("reads an old blob row into today's shape", () => {
    expect(
      normalizeTechDebt({
        id: "b1",
        title: " Old page debt ",
        description: "  ",
        area: " auth ",
        impact: 2.5,
        effort: "x",
        interestRate: -1,
        raisedAt: "2026-09-01T08:00:00Z",
        resolvedAt: "never",
        tags: ["perf", " ", "perf", 3],
      })
    ).toEqual({
      id: "b1",
      title: "Old page debt",
      area: "auth",
      impact: 3,
      effort: 3,
      interestRate: 0,
      raisedAt: "2026-09-01",
      tags: ["perf"],
    });
  });

  it("keeps a cleared interest of 0, a resolution, links and the save stamp", () => {
    expect(
      normalizeTechDebt({
        id: "b2",
        title: "Full",
        impact: 4,
        effort: 2,
        interestRate: 0,
        raisedAt: "2026-09-01",
        resolvedAt: "2026-10-01",
        sentTo: [{ route: "backlog-story", targetId: "s1", at: AT }],
        updatedAt: "2026-10-26T10:00:00.000Z",
      })
    ).toEqual({
      id: "b2",
      title: "Full",
      impact: 4,
      effort: 2,
      interestRate: 0,
      raisedAt: "2026-09-01",
      resolvedAt: "2026-10-01",
      sentTo: [{ route: "backlog-story", targetId: "s1", at: AT }],
      updatedAt: "2026-10-26T10:00:00.000Z",
    });
    expect(isOpenDebt({ resolvedAt: "2026-10-01" })).toBe(false);
  });

  it("drops what can't be an item", () => {
    expect(normalizeTechDebt(null)).toBeNull();
    expect(normalizeTechDebt({ title: "no id" })).toBeNull();
  });
});
