import { mean, quantile } from "./anomaly";

export interface BootstrapCI {
  point: number;
  lower: number;
  upper: number;
  confidence: number; // e.g., 0.95
  iterations: number;
}

// Re-seedable Mulberry32 PRNG so bootstrap results are deterministic given
// the same input (matters for snapshot tests + UI stability).
function mulberry32(seed: number): () => number {
  // Mix in golden-ratio constant when seed=0, otherwise the PRNG cycles
  // through a low-entropy region for the first few hundred draws. Matches
  // the same fix in monte-carlo.ts.
  let t = (seed >>> 0) || 0x9e3779b9;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Bootstrap confidence interval for an arbitrary statistic of a 1-D series.
 * Resamples with replacement `iterations` times; returns the percentile CI.
 *
 * Use this for non-normal data (cycle-time is log-normal, throughput is
 * Poisson-ish at small n) where the parametric bands from Holt's residuals
 * are not honest.
 *
 * @param series      observations
 * @param statistic   reducer (e.g., mean, quantile@0.85)
 * @param iterations  default 1000 — increase to 5000 for tighter intervals
 * @param confidence  default 0.95
 * @param seed        default 12345 — change for variance estimates
 */
export function bootstrapCI(
  series: number[],
  statistic: (sample: number[]) => number,
  iterations = 1000,
  confidence = 0.95,
  seed = 12345
): BootstrapCI {
  // R8: floor at 1000. The previous 200-rep floor produced 2.5%/97.5%
  // quantiles at indices stats[5]/stats[195] — each end was a single
  // bootstrap sample so the CI bounds flickered by ~5% of the data
  // range across renders. Efron & Tibshirani's rule of thumb is ≥1000
  // for percentile CIs.
  iterations = Math.max(iterations, 1000);
  if (series.length === 0) {
    return { point: 0, lower: 0, upper: 0, confidence, iterations: 0 };
  }
  const point = statistic(series);
  if (series.length < 3) {
    // R8: previously returned a zero-width CI (lower=upper=point) which
    // LIED about uncertainty — n=2 actually has enormous CIs. Return
    // ±Infinity so consumers render "—" / "no CI" rather than a
    // fake-precise band.
    return { point, lower: -Infinity, upper: Infinity, confidence, iterations: 0 };
  }
  const rand = mulberry32(seed);
  const stats: number[] = new Array(iterations);
  const n = series.length;
  for (let i = 0; i < iterations; i++) {
    const sample: number[] = new Array(n);
    for (let j = 0; j < n; j++) {
      sample[j] = series[Math.floor(rand() * n)];
    }
    stats[i] = statistic(sample);
  }
  const sorted = stats.slice().sort((a, b) => a - b);
  const alphaTail = (1 - confidence) / 2;
  // R10-deferred: BCa (bias-corrected accelerated) bootstrap.
  // Efron & Tibshirani 1993 — for skewed statistics (median, quantile)
  // pure percentile CIs are biased on small-n. BCa corrects via:
  //   1. z0  — bias correction: Φ⁻¹(#(stats < point) / iterations)
  //   2. a   — acceleration via the jackknife (single-leave-out)
  //   3. adjusted quantiles α₁, α₂ derived from z0 + a + α/2
  //
  // Falls through to plain percentile when n is too small for a
  // meaningful jackknife (n < 5) or when the formula degenerates
  // (a is non-finite, e.g. variance of jackknife values is 0).
  const bcaInputs = computeBcaInputs(series, statistic, sorted, point);
  if (bcaInputs && Number.isFinite(bcaInputs.a)) {
    const { z0, a } = bcaInputs;
    const adjusted = (alpha: number): number => {
      const zAlpha = inverseStdNormal(alpha);
      // (z0 + (z0 + zAlpha) / (1 - a*(z0 + zAlpha)))
      const denom = 1 - a * (z0 + zAlpha);
      if (denom === 0 || !Number.isFinite(denom)) return alpha;
      const z = z0 + (z0 + zAlpha) / denom;
      return stdNormalCdf(z);
    };
    const a1 = adjusted(alphaTail);
    const a2 = adjusted(1 - alphaTail);
    return {
      point,
      lower: quantile(sorted, a1),
      upper: quantile(sorted, a2),
      confidence,
      iterations,
    };
  }
  return {
    point,
    lower: quantile(sorted, alphaTail),
    upper: quantile(sorted, 1 - alphaTail),
    confidence,
    iterations,
  };
}

/**
 * Compute z0 (bias correction) and a (acceleration) for BCa.
 * Returns null when the inputs are unsuitable (n<5, all-equal jackknife,
 * degenerate stats array).
 */
function computeBcaInputs(
  series: number[],
  statistic: (sample: number[]) => number,
  sortedStats: readonly number[],
  point: number,
): { z0: number; a: number } | null {
  const n = series.length;
  if (n < 5) return null;
  // z0: proportion of bootstrap replicates strictly below the point estimate.
  let below = 0;
  for (const s of sortedStats) if (s < point) below++;
  const p = below / sortedStats.length;
  // Clamp away from 0 and 1 — Φ⁻¹(0) = -∞, Φ⁻¹(1) = +∞ both blow up.
  const pClamped = Math.max(0.0005, Math.min(0.9995, p));
  const z0 = inverseStdNormal(pClamped);

  // Jackknife — recompute the statistic with one observation removed
  // each pass; the acceleration is a function of the skewness of these
  // values.
  const jack: number[] = new Array(n);
  // Reuse a single buffer to avoid per-iteration array allocations.
  const buf: number[] = new Array(n - 1);
  for (let i = 0; i < n; i++) {
    let k = 0;
    for (let j = 0; j < n; j++) {
      if (j !== i) buf[k++] = series[j];
    }
    jack[i] = statistic(buf);
  }
  const jMean = jack.reduce((s, x) => s + x, 0) / n;
  let num = 0;
  let den = 0;
  for (const j of jack) {
    const d = jMean - j;
    num += d * d * d;
    den += d * d;
  }
  if (den === 0) return null;
  const a = num / (6 * Math.pow(den, 1.5));
  return { z0, a };
}

/** Φ⁻¹ — inverse standard normal CDF via Beasley-Springer-Moro
 *  approximation. Adequate for [0.0005, 0.9995], which the caller
 *  clamps the input into. */
function inverseStdNormal(p: number): number {
  // Coefficients for the Acklam / Beasley-Springer rational approximation.
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q: number;
  let r: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

/** Φ — standard normal CDF via Abramowitz-Stegun rational approximation. */
function stdNormalCdf(z: number): number {
  // 7.1.26 in A&S: |error| < 7.5e-8
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-z * z / 2);
  const p = d * t * ((((1.330274429 * t - 1.821255978) * t + 1.781477937) * t - 0.356563782) * t + 0.319381530);
  return z >= 0 ? 1 - p : p;
}

/** Convenience wrappers for the common cases. */
export const bootstrapMean = (s: number[], iter = 1000) =>
  bootstrapCI(s, (a) => mean(a), iter);

export const bootstrapQuantile = (s: number[], q: number, iter = 1000) =>
  bootstrapCI(s, (a) => quantile(a.slice().sort((x, y) => x - y), q), iter);
