/**
 * Generic weighted-scoring helpers reused by RICE / ICE / WSJF / Pugh /
 * Vendor / 9-Box / Buy-a-Feature.
 *
 * Each framework has its own scoring formula but the *shape* of the
 * input data is similar enough that one set of helpers covers all of
 * them: a list of items, each with named fields, returning a sorted
 * scored list with rank + percentile.
 */

export interface ScoredItem<T = Record<string, number>> {
  id: string;
  title: string;
  fields: T;
  score: number;
}

export interface RankedItem<T = Record<string, number>> extends ScoredItem<T> {
  rank: number;
  /** 0..1 percentile within the input set (1 = top). */
  percentile: number;
}

/** Coerce a value to a finite number with a fallback. Handles NaN, Infinity, null, undefined. */
function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Compute the RICE score: (Reach * Impact * Confidence) / Effort.
 * Confidence is expressed as a percentage 0..100. Effort floor at 0.5
 * to avoid divide-by-zero blowups on quick-input typos.
 */
export function riceScore(
  reach: number,
  impact: number,
  confidencePct: number,
  effort: number,
): number {
  const eff = Math.max(0.5, num(effort, 0.5));
  const conf = Math.max(0, Math.min(100, num(confidencePct, 0))) / 100;
  return (Math.max(0, num(reach)) * Math.max(0, num(impact)) * conf) / eff;
}

/** ICE: Impact * Confidence * Ease, all 1-10. */
export function iceScore(impact: number, confidence: number, ease: number): number {
  const clamp = (v: number) => Math.max(1, Math.min(10, num(v, 1)));
  return clamp(impact) * clamp(confidence) * clamp(ease);
}

/**
 * WSJF: (Business Value + Time Criticality + Risk Reduction/Opportunity Enablement)
 *       ÷ Job Size.
 */
export function wsjfScore(
  businessValue: number,
  timeCriticality: number,
  rrOe: number,
  jobSize: number,
): number {
  const size = Math.max(0.5, num(jobSize, 0.5));
  return (Math.max(0, num(businessValue)) + Math.max(0, num(timeCriticality)) + Math.max(0, num(rrOe))) / size;
}

/**
 * Weighted decision matrix (Pugh / MCDA). Sums each option's
 * `score(criterion) * weight(criterion)` across all criteria.
 */
export function weightedScore(
  optionScores: Record<string, number>,
  criteriaWeights: Record<string, number>,
): number {
  let total = 0;
  for (const [criterionId, weight] of Object.entries(criteriaWeights)) {
    const s = num(optionScores[criterionId]);
    total += s * num(weight);
  }
  return total;
}

/**
 * Rank items by score descending, attaching `rank` (1-based) and
 * `percentile` (0..1, where 1 is the top item) to each. Stable sort
 * preserves insertion order on ties.
 */
export function rank<T>(items: ScoredItem<T>[]): RankedItem<T>[] {
  if (items.length === 0) return [];
  const indexed = items.map((it, i) => ({
    ...it,
    score: num(it.score),
    _i: i,
  }));
  indexed.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a._i - b._i;
  });
  const n = indexed.length;
  // R8: use DENSE RANK so tied items get the SAME rank + percentile.
  // Previously two items tied at the top got rank 1 and 2, percentile
  // 1.0 and 0.5 — same score, different stats. That broke "top decile"
  // exports + caused render flicker as tied items swapped positions.
  let denseRank = 0;
  let prevScore: number | undefined;
  const ranks: number[] = [];
  for (let i = 0; i < indexed.length; i++) {
    if (prevScore === undefined || indexed[i].score !== prevScore) {
      denseRank++;
      prevScore = indexed[i].score;
    }
    ranks.push(denseRank);
  }
  const maxRank = denseRank || 1;
  return indexed.map((it, idx) => ({
    id: it.id,
    title: it.title,
    fields: it.fields,
    score: it.score,
    rank: ranks[idx],
    // Use the dense rank as the percentile source so ties get the same
    // percentile (1 = top). n=1 → percentile 1.
    percentile: n === 1 ? 1 : (maxRank - ranks[idx] + 1) / maxRank,
  }));
}

/**
 * Detect outliers: items whose score sits more than k * IQR outside
 * Q1/Q3. Useful for flagging "this RICE score is suspiciously high —
 * recheck the inputs." Returns a Set of ids.
 */
export function detectOutliers<T>(items: ScoredItem<T>[], k = 1.5): Set<string> {
  if (items.length < 4) return new Set();
  const sorted = items.map((i) => i.score).sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  const lo = q1 - k * iqr;
  const hi = q3 + k * iqr;
  const out = new Set<string>();
  for (const it of items) {
    if (it.score < lo || it.score > hi) out.add(it.id);
  }
  return out;
}

/**
 * Cluster items by score quartile — handy for the "Big Bets / Quick
 * Wins / Fill-Ins / Time Wasters" 2x2 tooling.
 */
export function quartileBucket<T>(items: ScoredItem<T>[]): Map<string, "Q1" | "Q2" | "Q3" | "Q4"> {
  const out = new Map<string, "Q1" | "Q2" | "Q3" | "Q4">();
  if (items.length === 0) return out;
  const sorted = [...items].sort((a, b) => a.score - b.score);
  const q1Cut = sorted[Math.floor(sorted.length * 0.25)]?.score ?? 0;
  const q2Cut = sorted[Math.floor(sorted.length * 0.5)]?.score ?? 0;
  const q3Cut = sorted[Math.floor(sorted.length * 0.75)]?.score ?? 0;
  for (const it of items) {
    if (it.score >= q3Cut) out.set(it.id, "Q4");
    else if (it.score >= q2Cut) out.set(it.id, "Q3");
    else if (it.score >= q1Cut) out.set(it.id, "Q2");
    else out.set(it.id, "Q1");
  }
  return out;
}
