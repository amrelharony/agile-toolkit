/**
 * The Riskiest Assumption page's reading of the canvas: the ranking, the
 * not-rated and tested lists, the matrix, the counts and the verdict, all
 * from lib/assumptions (rankAssumptions, quadrantOf, testResultOf), the
 * functions tool.riskiest_assumption calls, so the page and an agent pick
 * the same assumption to test first.
 */

import type { Assumption, AssumptionStatus, Hypothesis } from "@/lib/stores/workspace-types";
import {
  quadrantOf,
  rankAssumptions,
  ratingOf,
  testResultOf,
  type Quadrant,
  type RankedAssumption,
} from "@/lib/assumptions/model";
import { linkedTest } from "@/lib/hypotheses/model";

type Hypotheses = readonly Pick<Hypothesis, "id" | "status">[];

export const STATUS_LABEL: Record<AssumptionStatus, string> = {
  untested: "Untested",
  testing: "Testing",
  validated: "Validated",
  invalidated: "Invalidated",
};

export const statusLabel = (s: string) => STATUS_LABEL[s as AssumptionStatus] ?? s;

export const QUADRANTS: readonly {
  id: Quadrant;
  label: string;
  hint: string;
  tone: string;
}[] = [
  {
    id: "test-first",
    label: "Test first",
    hint: "high risk · low evidence",
    tone: "border-danger/40 bg-danger/5 text-danger",
  },
  {
    id: "monitor",
    label: "Monitor",
    hint: "high risk · high evidence",
    tone: "border-warning/40 bg-warning/5 text-warning",
  },
  {
    id: "defer",
    label: "Defer",
    hint: "low risk · low evidence",
    tone: "border-border bg-surface text-sub",
  },
  {
    id: "solid",
    label: "Solid",
    hint: "low risk · high evidence",
    tone: "border-success/40 bg-success/5 text-success",
  },
];

export interface CanvasView {
  ranked: RankedAssumption[];
  unrated: Assumption[];
  tested: Assumption[];
  /** Ranked only: an unrated or tested assumption isn't placed. */
  quadrants: Record<Quadrant, Assumption[]>;
  /** Untested, rated risk 4 or 5, and not tested yet. */
  untestedRisky: number;
}

export function canvasView(assumptions: readonly Assumption[], hypotheses: Hypotheses): CanvasView {
  const { ranked, unrated, tested } = rankAssumptions(assumptions, hypotheses);
  const quadrants: Record<Quadrant, Assumption[]> = {
    "test-first": [],
    monitor: [],
    defer: [],
    solid: [],
  };
  for (const r of ranked) {
    const q = quadrantOf(r.assumption);
    if (q) quadrants[q].push(r.assumption);
  }
  const untestedRisky = ranked.filter(
    (r) => r.assumption.status === "untested" && (ratingOf(r.assumption.riskLevel) ?? 0) >= 4
  ).length;
  return { ranked, unrated, tested, quadrants, untestedRisky };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The one-sentence verdict: what to test first and why, or what to do
 * before anything can be ranked.
 */
export function assumptionsVerdict(v: CanvasView): string {
  const top = v.ranked[0];
  if (!top) {
    if (v.unrated.length > 0) {
      return `Rate ${plural(v.unrated.length, "assumption")} on risk and evidence to see which to test first.`;
    }
    if (v.tested.length > 0) return `Every assumption is tested (${v.tested.length}).`;
    return "No assumptions yet.";
  }
  const a = top.assumption;
  const head = `Test “${a.statement.trim()}” first: risk ${ratingOf(a.riskLevel)}, evidence ${ratingOf(a.evidenceLevel)}, score ${top.score}.`;
  return v.unrated.length > 0
    ? `${head} ${plural(v.unrated.length, "assumption")} ${v.unrated.length === 1 ? "isn't" : "aren't"} rated yet.`
    : head;
}

/** What settled a tested assumption, in words. */
export function resultText(a: Assumption, hypotheses: Hypotheses): string {
  const result = testResultOf(a, hypotheses);
  if (!result) return "";
  const own = a.status === "validated" || a.status === "invalidated";
  return own ? statusLabel(result) : `${statusLabel(result)} by its hypothesis`;
}

/**
 * The status its linked hypothesis's result points to, when the
 * assumption's own status doesn't say it yet: the page offers it as one
 * click ("Mark validated"), never writes it on its own.
 */
export function offeredStatus(
  a: Assumption,
  hypotheses: Hypotheses
): "validated" | "invalidated" | null {
  if (a.status === "validated" || a.status === "invalidated") return null;
  const test = linkedTest(a.sentTo, hypotheses);
  return test.state === "tested" && test.result !== "inconclusive" ? test.result : null;
}
