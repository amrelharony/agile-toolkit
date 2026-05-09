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
 * (rounded toward 0 on ties) and the full curve.
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
  const out: LaggedCorrelation[] = [];
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    out.push(correlationAtLag(a, b, lag));
  }
  let best = out[0];
  for (const c of out) {
    if (Math.abs(c.r) > Math.abs(best.r) || (Math.abs(c.r) === Math.abs(best.r) && Math.abs(c.lag) < Math.abs(best.lag))) {
      best = c;
    }
  }
  const absR = Math.abs(best.r);
  const strength = absR >= 0.7 ? "strong" : absR >= 0.5 ? "moderate" : "weak";
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
  if (n < 3) return { lag, r: 0, n };
  const meanA = mean(aSlice);
  const meanB = mean(bSlice);
  const sdA = stdDev(aSlice);
  const sdB = stdDev(bSlice);
  if (sdA === 0 || sdB === 0) return { lag, r: 0, n };
  let cov = 0;
  for (let i = 0; i < n; i++) cov += (aSlice[i] - meanA) * (bSlice[i] - meanB);
  cov /= n - 1;
  return { lag, r: cov / (sdA * sdB), n };
}
