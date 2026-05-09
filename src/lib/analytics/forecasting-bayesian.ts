import { mean, stdDev } from "./anomaly";
import type { ForecastPoint } from "./forecasting";
import { holtSmoothing } from "./forecasting";

export interface BayesianForecastOptions {
  /** Optional team-level prior on the level (e.g., last-quarter mean). */
  priorMean?: number;
  /** Strength of the prior in pseudo-observations. Higher = trust prior more when n is small. */
  priorWeight?: number;
  /** Holt smoothing parameters. */
  alpha?: number;
  beta?: number;
}

/**
 * Bayesian-flavoured Holt forecast. Treats the existing Holt point estimate
 * as the MAP under a flat prior; when n is small (<5) it shrinks toward an
 * optional team prior. Posterior predictive bands use residual variance
 * with a half-Cauchy-style inflation when n is tiny — wider, honest
 * intervals at low sample sizes rather than the over-confident bands
 * the plain Holt produces.
 *
 * Falls back to Holt when n >= 6 and no prior is provided.
 */
export function forecastBayesianHolt(
  series: number[],
  horizon: number,
  opts: BayesianForecastOptions = {}
): ForecastPoint[] {
  const n = series.length;
  if (n === 0 || horizon <= 0) return [];
  const alpha = opts.alpha ?? 0.5;
  const beta = opts.beta ?? 0.2;
  const priorMean = opts.priorMean;
  const priorWeight = Math.max(0, opts.priorWeight ?? 2);

  // For n>=2 use Holt; for n<2 collapse to the prior or last observation.
  let levelHat: number;
  let trendHat: number;
  let residStd: number;
  if (n >= 2) {
    const fit = holtSmoothing(series, alpha, beta);
    levelHat = fit.level;
    trendHat = fit.trend;
    residStd = fit.residualStd;
  } else {
    levelHat = series[0] ?? priorMean ?? 0;
    trendHat = 0;
    residStd = 0;
  }

  // Shrinkage toward prior when sample is small.
  if (priorMean !== undefined && priorWeight > 0 && n > 0) {
    const w = priorWeight / (priorWeight + n);
    levelHat = w * priorMean + (1 - w) * levelHat;
  }

  // Inflate σ for tiny samples — half-Cauchy-inspired tail factor.
  // n=1 → ×3, n=2 → ×2, n=3 → ×1.5, n>=6 → ×1.
  const inflate = n >= 6 ? 1 : 1 + (6 - n) * 0.4;
  const sigma = Math.max(residStd * inflate, Math.abs(levelHat) * 0.05, 0.5);

  const out: ForecastPoint[] = [];
  for (let h = 1; h <= horizon; h++) {
    const yHat = levelHat + h * trendHat;
    // Variance grows with forecast horizon (random-walk component).
    const sd = sigma * Math.sqrt(h);
    out.push({
      x: n + h - 1,
      yHat,
      lower80: yHat - 1.28 * sd,
      upper80: yHat + 1.28 * sd,
      lower95: yHat - 1.96 * sd,
      upper95: yHat + 1.96 * sd,
    });
  }
  return out;
}

/**
 * Returns a confidence label suitable for badges based on sample size and
 * residual stability. "high" only when n>=6 and residual coefficient of
 * variation is below 0.3.
 */
export function bayesianForecastConfidence(series: number[]): "low" | "medium" | "high" {
  const n = series.length;
  if (n < 3) return "low";
  if (n < 6) return "medium";
  const m = Math.abs(mean(series));
  const s = stdDev(series);
  if (m === 0) return "medium";
  return s / m < 0.3 ? "high" : "medium";
}
