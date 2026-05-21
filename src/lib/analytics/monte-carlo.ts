export interface MonteCarloInput {
  samples: number[];
  iterations?: number;
  target?: number;
  maxSteps?: number;
  seed?: number;
}

export interface MonteCarloResult {
  percentiles: Record<number, number>;
  histogram: { value: number; count: number }[];
  min: number;
  max: number;
  mean: number;
  iterations: number;
  /** Iterations that hit `maxSteps` without reaching the target. Their value
   *  in the result distribution is `maxSteps`, which biases the upper tail —
   *  callers should surface this so users know the P95 is censored. */
  cappedIterations?: number;
}

function mulberry32(seed: number): () => number {
  // mulberry32 with seed=0 produces a degenerate first-call output (the
  // multiplication by `t | 1` makes the state advance through a known
  // low-entropy region for a few hundred iterations). Mix in a non-zero
  // constant so callers can pass seed=0 deterministically without that
  // burn-in artefact contaminating short simulations.
  let a = (seed >>> 0) || 0x9e3779b9;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function runMonteCarlo({
  samples,
  iterations = 10_000,
  target,
  maxSteps = 500,
  seed,
}: MonteCarloInput): MonteCarloResult {
  const rng = seed !== undefined ? mulberry32(seed) : Math.random;

  const zeroPercentiles: Record<number, number> = {
    5: 0,
    10: 0,
    25: 0,
    50: 0,
    75: 0,
    85: 0,
    90: 0,
    95: 0,
  };

  if (samples.length === 0) {
    return { percentiles: zeroPercentiles, histogram: [], min: 0, max: 0, mean: 0, iterations: 0, cappedIterations: 0 };
  }

  // When simulating completion toward a target, zero or negative samples would
  // never decrement `remaining` and every iteration would cap at maxSteps. Filter
  // them out so the simulation reflects only productive draws.
  const usableSamples =
    target !== undefined && target > 0 ? samples.filter((v) => v > 0) : samples;

  if (usableSamples.length === 0) {
    return { percentiles: zeroPercentiles, histogram: [], min: 0, max: 0, mean: 0, iterations: 0, cappedIterations: 0 };
  }

  const results = new Array<number>(iterations);
  let cappedIterations = 0;

  if (target !== undefined && target > 0) {
    for (let i = 0; i < iterations; i++) {
      let remaining = target;
      let steps = 0;
      while (remaining > 0 && steps < maxSteps) {
        const draw = usableSamples[Math.floor(rng() * usableSamples.length)];
        remaining -= draw;
        steps++;
      }
      if (remaining > 0) cappedIterations++;
      results[i] = steps;
    }
  } else {
    for (let i = 0; i < iterations; i++) {
      results[i] = usableSamples[Math.floor(rng() * usableSamples.length)];
    }
  }

  results.sort((a, b) => a - b);
  // Nearest-rank percentile with explicit ceiling on the right-tail to
  // avoid `Math.floor((100/100) * n) === n` walking off the end. For
  // small iteration counts (test runs), the index can also collide with
  // 0 for P5 on n=10; we accept that — nearest-rank is the documented
  // contract and bias-free for the iteration sizes we ship (10k+).
  const pick = (pct: number) => {
    const idx = Math.min(Math.floor((pct / 100) * iterations), iterations - 1);
    return results[Math.max(0, idx)];
  };

  const percentiles: Record<number, number> = {
    5: pick(5),
    10: pick(10),
    25: pick(25),
    50: pick(50),
    75: pick(75),
    85: pick(85),
    90: pick(90),
    95: pick(95),
  };

  const freq = new Map<number, number>();
  for (const v of results) freq.set(v, (freq.get(v) ?? 0) + 1);
  const histogram = Array.from(freq.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([value, count]) => ({ value, count }));

  const mean = results.reduce((a, b) => a + b, 0) / iterations;

  return {
    percentiles,
    histogram,
    min: results[0],
    max: results[iterations - 1],
    mean,
    iterations,
    cappedIterations,
  };
}

export function simulateThroughputCompletion(
  backlog: number,
  throughputSamples: number[],
  iterations = 10_000
): MonteCarloResult {
  return runMonteCarlo({ samples: throughputSamples, iterations, target: backlog });
}

export function simulateVelocityDistribution(
  velocitySamples: number[],
  iterations = 10_000
): MonteCarloResult {
  return runMonteCarlo({ samples: velocitySamples, iterations });
}
