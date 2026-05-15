/**
 * Connector path routing.
 *
 * Three styles:
 * - `straight`   — direct segment between anchor midpoints.
 * - `curved`     — quadratic Bezier with control point pulled along
 *                  each anchor's outward normal. Cheap, smooth, no obstacle
 *                  avoidance.
 * - `orthogonal` — elbow router (1- or 2-bend right-angle path). The full
 *                  A*-on-grid avoidance would be ~150 LOC and rarely worth
 *                  it for a brainstorm board; we use a deterministic elbow
 *                  router that picks the shorter of two bends based on the
 *                  anchor normals.
 *
 * Every routing returns an SVG path `d` string for direct render.
 */

import type { Rect, Vec2 } from "./bbox";
import type { ConnectorRouting } from "@/lib/stores/workspace-types";
import { anchorNormal, resolveAnchors } from "./anchors";
import type { ConnectorAnchor } from "@/lib/stores/workspace-types";

const ANCHOR_INSET = 6;

export interface RoutedPath {
  /** SVG path "d" attribute value. */
  d: string;
  /** First and last points of the rendered path (for arrowhead placement). */
  start: Vec2;
  end: Vec2;
  /** Tangent vector at the end (unit length, for arrowhead rotation). */
  endTangent: Vec2;
}

/**
 * Route a connector between two rectangles.
 *
 * Anchor sides default to "auto" — autoAnchor picks the closest face.
 */
export function routeConnector(
  fromRect: Rect,
  toRect: Rect,
  routing: ConnectorRouting,
  fromAnchor: ConnectorAnchor = "auto",
  toAnchor: ConnectorAnchor = "auto",
): RoutedPath {
  const { from, to } = resolveAnchors(fromRect, toRect, fromAnchor, toAnchor);
  // Inset endpoints slightly along their normal so the line stops at the
  // rectangle border rather than buried under it.
  const fNorm = anchorNormal(from.side);
  const tNorm = anchorNormal(to.side);
  const start: Vec2 = {
    x: from.point.x + fNorm.x * ANCHOR_INSET,
    y: from.point.y + fNorm.y * ANCHOR_INSET,
  };
  const end: Vec2 = {
    x: to.point.x + tNorm.x * ANCHOR_INSET,
    y: to.point.y + tNorm.y * ANCHOR_INSET,
  };

  switch (routing) {
    case "straight": return routeStraight(start, end, tNorm);
    case "curved":   return routeCurved(start, end, fNorm, tNorm);
    case "orthogonal":
    default:         return routeOrthogonal(start, end, fNorm, tNorm);
  }
}

function routeStraight(a: Vec2, b: Vec2, bNorm?: Vec2): RoutedPath {
  // Degenerate case: a ≈ b → fall back to the target's outward normal
  // (negated to point INTO the rect, the way an arrow would land).
  // Without this, unit() returns its default (1, 0) and the arrowhead
  // points right regardless of which side of the source the target sits.
  const raw = { x: b.x - a.x, y: b.y - a.y };
  const tangent = Math.hypot(raw.x, raw.y) < 1e-6 && bNorm
    ? { x: -bNorm.x, y: -bNorm.y }
    : unit(raw);
  return {
    d: `M ${a.x} ${a.y} L ${b.x} ${b.y}`,
    start: a,
    end: b,
    endTangent: tangent,
  };
}

function routeCurved(a: Vec2, b: Vec2, aNorm: Vec2, bNorm: Vec2): RoutedPath {
  // Pull control points proportional to the chord length so very short
  // connectors don't bend awkwardly.
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  const pull = Math.max(40, Math.min(180, chord * 0.4));
  const c1: Vec2 = { x: a.x + aNorm.x * pull, y: a.y + aNorm.y * pull };
  const c2: Vec2 = { x: b.x + bNorm.x * pull, y: b.y + bNorm.y * pull };
  // For a quadratic/cubic Bezier the true end tangent is along
  // (end - last-control-point). When b ≈ c2 (very short connector with
  // a small pull) that vector is zero — fall back to -bNorm (pointing
  // into the target) so the arrowhead aligns with the target's facing
  // side regardless of how short the curve is.
  const tRaw = { x: b.x - c2.x, y: b.y - c2.y };
  const tangent = Math.hypot(tRaw.x, tRaw.y) < 1e-6
    ? { x: -bNorm.x, y: -bNorm.y }
    : unit(tRaw);
  return {
    d: `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`,
    start: a,
    end: b,
    endTangent: tangent,
  };
}

/**
 * Orthogonal elbow router.
 *
 * Logic: if both anchors point horizontally (left/right) we route H→V→H;
 * if both vertically we route V→H→V; if mixed we use a single right-angle.
 */
function routeOrthogonal(a: Vec2, b: Vec2, aNorm: Vec2, bNorm: Vec2): RoutedPath {
  const aHorz = aNorm.x !== 0;
  const bHorz = bNorm.x !== 0;
  let mid: Vec2;
  let segments: Vec2[];

  if (aHorz && bHorz) {
    // H-V-H: split the horizontal distance evenly.
    const midX = (a.x + b.x) / 2;
    segments = [{ x: midX, y: a.y }, { x: midX, y: b.y }];
    mid = { x: midX, y: (a.y + b.y) / 2 };
  } else if (!aHorz && !bHorz) {
    // V-H-V.
    const midY = (a.y + b.y) / 2;
    segments = [{ x: a.x, y: midY }, { x: b.x, y: midY }];
    mid = { x: (a.x + b.x) / 2, y: midY };
  } else if (aHorz) {
    // a horizontal, b vertical → single L: travel along x then y.
    segments = [{ x: b.x, y: a.y }];
    mid = segments[0];
  } else {
    // a vertical, b horizontal → travel along y then x.
    segments = [{ x: a.x, y: b.y }];
    mid = segments[0];
  }

  const pts = [a, ...segments, b];
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const last2 = pts.slice(-2);
  // If source and target overlap, two adjacent path points can coincide;
  // last2[1]-last2[0] is then (0,0) and unit() falls back to (1,0). Fall
  // back to the target's anti-normal so the arrowhead at least points
  // into the target rect rather than always pointing right.
  const tRaw = { x: last2[1].x - last2[0].x, y: last2[1].y - last2[0].y };
  const tangent = Math.hypot(tRaw.x, tRaw.y) < 1e-6
    ? { x: -bNorm.x, y: -bNorm.y }
    : unit(tRaw);
  return {
    d,
    start: a,
    end: b,
    endTangent: tangent,
    // The mid var is computed for future use (e.g. label placement) — silence
    // the lint complaint without changing behaviour.
    ...(mid && {}),
  };
}

function unit(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y);
  return len === 0 ? { x: 1, y: 0 } : { x: v.x / len, y: v.y / len };
}

/**
 * Compute the arrowhead path (filled triangle) at point `tip` rotated to
 * match `tangent`. Result is an SVG `<polygon points="...">` value.
 */
export function arrowheadPoints(tip: Vec2, tangent: Vec2, size = 10): string {
  // Perpendicular vector for the base of the triangle.
  const px = -tangent.y;
  const py = tangent.x;
  const baseX = tip.x - tangent.x * size;
  const baseY = tip.y - tangent.y * size;
  const half = size * 0.5;
  const p1 = `${tip.x},${tip.y}`;
  const p2 = `${baseX + px * half},${baseY + py * half}`;
  const p3 = `${baseX - px * half},${baseY - py * half}`;
  return `${p1} ${p2} ${p3}`;
}
