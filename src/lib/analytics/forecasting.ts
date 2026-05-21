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
  //
  // NOTE on bands: ±1.28σ (80%) and ±1.96σ (95%) assume residuals are
  // approximately normally distributed. Velocity, throughput, and burndown
  // residuals are typically right-skewed (capped at 0 on the low end), so
  // the upper band underestimates the true tail. For higher-fidelity bands,
  // see `forecastBayesianHolt` which inflates σ at low sample counts.
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
  // Need at least 2 points to fit level + trend; below that the residual
  // std is 0 (no error to measure), which collapses the confidence band
  // to a meaningless line. Return empty so callers can hide the chart.
  if (series.length < 2 || horizon < 1) return [];
  const fit = holtSmoothing(series, alpha, beta);
  if (!Number.isFinite(fit.level) || !Number.isFinite(fit.trend)) return [];
  const sigma0 = Number.isFinite(fit.residualStd) ? fit.residualStd : 0;
  const out: ForecastPoint[] = [];
  for (let h = 1; h <= horizon; h++) {
    const yHat = fit.level + h * fit.trend;
    const sigma = sigma0 * Math.sqrt(h);
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
  // Defensive against invalid `window`: zero/negative/NaN window would
  // produce all-zero slices (length 0 ⇒ division by zero ⇒ NaN). Clamp
  // to at least 1 — the natural identity-ish operation in the degenerate
  // case is just to echo each point as its own "average".
  const w = Math.max(1, Math.floor(Number.isFinite(window) ? window : 1));
  const out: number[] = [];
  for (let i = 0; i < series.length; i++) {
    const start = Math.max(0, i - w + 1);
    const slice = series.slice(start, i + 1);
    out.push(slice.reduce((a, b) => a + b, 0) / slice.length);
  }
  return out;
}

export function predictabilityScore(series: number[]): number {
  // Filter NaN/Infinity inputs — a single bad value used to taint the
  // mean and variance, propagating NaN through every downstream caller.
  const clean = series.filter((v): v is number => Number.isFinite(v));
  if (clean.length < 2) return 0;
  const mean = clean.reduce((a, b) => a + b, 0) / clean.length;
  const variance = clean.reduce((a, b) => a + (b - mean) ** 2, 0) / clean.length;
  // Zero variance ⇒ perfectly predictable, even when the mean is 0.
  if (variance === 0) return 1;
  if (mean === 0) return 0;
  const cv = Math.sqrt(variance) / Math.abs(mean);
  if (!Number.isFinite(cv)) return 0;
  return Math.max(0, Math.min(1, 1 - cv));
}
