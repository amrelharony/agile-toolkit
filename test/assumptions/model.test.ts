/**
 * lib/assumptions/model: unset ratings are never ranked or placed, the
 * page's score orders the ranking, tested assumptions leave it (an
 * inconclusive test doesn't), and what "Test" hands the tracker.
 */

import { describe, expect, it } from "vitest";
import type { Assumption, AssumptionLevel, Hypothesis } from "@/lib/stores/workspace-types";
import {
  RA_ID,
  assumptionHypothesisSource,
  assumptionScore,
  isRated,
  isTested,
  quadrantOf,
  rankAssumptions,
  ratingOf,
  testResultOf,
} from "@/lib/assumptions/model";

const a = (
  id: string,
  risk?: number,
  evidence?: number,
  over: Partial<Assumption> = {}
): Assumption => ({
  id,
  statement: `Assumption ${id}`,
  ...(risk !== undefined ? { riskLevel: risk as AssumptionLevel } : {}),
  ...(evidence !== undefined ? { evidenceLevel: evidence as AssumptionLevel } : {}),
  status: "untested",
  ...over,
});

const linked = (targetId: string) => ({
  sentTo: [{ route: "hypothesis" as const, targetId, at: "2026-10-20T09:00:00.000Z" }],
});
const h = (id: string, status: Hypothesis["status"]) => ({ id, status });

describe("ratings", () => {
  it("reads absent as not rated, and an off-scale legacy value as its nearest step", () => {
    expect(ratingOf(undefined)).toBeNull();
    expect(ratingOf(NaN)).toBeNull();
    expect(ratingOf("3")).toBeNull();
    expect(ratingOf(7)).toBe(5);
    expect(ratingOf(0)).toBe(1);
    expect(ratingOf(2.5)).toBe(3);
    expect(ratingOf(4)).toBe(4);
  });

  it("is rated only with both ratings", () => {
    expect(isRated(a("x", 3, 3))).toBe(true);
    expect(isRated(a("x", 3))).toBe(false);
    expect(isRated(a("x", undefined, 2))).toBe(false);
  });

  it("scores risk × (6 − evidence), null while unrated", () => {
    expect(assumptionScore(a("x", 5, 1))).toBe(25);
    expect(assumptionScore(a("x", 1, 5))).toBe(1);
    expect(assumptionScore(a("x", 4, 2))).toBe(16);
    expect(assumptionScore(a("x", 4))).toBeNull();
  });
});

describe("tested", () => {
  it("by its own status", () => {
    expect(testResultOf(a("x", 3, 3, { status: "validated" }))).toBe("validated");
    expect(testResultOf(a("x", 3, 3, { status: "invalidated" }))).toBe("invalidated");
    expect(isTested(a("x", 3, 3, { status: "testing" }))).toBe(false);
  });

  it("by its linked hypothesis's decisive result; inconclusive, testing or gone keeps it open", () => {
    const x = a("x", 3, 3, linked("h1"));
    expect(testResultOf(x, [h("h1", "invalidated")])).toBe("invalidated");
    expect(testResultOf(x, [h("h1", "inconclusive")])).toBeNull();
    expect(testResultOf(x, [h("h1", "running")])).toBeNull();
    expect(testResultOf(x, [])).toBeNull();
    expect(isTested(x, [h("h1", "validated")])).toBe(true);
  });
});

describe("rankAssumptions", () => {
  it("ranks by the page's score, so (4, 2) beats (5, 3)", () => {
    const { ranked } = rankAssumptions([a("A", 5, 3), a("B", 4, 2)]);
    expect(ranked.map((r) => [r.assumption.id, r.score, r.rank])).toEqual([
      ["B", 16, 1],
      ["A", 15, 2],
    ]);
  });

  it("breaks ties by higher risk, then lower evidence, then the order added", () => {
    // 4 × (6 − 3) = 12 and 3 × (6 − 2) = 12: the higher risk goes first.
    const byRisk = rankAssumptions([a("low", 3, 2), a("high", 4, 3)]).ranked;
    expect(byRisk.map((r) => r.assumption.id)).toEqual(["high", "low"]);
    const byOrder = rankAssumptions([a("first", 2, 2), a("second", 2, 2)]).ranked;
    expect(byOrder.map((r) => r.assumption.id)).toEqual(["first", "second"]);
  });

  it("keeps unrated and tested assumptions out of the ranking, each in its list", () => {
    const list = [
      a("rated", 2, 2),
      a("unrated", 5),
      a("done", 5, 1, { status: "validated" }),
      a("via-test", 5, 1, linked("h1")),
      a("unrated-tested", undefined, undefined, { status: "invalidated" }),
      a("again", 3, 3, linked("h2")),
    ];
    const r = rankAssumptions(list, [h("h1", "validated"), h("h2", "inconclusive")]);
    expect(r.ranked.map((x) => x.assumption.id)).toEqual(["again", "rated"]);
    expect(r.unrated.map((x) => x.id)).toEqual(["unrated"]);
    expect(r.tested.map((x) => x.id)).toEqual(["done", "via-test", "unrated-tested"]);
  });

  it("keeps example rows (the page shows its example)", () => {
    expect(rankAssumptions([a("example-1", 3, 3)]).ranked).toHaveLength(1);
  });
});

describe("quadrantOf", () => {
  it("places rated assumptions as the matrix does, and never an unrated one", () => {
    expect(quadrantOf(a("x", 3, 3))).toBe("test-first");
    expect(quadrantOf(a("x", 5, 4))).toBe("monitor");
    expect(quadrantOf(a("x", 2, 1))).toBe("defer");
    expect(quadrantOf(a("x", 2, 4))).toBe("solid");
    expect(quadrantOf(a("x", 5))).toBeNull();
  });
});

describe("assumptionHypothesisSource", () => {
  it("hands over the statement, the description and the test idea, with its source", () => {
    expect(
      assumptionHypothesisSource(
        a("as1", 4, 2, {
          statement: "We believe teams will pay for a weekly report",
          description: " Pricing interviews were split. ",
          testIdea: " Fake-door test ",
        })
      )
    ).toEqual({
      title: "teams will pay for a weekly report",
      description: "Pricing interviews were split.",
      hypothesis: { willDo: "Fake-door test" },
      sourceRef: { tool: "riskiest-assumption", id: "as1", doc: RA_ID },
    });
  });

  it("leaves what the assumption doesn't have for the tracker to ask", () => {
    expect(assumptionHypothesisSource(a("as2"))).toEqual({
      title: "Assumption as2",
      hypothesis: {},
      sourceRef: { tool: "riskiest-assumption", id: "as2", doc: "riskiestAssumption:current" },
    });
  });
});
