import { mean, stdDev } from "./anomaly";

export interface LaggedCorrelation {
  lag: number;             // positive: a leads b; negative: b leads a
  r: number;               // Pearson correlation at this lag
  n: number;               // overlapping samples used
}

export interface CrossCorrSummary {
  bestLag: number;
  bestR: number;
  byLag: LaggedCorrelation[];
  strength: "weak" | "moderate" | "strong";
}

/**
 * Pearson cross-correlation across a window of lags. Returns the best lag
 * and the full curve. Ties are broken in favour of negative lag
 * (longer-history alignment wins) — when +k and -k produce equal |r|, the
 * result reports lag=-k. This matches how the surrounding causal-annotation
 * logic frames lagged effects ("B leads A" interpretation when both
 * directions are equally plausible).
 *
 * @param a       series A (e.g., daily blocker counts)
 * @param b       series B (e.g., daily velocity)
 * @param maxLag  max absolute lag to test (in same units as the index)
 *
 * Powers cross-tool causal annotations: blockers↔velocity, mood↔velocity,
 * deploys↔incidents, etc. Results above |r|>=0.5 with overlap n>=6 are
 * worth surfacing as moderate-strength annotations.
 */
export function crossCorrelation(a: number[], b: number[], maxLag = 7): CrossCorrSummary {
  // R8: cap maxLag so the per-lag overlap never collapses below n=3.
  // Without this, with a.length=5 and maxLag=7, lags ±5..7 had overlap
  // 0..2 and returned r=0 — those zeros polluted the `bestR` selection.
  const safeMaxLag = Math.min(maxLag, Math.floor(Math.min(a.length, b.length) / 2));
  const out: LaggedCorrelation[] = [];
  for (let lag = -safeMaxLag; lag <= safeMaxLag; lag++) {
    out.push(correlationAtLag(a, b, lag));
  }
  // R8: filter out lags where correlation was undefined (NaN) before
  // picking the best — without this, NaN comparisons could leak into
  // `Math.abs(NaN)` and the tie-break logic.
  const defined = out.filter((c) => Number.isFinite(c.r));
  if (defined.length === 0) {
    return { bestLag: 0, bestR: 0, byLag: out, strength: "weak" };
  }
  let best = defined[0];
  for (const c of defined) {
    if (Math.abs(c.r) > Math.abs(best.r) || (Math.abs(c.r) === Math.abs(best.r) && Math.abs(c.lag) < Math.abs(best.lag))) {
      best = c;
    }
  }
  const absR = Math.abs(best.r);
  // R8: a 3-sample r=0.6 is meaningless noise. Require n>=6 before
  // upgrading the strength label beyond "weak".
  const strength = best.n >= 6 && absR >= 0.7 ? "strong" : best.n >= 6 && absR >= 0.5 ? "moderate" : "weak";
  return { bestLag: best.lag, bestR: best.r, byLag: out, strength };
}

function correlationAtLag(a: number[], b: number[], lag: number): LaggedCorrelation {
  // Positive lag means a leads b: align a[t] with b[t+lag].
  const aSlice: number[] = [];
  const bSlice: number[] = [];
  for (let i = 0; i < a.length; i++) {
    const j = i + lag;
    if (j >= 0 && j < b.length) {
      aSlice.push(a[i]);
      bSlice.push(b[j]);
    }
  }
  const n = aSlice.length;
  // R8: return NaN (not 0) for undefined cases. r=0 was indistinguishable
  // from "genuinely zero correlation" and polluted strength labelling.
  if (n < 3) return { lag, r: NaN, n };
  const meanA = mean(aSlice);
  const meanB = mean(bSlice);
  const sdA = stdDev(aSlice);
  const sdB = stdDev(bSlice);
  if (sdA === 0 || sdB === 0) return { lag, r: NaN, n };
  let cov = 0;
  for (let i = 0; i < n; i++) cov += (aSlice[i] - meanA) * (bSlice[i] - meanB);
  cov /= n - 1;
  return { lag, r: cov / (sdA * sdB), n };
}
