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
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    // R8: NaN/Infinity propagation pollutes the entire pipeline. A
    // sticky with `x: NaN` (from a bad import) made every distance NaN,
    // `total` NaN, `r` NaN, and the weighted-pick chose `chosen=0`
    // permanently → centroids collapsed to a single point. Coerce
    // non-finite components to Infinity so the offending point at
    // least loses the weighted-pick fairly.
    const sq = d * d;
    if (!Number.isFinite(sq)) return Infinity;
    s += sq;
  }
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
    if (total === 0) break; // all remaining points are duplicates of existing centroids
    let r = rand() * total;
    let chosen = 0;
    for (let i = 0; i < distances.length; i++) {
      r -= distances[i];
      if (r <= 0) { chosen = i; break; }
    }
    centroids.push(points[chosen].slice());
  }
  // PAD: if duplicates broke initialization early, callers downstream still
  // expect `centroids.length === k`. Pad with copies of the first centroid
  // — these slots will receive zero points during assignment (since every
  // candidate is already closer to the original), but the slot-count
  // invariant is preserved so kMeans's `sums[realK]` / `counts[realK]`
  // allocations don't index-out-of-bounds.
  while (centroids.length < k) centroids.push(centroids[0].slice());
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
  const labels = new Array(sampled.length).fill(0);
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
    // R8: empty-cluster handling previously kept the OLD centroid in
    // place — that cluster could stay empty across all subsequent
    // iterations, so the algorithm reported k clusters where one had
    // zero members (no labels ever pointed at it). Re-seed empty
    // clusters at the point FARTHEST from any current centroid
    // (Forgy heuristic) so the cluster has a chance to attract members.
    centroids = sums.map((s, idx) => {
      if (counts[idx] !== 0) return s.map((v) => v / counts[idx]);
      // Find the point farthest from any existing centroid.
      let farIdx = 0;
      let farDist = -1;
      for (let i = 0; i < sampled.length; i++) {
        let minD = Infinity;
        for (const c of centroids) {
          const d = squaredDistance(sampled[i], c);
          if (d < minD) minD = d;
        }
        if (minD > farDist) { farDist = minD; farIdx = i; }
      }
      changed = true;
      return sampled[farIdx].slice();
    });

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
