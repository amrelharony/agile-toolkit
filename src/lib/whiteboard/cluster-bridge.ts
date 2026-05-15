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

export interface ClusterResult {
  /** Zero-based cluster index. */
  id: number;
  objectIds: string[];
  /** Bounding rect of all member objects, padded by 32px. */
  bbox: Rect;
  /** Geometric center — useful for placing a cluster label. */
  centerX: number;
  centerY: number;
}

export interface ClusterOptions {
  /** Object types to consider. Default: only "sticky". */
  kinds?: WhiteboardObjectKind[];
  /** Number of clusters. If omitted we pick √n / 2, clamped to [2, 6]. */
  k?: number;
}

export function clusterObjects(
  objects: readonly WhiteboardObject[],
  opts: ClusterOptions = {},
): ClusterResult[] {
  const kinds = opts.kinds ?? ["sticky"];
  const subset = objects.filter((o) => kinds.includes(o.type));
  if (subset.length < 4) return []; // Not enough signal to cluster meaningfully.

  const k = opts.k ?? Math.max(2, Math.min(6, Math.round(Math.sqrt(subset.length) / 2)));
  const points: number[][] = subset.map((o) => [o.x + o.w / 2, o.y + o.h / 2]);
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
    return {
      id: lbl,
      objectIds: ids,
      bbox,
      centerX: center.x + center.w / 2,
      centerY: center.y + center.h / 2,
    };
  });
}
