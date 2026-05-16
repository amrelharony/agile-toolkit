/**
 * Anti-pattern rules specifically for whiteboard boards.
 *
 * Each rule reads the current board state and returns 0+ `Insight`s that
 * flag the board's hygiene. The insights surface in the AI panel and
 * the standard InsightsEngine.
 */

import type { WhiteboardObject } from "@/lib/stores/workspace-types";

export type BoardInsightKind =
  | "abandoned"
  | "outlier-size"
  | "disconnected"
  | "color-scrambled"
  | "overcrowded"
  // Phase 28 additions:
  | "card-disconnected"   // card with sourceRef.tool === "backlog" whose Story no longer exists
  | "tag-mismatch"        // tags on canvas objects that don't appear in any workspace entity
  | "abandoned-cluster"   // cluster with no edits + no connectors for 14d
  | "missing-frame-label"; // unlabelled frame (empty or whitespace-only label)

export interface BoardInsight {
  id: string;
  kind: BoardInsightKind;
  severity: "info" | "warn" | "critical";
  title: string;
  detail: string;
  /** Object IDs the insight points to. */
  targets: string[];
}

const ABANDONED_DAYS = 7;
const OUTLIER_SIZE_MULT = 3.5;
const DISCONNECT_THRESHOLD = 20;
const OVERCROWDED_DENSITY = 0.5; // ratio of object area / bbox area
const COLOR_SCRAMBLE_NEIGHBOR_RADIUS = 220;

export function boardInsights(objects: readonly WhiteboardObject[]): BoardInsight[] {
  if (objects.length === 0) return [];
  const out: BoardInsight[] = [];

  // --- Abandoned drafts: object older than N days, no updates since ---
  const cutoff = Date.now() - ABANDONED_DAYS * 24 * 60 * 60 * 1000;
  const abandoned = objects.filter(
    (o) =>
      o.createdAt &&
      new Date(o.createdAt).getTime() < cutoff &&
      o.updatedAt &&
      new Date(o.updatedAt).getTime() < cutoff &&
      (o.type === "sticky" || o.type === "freehand"),
  );
  if (abandoned.length >= 3) {
    out.push({
      id: "abandoned-drafts",
      kind: "abandoned",
      severity: abandoned.length >= 10 ? "warn" : "info",
      title: `${abandoned.length} stale objects (>${ABANDONED_DAYS}d untouched)`,
      detail: "Consider archiving or reviewing — they may no longer reflect current thinking.",
      targets: abandoned.map((o) => o.id),
    });
  }

  // --- Outlier sizes: object area >> median ---
  const areas = objects.map((o) => o.w * o.h).sort((a, b) => a - b);
  if (areas.length >= 5) {
    const median = areas[Math.floor(areas.length / 2)];
    // Guard the degenerate median=0 case (every object is a zero-area
    // placeholder e.g. degenerate freehand). Without this guard, any
    // non-zero object trips `area > 0 * mult = 0` and the rule flags
    // every visible object as an outlier.
    const outliers = median > 0
      ? objects.filter((o) => o.w * o.h > median * OUTLIER_SIZE_MULT)
      : [];
    if (outliers.length > 0) {
      out.push({
        id: "outlier-size",
        kind: "outlier-size",
        severity: "info",
        title: `${outliers.length} oversized object${outliers.length === 1 ? "" : "s"}`,
        detail: "These objects are >3× the median size — consider resizing for visual balance.",
        targets: outliers.map((o) => o.id),
      });
    }
  }

  // --- Disconnected: many objects, no connectors at all ---
  const connectors = objects.filter((o) => o.type === "connector");
  if (objects.length >= DISCONNECT_THRESHOLD && connectors.length === 0) {
    out.push({
      id: "disconnected",
      kind: "disconnected",
      severity: "info",
      title: `${objects.length} objects with no connectors`,
      detail: "Boards with many objects benefit from connectors or frames to show relationships.",
      targets: [],
    });
  }

  // --- Color-coded clusters spatially scrambled ---
  // If stickies of the same color are spread far apart while different
  // colors sit near each other, suggest re-grouping.
  const stickies = objects.filter((o): o is Extract<WhiteboardObject, { type: "sticky" }> => o.type === "sticky");
  if (stickies.length >= 10) {
    let scrambled = 0;
    for (const s of stickies) {
      const sameColorNearby = stickies.filter(
        (o) => o.id !== s.id && o.color === s.color &&
          Math.hypot(o.x - s.x, o.y - s.y) < COLOR_SCRAMBLE_NEIGHBOR_RADIUS,
      ).length;
      const diffColorNearby = stickies.filter(
        (o) => o.id !== s.id && o.color !== s.color &&
          Math.hypot(o.x - s.x, o.y - s.y) < COLOR_SCRAMBLE_NEIGHBOR_RADIUS,
      ).length;
      if (diffColorNearby > sameColorNearby * 2 && diffColorNearby >= 3) scrambled++;
    }
    if (scrambled >= 5) {
      out.push({
        id: "color-scrambled",
        kind: "color-scrambled",
        severity: "info",
        title: "Color groups appear spatially scrambled",
        detail: "Same-colored stickies are scattered far apart. Consider grouping by color.",
        targets: [],
      });
    }
  }

  // --- Overcrowded: high density of objects in a small bbox ---
  if (objects.length >= 25) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let totalArea = 0;
    for (const o of objects) {
      if (o.x < minX) minX = o.x;
      if (o.y < minY) minY = o.y;
      if (o.x + o.w > maxX) maxX = o.x + o.w;
      if (o.y + o.h > maxY) maxY = o.y + o.h;
      totalArea += o.w * o.h;
    }
    const bboxArea = (maxX - minX) * (maxY - minY);
    if (bboxArea > 0 && totalArea / bboxArea > OVERCROWDED_DENSITY) {
      out.push({
        id: "overcrowded",
        kind: "overcrowded",
        severity: "warn",
        title: "Board is visually overcrowded",
        detail: "Objects occupy >50% of the bounding rectangle. Consider spreading them out or using frames.",
        targets: [],
      });
    }
  }

  // --- Phase 28 rule: cards whose linked Story no longer exists ---
  // We can't check Story existence from here without the workspace —
  // exposed via a second exported helper below (`boardInsightsCross`).

  // --- Phase 28 rule: missing frame label ---
  for (const o of objects) {
    if (o.type === "frame" && (!o.label || /^\s*$/.test(o.label))) {
      out.push({
        id: `missing-frame-label-${o.id}`,
        kind: "missing-frame-label",
        severity: "info",
        title: "Unlabelled frame",
        detail: "A frame without a label is harder to navigate by Cmd+F or presentation mode.",
        targets: [o.id],
      });
    }
  }

  return out;
}

/**
 * Cross-tool insights — rules that need access to other workspace
 * entities (Stories, Risks, OKRs, team members). Surfaced alongside
 * `boardInsights` in the AI panel; caller passes both sets through
 * the same renderer.
 */
export function boardInsightsCross(
  objects: readonly WhiteboardObject[],
  workspace?: { stories?: readonly { id: string; tags?: string[] }[]; risks?: readonly { id: string; tags?: string[] }[]; teamMembers?: readonly { id: string }[] } | null,
): BoardInsight[] {
  if (!workspace) return [];
  const out: BoardInsight[] = [];

  // --- Card-disconnected: a card with sourceRef.tool === "backlog"
  // whose Story has been deleted from the workspace. ---
  const storyIds = new Set((workspace.stories ?? []).map((s) => s.id));
  for (const o of objects) {
    if (o.type === "card" && o.sourceRef?.tool === "backlog" && !storyIds.has(o.sourceRef.entityId)) {
      out.push({
        id: `card-disconnected-${o.id}`,
        kind: "card-disconnected",
        severity: "warn",
        title: "Card linked to a deleted story",
        detail: `This card references story ${o.sourceRef.entityId} which no longer exists. Convert it to a free card or relink to a current story.`,
        targets: [o.id],
      });
    }
  }

  // --- Tag-mismatch: tags on canvas objects that don't appear in any
  // workspace entity (story/risk). Surfaces typos + drift. ---
  const knownTags = new Set<string>();
  for (const s of workspace.stories ?? []) for (const t of s.tags ?? []) knownTags.add(t);
  for (const r of workspace.risks ?? []) for (const t of r.tags ?? []) knownTags.add(t);
  const orphanTagTargets: string[] = [];
  for (const o of objects) {
    if (!o.tags || o.tags.length === 0) continue;
    for (const t of o.tags) {
      if (!knownTags.has(t)) { orphanTagTargets.push(o.id); break; }
    }
  }
  if (orphanTagTargets.length > 0 && knownTags.size > 0) {
    out.push({
      id: "tag-mismatch",
      kind: "tag-mismatch",
      severity: "info",
      title: "Canvas tags don't match workspace tags",
      detail: `${orphanTagTargets.length} object${orphanTagTargets.length === 1 ? "" : "s"} use tags that don't appear in any story/risk. Likely a typo or stale tag.`,
      targets: orphanTagTargets,
    });
  }

  return out;
}
