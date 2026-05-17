/**
 * Adapt the generic k-means in `analytics/clustering.ts` to whiteboard
 * objects. We cluster on (centerX, centerY) and return:
 *   - per-cluster bounding rectangles (to draw an outline overlay)
 *   - per-cluster object IDs (to highlight / group / pass to the AI prompt)
 *
 * Stickies dominate most boards, so by default we filter to type === "sticky".
 * Pass `kinds: undefined` to cluster everything.
 */

import { kMeans } from "@/lib/analytics/clustering";
import type { Rect } from "@/lib/geometry/bbox";
import { boundingBoxOfPoints, inflate } from "@/lib/geometry/bbox";
import type { WhiteboardObject, WhiteboardObjectKind } from "@/lib/stores/workspace-types";
import { objectText } from "./search";

export interface ClusterResult {
  /** Zero-based cluster index. */
  id: number;
  objectIds: string[];
  /** Bounding rect of all member objects, padded by 32px. */
  bbox: Rect;
  /** Geometric center — useful for placing a cluster label. */
  centerX: number;
  centerY: number;
  /** Top tokens shared by members (highest TF-IDF) — used as the
   * auto-generated label "auth / login / password". Only set when
   * clusterMode === "content". */
  topTokens?: string[];
}

export interface ClusterOptions {
  /** Object types to consider. Default: only "sticky". */
  kinds?: WhiteboardObjectKind[];
  /** Number of clusters. If omitted we pick √n / 2, clamped to [2, 6]. */
  k?: number;
  /** "spatial" (default, x/y k-means) or "content" (TF-IDF bag-of-words). */
  mode?: "spatial" | "content";
}

/** English stopword list. Small, no library — tokens to drop before
 * cosine-similarity clustering so common words ("the", "a", "to")
 * don't dominate the signal. */
const STOPWORDS = new Set([
  "a","an","the","and","or","but","if","of","in","on","at","by","for","to","with","from",
  "is","are","was","were","be","been","being","do","does","did","done","have","has","had",
  "this","that","these","those","it","its","as","not","no","yes","i","we","you","he","she","they","them",
  "our","their","my","your","his","her","when","where","why","how","what","who","which",
  "so","up","out","can","will","would","could","should","just","also","than","then","more","most","some","any","all","each","every",
]);

/** Tokenise a text into a multiset of lower-cased stems. The "stem"
 * is just a prefix cut (Porter-light) — we drop trailing `ing`, `ed`,
 * `s`, `'s` so "logging" / "logs" / "logged" collapse together. */
function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || raw.length > 30) continue;
    if (STOPWORDS.has(raw)) continue;
    let t = raw;
    if (t.endsWith("ing")) t = t.slice(0, -3);
    else if (t.endsWith("ed")) t = t.slice(0, -2);
    else if (t.endsWith("ies")) t = t.slice(0, -3) + "y";
    else if (t.endsWith("es")) t = t.slice(0, -2);
    else if (t.endsWith("s")) t = t.slice(0, -1);
    if (t.length >= 3) out.push(t);
  }
  return out;
}

/** Build a fixed-dimension vector for each object via the top-N
 * tokens across the whole corpus. TF for each token in this object,
 * normalised by document length (so 10-word and 100-word objects
 * stand on equal footing). */
function vectorise(objects: readonly WhiteboardObject[]): { vectors: number[][]; vocab: string[] } {
  const docs = objects.map((o) => tokenize(objectText(o) ?? ""));
  // Doc frequency: how many documents contain each token.
  const df = new Map<string, number>();
  for (const d of docs) {
    const unique = Array.from(new Set(d));
    for (const t of unique) df.set(t, (df.get(t) ?? 0) + 1);
  }
  // Pick top 64 tokens by df-up-to-N (avoid rare singletons + common
  // ones present in every doc). Sweet spot: appearing in 2..N/2 docs.
  const maxDf = Math.max(2, Math.floor(docs.length / 2));
  const vocab = Array.from(df.entries())
    .filter(([, f]) => f >= 2 && f <= maxDf)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 64)
    .map(([t]) => t);
  if (vocab.length === 0) {
    // Fall back to a sparse vocab from singletons so we still produce
    // SOMETHING usable (better than collapsing every object to the
    // zero vector).
    const singletons = Array.from(df.entries()).slice(0, 32).map(([t]) => t);
    vocab.push(...singletons);
  }
  const vocabIdx = new Map(vocab.map((t, i) => [t, i] as const));
  // R8: compute IDF per vocab term so rare-but-distinctive tokens
  // dominate the vector (this is what makes it TF-IDF instead of plain
  // TF). The previous code never multiplied by IDF, so all tokens were
  // weighted equally — defeating the point of using vocabulary at all.
  // IDF = log(N / df). Smoothed +1 to avoid log(0) when df hits N.
  const N = docs.length;
  const idf = vocab.map((t) => Math.log((N + 1) / ((df.get(t) ?? 1) + 1)) + 1);
  const vectors = docs.map((d) => {
    const v = new Array(vocab.length).fill(0);
    if (d.length === 0) return v;
    for (const t of d) {
      const i = vocabIdx.get(t);
      if (i !== undefined) v[i] += 1;
    }
    // Apply IDF weighting.
    for (let i = 0; i < v.length; i++) v[i] *= idf[i];
    // L2 normalise so cosine similarity is dot-product.
    let mag = 0;
    for (const x of v) mag += x * x;
    if (mag === 0) {
      // R8: zero-vector (object had no in-vocab tokens). Previously
      // these were normalised by `|| 1` and silently clustered into
      // centroid 0 — empty/numeric-only stickies all clumped together
      // arbitrarily. Mark with a sentinel: leave as zero so the
      // consumer can filter or bucket as "uncategorised".
      return v;
    }
    mag = Math.sqrt(mag);
    for (let i = 0; i < v.length; i++) v[i] /= mag;
    return v;
  });
  return { vectors, vocab };
}

export function clusterObjects(
  objects: readonly WhiteboardObject[],
  opts: ClusterOptions = {},
): ClusterResult[] {
  const kinds = opts.kinds ?? ["sticky"];
  const subset = objects.filter((o) => kinds.includes(o.type));
  if (subset.length < 4) return []; // Not enough signal to cluster meaningfully.

  const k = opts.k ?? Math.max(2, Math.min(6, Math.round(Math.sqrt(subset.length) / 2)));
  const mode = opts.mode ?? "spatial";

  // Content-aware mode: vectorise sticky/card text into a bag-of-words
  // vector, then k-means on those vectors. Spatial position is ignored
  // — clusters group by topic, not by where the stickies happen to sit.
  // We still return per-cluster bboxes (drawn around the spatial extent
  // of the members) so the overlay matches what the user sees.
  let points: number[][];
  let vocab: string[] | null = null;
  if (mode === "content") {
    const v = vectorise(subset);
    // No usable vocab — e.g. every sticky is empty / numeric-only.
    // Returning [] beats producing one giant degenerate cluster.
    if (v.vocab.length === 0) return [];
    points = v.vectors;
    vocab = v.vocab;
  } else {
    points = subset.map((o) => [o.x + o.w / 2, o.y + o.h / 2]);
  }

  const result = kMeans(points, k);
  // `kmeans` returns { labels, centroids, iterations }. Group object IDs by label.
  const grouped: Record<number, string[]> = {};
  result.labels.forEach((lbl, i) => {
    if (!grouped[lbl]) grouped[lbl] = [];
    grouped[lbl].push(subset[i].id);
  });

  return Object.entries(grouped).map(([lblStr, ids]) => {
    const lbl = Number(lblStr);
    const members = subset.filter((o) => ids.includes(o.id));
    const centers = members.map((o) => ({ x: o.x + o.w / 2, y: o.y + o.h / 2 }));
    // Cluster bbox derived from member centers + each object's half-extent.
    const memberRects: { x: number; y: number }[] = [];
    for (const o of members) {
      memberRects.push({ x: o.x, y: o.y });
      memberRects.push({ x: o.x + o.w, y: o.y + o.h });
    }
    const bbox = inflate(boundingBoxOfPoints(memberRects), 32);
    const center = boundingBoxOfPoints(centers);
    // Top tokens by cluster centroid: in content mode, the centroid
    // vector is in vocab space, so the 3 highest dimensions ARE the
    // most-representative words for this cluster — a free auto-label.
    let topTokens: string[] | undefined;
    if (mode === "content" && vocab && result.centroids[lbl]) {
      const centroid = result.centroids[lbl];
      topTokens = vocab
        .map((t, i) => ({ t, w: centroid[i] ?? 0 }))
        .filter((x) => x.w > 0)
        .sort((a, b) => b.w - a.w)
        .slice(0, 3)
        .map((x) => x.t);
    }
    return {
      id: lbl,
      objectIds: ids,
      bbox,
      centerX: center.x + center.w / 2,
      centerY: center.y + center.h / 2,
      topTokens,
    };
  });
}
