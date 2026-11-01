/**
 * Riskiest assumptions: which one to test first, and which are settled.
 *
 * An assumption is ranked by risk × (6 − evidence), the score the page,
 * the guide and the AI prompt have always shown (high risk with little
 * evidence first). A rating starts unset: an unrated assumption is never
 * ranked or placed in the matrix, so nothing lands in "Test first" by a
 * default. One that is tested leaves the ranking: its own status says
 * validated or invalidated, or the hypothesis it was sent to has that
 * result. An inconclusive test keeps it ranked (test it again), and the
 * status is never written from the hypothesis: the page offers it.
 *
 * Shared by the Riskiest Assumption page, tool.riskiest_assumption, the AI
 * prompt and the next steps, so all of them pick the same assumption.
 * Pure and server-safe (no "use client" module, React or the store).
 */

import type { Assumption, AssumptionLevel, Hypothesis } from "@/lib/stores/workspace-types";
import type { HandoffSource } from "@/lib/handoffs/types";
import { believeLine, linkedTest } from "@/lib/hypotheses/model";

/** The canvas's one document id: the page, tool.riskiest_assumption and the hand-off's back-link use it. */
export const RA_ID = "riskiestAssumption:current";

/** The lifecycle, in the order the page lists it. */
export const ASSUMPTION_STATUSES = ["untested", "testing", "validated", "invalidated"] as const;

/** An assumption's statement, as typed. */
export const ASSUMPTION_STATEMENT_MAX = 1000;
/** A test idea or description. */
export const ASSUMPTION_TEXT_MAX = 2000;

type Rated = Pick<Assumption, "riskLevel" | "evidenceLevel">;
type Hypotheses = readonly Pick<Hypothesis, "id" | "status">[] | undefined;

/**
 * A stored rating on the 1–5 scale, or null when it isn't rated. A value
 * stored off the scale before Phase 8 (an agent's 7, a 2.5) reads as the
 * nearest whole step on it, until a write sets it.
 */
export function ratingOf(value: unknown): AssumptionLevel | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(5, Math.max(1, Math.round(value))) as AssumptionLevel;
}

/** Both ratings set: the assumption can be ranked and placed. */
export function isRated(a: Rated): boolean {
  return ratingOf(a.riskLevel) !== null && ratingOf(a.evidenceLevel) !== null;
}

/** risk × (6 − evidence), 1..25; null while either rating is unset. */
export function assumptionScore(a: Rated): number | null {
  const risk = ratingOf(a.riskLevel);
  const evidence = ratingOf(a.evidenceLevel);
  return risk === null || evidence === null ? null : risk * (6 - evidence);
}

/**
 * The result that settled the assumption: its own status, else its linked
 * hypothesis's validated or invalidated. Null while it is untested,
 * testing, or its test was inconclusive.
 */
export function testResultOf(
  a: Pick<Assumption, "status" | "sentTo">,
  hypotheses?: Hypotheses
): "validated" | "invalidated" | null {
  if (a.status === "validated" || a.status === "invalidated") return a.status;
  const test = linkedTest(a.sentTo, hypotheses);
  return test.state === "tested" && test.result !== "inconclusive" ? test.result : null;
}

/** Tested: it leaves the ranking (see testResultOf). */
export function isTested(
  a: Pick<Assumption, "status" | "sentTo">,
  hypotheses?: Hypotheses
): boolean {
  return testResultOf(a, hypotheses) !== null;
}

export interface RankedAssumption {
  assumption: Assumption;
  /** risk × (6 − evidence). */
  score: number;
  /** 1 = test first; the position after the tie-breaks. */
  rank: number;
}

/**
 * The ranking and the two lists that stay out of it. Ranked by score;
 * ties go to the higher risk, then the lower evidence, then the order the
 * assumptions were added in. A tested assumption is listed as tested
 * whether or not it is rated. Example rows are kept (the page shows its
 * example); an agent's read leaves them out itself.
 */
export function rankAssumptions(
  assumptions: readonly Assumption[],
  hypotheses?: Hypotheses
): { ranked: RankedAssumption[]; unrated: Assumption[]; tested: Assumption[] } {
  const candidates: {
    assumption: Assumption;
    score: number;
    risk: number;
    evidence: number;
    i: number;
  }[] = [];
  const unrated: Assumption[] = [];
  const tested: Assumption[] = [];
  assumptions.forEach((a, i) => {
    if (isTested(a, hypotheses)) {
      tested.push(a);
      return;
    }
    const score = assumptionScore(a);
    if (score === null) {
      unrated.push(a);
      return;
    }
    candidates.push({
      assumption: a,
      score,
      risk: ratingOf(a.riskLevel) as number,
      evidence: ratingOf(a.evidenceLevel) as number,
      i,
    });
  });
  candidates.sort(
    (x, y) => y.score - x.score || y.risk - x.risk || x.evidence - y.evidence || x.i - y.i
  );
  return {
    ranked: candidates.map((c, i) => ({ assumption: c.assumption, score: c.score, rank: i + 1 })),
    unrated,
    tested,
  };
}

export type Quadrant = "test-first" | "monitor" | "defer" | "solid";

/**
 * Where the matrix places it: Test first (risk ≥ 3, evidence ≤ 3),
 * Monitor (risk ≥ 3, evidence > 3), Defer (risk < 3, evidence ≤ 3),
 * else Solid. Null while unrated: it isn't placed.
 */
export function quadrantOf(a: Rated): Quadrant | null {
  const risk = ratingOf(a.riskLevel);
  const evidence = ratingOf(a.evidenceLevel);
  if (risk === null || evidence === null) return null;
  if (risk >= 3) return evidence <= 3 ? "test-first" : "monitor";
  return evidence <= 3 ? "defer" : "solid";
}

/**
 * What "Test" hands to the Hypothesis Tracker: the statement is what we
 * believe (without a leading "We believe", which the tracker's label
 * holds), the description what to learn, the test idea what we'll do.
 */
export function assumptionHypothesisSource(a: Assumption): HandoffSource {
  const description = a.description?.trim();
  const testIdea = a.testIdea?.trim();
  return {
    title: believeLine(a.statement),
    ...(description ? { description } : {}),
    hypothesis: testIdea ? { willDo: testIdea } : {},
    sourceRef: { tool: "riskiest-assumption", id: a.id, doc: RA_ID },
  };
}
