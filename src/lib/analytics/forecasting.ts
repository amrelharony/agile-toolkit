export interface Point {
  x: number;
  y: number;
}

export interface ForecastPoint {
  x: number;
  yHat: number;
  lower80: number;
  upper80: number;
  lower95: number;
  upper95: number;
}

export interface LinearFit {
  slope: number;
  intercept: number;
  r2: number;
  residualStd: number;
}

export function linearRegression(points: Point[]): LinearFit {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: n === 1 ? points[0].y : 0, r2: 0, residualStd: 0 };
  const meanX = points.reduce((a, p) => a + p.x, 0) / n;
  const meanY = points.reduce((a, p) => a + p.y, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.x - meanX) * (p.y - meanY);
    den += (p.x - meanX) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = meanY - slope * meanX;

  let ssTot = 0;
  let ssRes = 0;
  for (const p of points) {
    const yHat = slope * p.x + intercept;
    ssRes += (p.y - yHat) ** 2;
    ssTot += (p.y - meanY) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  const residualStd = n > 2 ? Math.sqrt(ssRes / (n - 2)) : 0;

  return { slope, intercept, r2, residualStd };
}

export function forecastLinear(points: Point[], horizons: number[]): ForecastPoint[] {
  // Need at least 2 points to fit a line and 3 for meaningful confidence bands.
  // Returning an empty array avoids NaN-laced forecasts rendering as blank gaps.
  if (points.length < 2) return [];
  const fit = linearRegression(points);
  if (!Number.isFinite(fit.slope) || !Number.isFinite(fit.intercept)) return [];
  const sigma = Number.isFinite(fit.residualStd) ? fit.residualStd : 0;
  return horizons.map((x) => {
    const yHat = fit.slope * x + fit.intercept;
    return {
      x,
      yHat,
      lower80: yHat - 1.28 * sigma,
      upper80: yHat + 1.28 * sigma,
      lower95: yHat - 1.96 * sigma,
      upper95: yHat + 1.96 * sigma,
    };
  });
}

export interface HoltFit {
  level: number;
  trend: number;
  smoothed: number[];
  residualStd: number;
}

export function holtSmoothing(series: number[], alpha = 0.5, beta = 0.3): HoltFit {
  if (series.length === 0) return { level: 0, trend: 0, smoothed: [], residualStd: 0 };
  if (series.length === 1) return { level: series[0], trend: 0, smoothed: [series[0]], residualStd: 0 };

  let level = series[0];
  let trend = series[1] - series[0];
  const smoothed: number[] = [level];
  const residuals: number[] = [];

  for (let i = 1; i < series.length; i++) {
    const prevLevel = level;
    const prevTrend = trend;
    // Residual is observed minus the one-step-ahead forecast, which uses the
    // PRIOR level+trend. Capture prevTrend before updating, otherwise the
    // residual variance is biased and the forecast bands come out wrong.
    level = alpha * series[i] + (1 - alpha) * (prevLevel + prevTrend);
    trend = beta * (level - prevLevel) + (1 - beta) * prevTrend;
    smoothed.push(level);
    residuals.push(series[i] - (prevLevel + prevTrend));
  }

  const mean = residuals.reduce((a, b) => a + b, 0) / Math.max(residuals.length, 1);
  const variance =
    residuals.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(residuals.length - 1, 1);
  const residualStd = Math.sqrt(variance);

  return { level, trend, smoothed, residualStd };
}

export function forecastHolt(series: number[], horizon: number, alpha = 0.5, beta = 0.3): ForecastPoint[] {
  const fit = holtSmoothing(series, alpha, beta);
  const out: ForecastPoint[] = [];
  for (let h = 1; h <= horizon; h++) {
    const yHat = fit.level + h * fit.trend;
    const sigma = fit.residualStd * Math.sqrt(h);
    out.push({
      x: series.length - 1 + h,
      yHat,
      lower80: yHat - 1.28 * sigma,
      upper80: yHat + 1.28 * sigma,
      lower95: yHat - 1.96 * sigma,
      upper95: yHat + 1.96 * sigma,
    });
  }
  return out;
}

export function rollingAverage(series: number[], window: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < series.length; i++) {
    const start = Math.max(0, i - window + 1);
    const slice = series.slice(start, i + 1);
    out.push(slice.reduce((a, b) => a + b, 0) / slice.length);
  }
  return out;
}

export function predictabilityScore(series: number[]): number {
  if (series.length < 2) return 0;
  const mean = series.reduce((a, b) => a + b, 0) / series.length;
  const variance = series.reduce((a, b) => a + (b - mean) ** 2, 0) / series.length;
  // Zero variance ⇒ perfectly predictable, even when the mean is 0.
  if (variance === 0) return 1;
  if (mean === 0) return 0;
  const cv = Math.sqrt(variance) / Math.abs(mean);
  if (!Number.isFinite(cv)) return 0;
  return Math.max(0, Math.min(1, 1 - cv));
}
