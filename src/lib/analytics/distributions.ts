/**
 * The standard normal distribution, precisely: its CDF, its upper tail and
 * its quantile, plus the chi-square upper tail with one degree of freedom.
 * The A/B Calculator's sample sizes, intervals and p values read these
 * (lib/experiments/ab).
 *
 * `trend-test.ts` and `bootstrap.ts` keep their own private, rougher
 * helpers (an Abramowitz–Stegun CDF with an error near 7.5e-8, and an
 * inverse that is good to a few digits): switching them to these would
 * shift locked analytics outputs, so they stay as they are.
 *
 * Pure: no imports.
 */

const SQRT2 = Math.SQRT2;
const SQRT_PI = Math.sqrt(Math.PI);
const SQRT_2PI = Math.sqrt(2 * Math.PI);

/**
 * erf(z) for |z| below about 2.2, from the series with positive terms only
 * (no cancellation): erf(z) = 2/√π · e^(−z²) · Σ 2ⁿ z^(2n+1) / (1·3·…·(2n+1)).
 */
function erfSeries(z: number): number {
  const z2 = z * z;
  let term = z;
  let sum = z;
  for (let n = 1; n < 200; n++) {
    term *= (2 * z2) / (2 * n + 1);
    sum += term;
    if (Math.abs(term) <= Math.abs(sum) * 1e-17) break;
  }
  return (2 / SQRT_PI) * Math.exp(-z2) * sum;
}

/**
 * erfc(z) for z above about 2, from its continued fraction
 * erfc(z) = e^(−z²)/√π · 1/(z + (1/2)/(z + 1/(z + (3/2)/(z + …)))),
 * evaluated from the back.
 */
function erfcFraction(z: number): number {
  let t = z;
  for (let k = 160; k >= 1; k--) t = z + k / 2 / t;
  return Math.exp(-z * z) / SQRT_PI / t;
}

/** Where the series hands over to the continued fraction, in x (|x| = 3 is z ≈ 2.12). */
const SWITCH = 3;

/** P(X ≤ x) for a standard normal X. Absolute error about 1e-15. */
export function normalCdf(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x === Infinity) return 1;
  if (x === -Infinity) return 0;
  if (x <= -SWITCH) return 0.5 * erfcFraction(-x / SQRT2);
  if (x >= SWITCH) return 1 - 0.5 * erfcFraction(x / SQRT2);
  return 0.5 * (1 + erfSeries(x / SQRT2));
}

/**
 * P(X > x), the upper tail, computed directly rather than as 1 − CDF, so a
 * small p value keeps its digits (normalSf(5) is 2.87e-7, not 2.87e-7 ± 1e-16).
 */
export function normalSf(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x === Infinity) return 0;
  if (x === -Infinity) return 1;
  if (x >= SWITCH) return 0.5 * erfcFraction(x / SQRT2);
  if (x <= -SWITCH) return 1 - 0.5 * erfcFraction(-x / SQRT2);
  return 0.5 * (1 - erfSeries(x / SQRT2));
}

/* Acklam's rational approximation (relative error about 1e-9), then refined. */
const A = [
  -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
  -3.066479806614716e1, 2.506628277459239,
];
const B = [
  -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
  -1.328068155288572e1,
];
const C = [
  -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
  4.374664141464968, 2.938163982698783,
];
const D = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
const P_LOW = 0.02425;

function acklam(p: number): number {
  if (p < P_LOW) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) /
      ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1)
    );
  }
  if (p > 1 - P_LOW) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(
      (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) /
      ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1)
    );
  }
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q) /
    (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1)
  );
}

/**
 * The x with P(X ≤ x) = p: Acklam's approximation, then two Halley steps
 * against `normalCdf` (the upper tail through `normalSf` above ½, so both
 * ends keep their digits). A RangeError outside (0, 1).
 */
export function normalQuantile(p: number): number {
  if (!(p > 0 && p < 1)) throw new RangeError(`normalQuantile needs 0 < p < 1, got ${p}`);
  let x = acklam(p);
  for (let i = 0; i < 2; i++) {
    // cdf(x) − p, from the side that keeps its digits.
    const e = p < 0.5 ? normalCdf(x) - p : 1 - p - normalSf(x);
    const u = e * SQRT_2PI * Math.exp((x * x) / 2);
    x -= u / (1 + (x * u) / 2);
  }
  return x;
}

/**
 * P(χ² > x) with one degree of freedom: a χ²(1) is a squared standard
 * normal, so this is 2 · P(Z > √x), with no gamma function needed. 1 for
 * x ≤ 0.
 */
export function chiSquareSf1(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x <= 0) return 1;
  return 2 * normalSf(Math.sqrt(x));
}
