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
  let t = seed >>> 0;
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
  if (series.length === 0) {
    return { point: 0, lower: 0, upper: 0, confidence, iterations: 0 };
  }
  const point = statistic(series);
  if (series.length < 3) {
    return { point, lower: point, upper: point, confidence, iterations: 0 };
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
  return {
    point,
    lower: quantile(sorted, alphaTail),
    upper: quantile(sorted, 1 - alphaTail),
    confidence,
    iterations,
  };
}

/** Convenience wrappers for the common cases. */
export const bootstrapMean = (s: number[], iter = 1000) =>
  bootstrapCI(s, (a) => mean(a), iter);

export const bootstrapQuantile = (s: number[], q: number, iter = 1000) =>
  bootstrapCI(s, (a) => quantile(a.slice().sort((x, y) => x - y), q), iter);
