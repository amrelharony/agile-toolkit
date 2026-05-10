export interface MannKendallResult {
  s: number;            // raw test statistic
  z: number;            // standardised statistic
  pValue: number;       // two-sided p-value (normal approximation)
  trend: "up" | "down" | "none";
  significant: boolean; // true at α=0.05
}

/**
 * Mann-Kendall trend test — distribution-free rank-based test for monotonic
 * trend. Works at n>=5; immune to non-normal distributions (cycle times,
 * bug counts, NPS scores). Uses normal approximation for the p-value, which
 * is accurate for n>=8; smaller samples report the same direction but the
 * `significant` flag stays conservative.
 *
 * Anchors "is this trend real?" badges across velocity, NPS, mood, and
 * DORA metrics — replaces eyeballed trendlines.
 */
export function mannKendall(series: number[], alpha = 0.05): MannKendallResult {
  const n = series.length;
  if (n < 5) {
    return { s: 0, z: 0, pValue: 1, trend: "none", significant: false };
  }

  // Compute S = sum over i<j of sgn(x_j - x_i).
  let s = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      const diff = series[j] - series[i];
      if (diff > 0) s++;
      else if (diff < 0) s--;
    }
  }

  // Variance of S (no tie correction — adequate for continuous data).
  const variance = (n * (n - 1) * (2 * n + 5)) / 18;

  // Standardised statistic with continuity correction.
  let z = 0;
  if (s > 0) z = (s - 1) / Math.sqrt(variance);
  else if (s < 0) z = (s + 1) / Math.sqrt(variance);

  // Two-sided p-value via standard-normal CDF approximation
  // (Abramowitz & Stegun 26.2.17).
  const pValue = 2 * (1 - normalCdf(Math.abs(z)));

  // Below n=10 the normal approximation is unreliable — exact tables show
  // material disagreement with the asymptotic z. We still compute and
  // return direction (z, s, pValue) so callers can show a hint, but
  // `significant` stays false until n is large enough for the p-value to
  // be trustworthy.
  const significant = pValue < alpha && n >= 10;
  let trend: "up" | "down" | "none" = "none";
  if (significant) trend = z > 0 ? "up" : "down";

  return { s, z, pValue, trend, significant };
}

// Standard normal CDF — Abramowitz & Stegun 26.2.17 approximation.
// Maximum error ~7.5e-8 in the tails.
function normalCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}
