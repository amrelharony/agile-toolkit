export interface KMeansResult {
  k: number;
  labels: number[];           // index → cluster id
  centroids: number[][];      // [cluster][dim]
  inertia: number;            // sum of squared distances to assigned centroid
  iterations: number;
}

// Deterministic PRNG so clusters are stable across renders (same input → same labels).
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function squaredDistance(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return s;
}

function kMeansPlusPlusInit(points: number[][], k: number, rand: () => number): number[][] {
  const centroids: number[][] = [];
  // Pick first centroid uniformly.
  centroids.push(points[Math.floor(rand() * points.length)].slice());

  while (centroids.length < k) {
    // Distance from each point to nearest existing centroid.
    const distances = points.map((p) => {
      let min = Infinity;
      for (const c of centroids) {
        const d = squaredDistance(p, c);
        if (d < min) min = d;
      }
      return min;
    });
    const total = distances.reduce((a, b) => a + b, 0);
    if (total === 0) break; // duplicates
    let r = rand() * total;
    let chosen = 0;
    for (let i = 0; i < distances.length; i++) {
      r -= distances[i];
      if (r <= 0) { chosen = i; break; }
    }
    centroids.push(points[chosen].slice());
  }
  return centroids;
}

/**
 * Lloyd's k-means with k-means++ initialisation. Single fixed seed for
 * deterministic results; cap at 50 iterations or until centroids stabilise.
 *
 * Use for low-dimensional clustering (≤8 features). Caps at 500 points to
 * keep client-side runtime bounded.
 */
export function kMeans(points: number[][], k: number, maxIter = 50, seed = 42): KMeansResult {
  if (points.length === 0 || k <= 0) {
    return { k, labels: [], centroids: [], inertia: 0, iterations: 0 };
  }
  const sampled = points.length > 500 ? points.slice(0, 500) : points;
  const realK = Math.min(k, sampled.length);
  const rand = mulberry32(seed);
  let centroids = kMeansPlusPlusInit(sampled, realK, rand);
  let labels = new Array(sampled.length).fill(0);
  let iterations = 0;

  for (let iter = 0; iter < maxIter; iter++) {
    iterations = iter + 1;
    let changed = false;

    // Assign each point to its nearest centroid.
    for (let i = 0; i < sampled.length; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const d = squaredDistance(sampled[i], centroids[c]);
        if (d < bestD) { bestD = d; best = c; }
      }
      if (labels[i] !== best) { labels[i] = best; changed = true; }
    }

    // Recompute centroids.
    const dim = sampled[0].length;
    const sums: number[][] = Array.from({ length: realK }, () => new Array(dim).fill(0));
    const counts: number[] = new Array(realK).fill(0);
    for (let i = 0; i < sampled.length; i++) {
      const lbl = labels[i];
      counts[lbl]++;
      for (let d = 0; d < dim; d++) sums[lbl][d] += sampled[i][d];
    }
    centroids = sums.map((s, idx) =>
      counts[idx] === 0 ? centroids[idx] : s.map((v) => v / counts[idx])
    );

    if (!changed) break;
  }

  // Compute inertia for elbow detection.
  let inertia = 0;
  for (let i = 0; i < sampled.length; i++) {
    inertia += squaredDistance(sampled[i], centroids[labels[i]]);
  }

  // Pad labels back out for points beyond the 500-sample cap.
  if (points.length > sampled.length) {
    const padded = labels.concat(new Array(points.length - sampled.length).fill(-1));
    return { k: realK, labels: padded, centroids, inertia, iterations };
  }
  return { k: realK, labels, centroids, inertia, iterations };
}

/**
 * Auto-pick k by elbow detection: run k=2..maxK, find the k where inertia
 * gain plateaus. Uses the second-difference heuristic; if no clear elbow,
 * defaults to k=2.
 */
export function kMeansAuto(points: number[][], maxK = 6): KMeansResult {
  if (points.length < 4) {
    return kMeans(points, Math.min(2, points.length));
  }
  const candidateK = Math.min(maxK, Math.floor(points.length / 2));
  const runs: KMeansResult[] = [];
  for (let k = 2; k <= candidateK; k++) runs.push(kMeans(points, k));

  // Second-difference elbow: find the k whose Δinertia drops most relative
  // to the next k's Δinertia.
  let bestIdx = 0;
  let bestGap = -Infinity;
  for (let i = 1; i < runs.length - 1; i++) {
    const dPrev = runs[i - 1].inertia - runs[i].inertia;
    const dNext = runs[i].inertia - runs[i + 1].inertia;
    const gap = dPrev - dNext;
    if (gap > bestGap) { bestGap = gap; bestIdx = i; }
  }
  // Require a meaningful elbow — otherwise tiny numeric jitter on inertia
  // plateaus picks an arbitrary k. Threshold at 1% of the k=2 inertia keeps
  // us conservative: we only "see" an elbow when the bend is materially
  // larger than floating-point noise. If no meaningful elbow exists, fall
  // back to k=2 (the simplest non-trivial clustering).
  const minMeaningfulGap = runs[0].inertia * 0.01;
  return bestGap > minMeaningfulGap ? runs[bestIdx] : runs[0];
}
