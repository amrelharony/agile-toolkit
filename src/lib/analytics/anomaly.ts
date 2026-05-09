export interface AnomalyResult {
  index: number;
  value: number;
  zScore: number;
  direction: "high" | "low";
  severity: "mild" | "moderate" | "extreme";
}

export function mean(series: number[]): number {
  if (series.length === 0) return 0;
  return series.reduce((a, b) => a + b, 0) / series.length;
}

export function stdDev(series: number[]): number {
  const n = series.length;
  if (n < 2) return 0;
  const m = mean(series);
  return Math.sqrt(series.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1));
}

export function quantile(sortedSeries: number[], q: number): number {
  if (sortedSeries.length === 0) return 0;
  const pos = (sortedSeries.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (base + 1 < sortedSeries.length) {
    return sortedSeries[base] + rest * (sortedSeries[base + 1] - sortedSeries[base]);
  }
  return sortedSeries[base];
}

export function zScoreAnomalies(series: number[], threshold = 2): AnomalyResult[] {
  if (series.length < 3) return [];
  const m = mean(series);
  const s = stdDev(series);
  if (s === 0) return [];
  const out: AnomalyResult[] = [];
  for (let i = 0; i < series.length; i++) {
    const z = (series[i] - m) / s;
    if (Math.abs(z) >= threshold) {
      const abs = Math.abs(z);
      out.push({
        index: i,
        value: series[i],
        zScore: z,
        direction: z > 0 ? "high" : "low",
        severity: abs >= 3 ? "extreme" : abs >= 2.5 ? "moderate" : "mild",
      });
    }
  }
  return out;
}

export function iqrOutliers(series: number[]): { lowerFence: number; upperFence: number; outliers: number[] } {
  if (series.length < 4) return { lowerFence: 0, upperFence: 0, outliers: [] };
  const sorted = series.slice().sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;
  const outliers = series.filter((v) => v < lowerFence || v > upperFence);
  return { lowerFence, upperFence, outliers };
}

export function trendDirection(series: number[]): "rising" | "falling" | "flat" {
  if (series.length < 3) return "flat";
  let rises = 0;
  let falls = 0;
  for (let i = 1; i < series.length; i++) {
    if (series[i] > series[i - 1]) rises++;
    else if (series[i] < series[i - 1]) falls++;
  }
  // Threshold compares against the number of *adjacent pairs* (length - 1),
  // not length. The previous form was systematically harder to hit — e.g. a
  // 10-point series produced 9 comparisons but required 6/10 ≈ 67% of pairs.
  const pairs = series.length - 1;
  if (rises >= pairs * 0.6) return "rising";
  if (falls >= pairs * 0.6) return "falling";
  return "flat";
}
