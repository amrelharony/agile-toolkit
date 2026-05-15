/**
 * Connector-anchor utilities.
 *
 * A connector's `fromAnchor` / `toAnchor` is the side of the source/target
 * rectangle from which the line emanates: "top" / "right" / "bottom" /
 * "left" / "auto". `auto` means "pick the side facing the other endpoint."
 */

import type { Rect, Vec2 } from "./bbox";
import { rectCenter } from "./bbox";
import type { ConnectorAnchor } from "@/lib/stores/workspace-types";

export interface AnchorPoint {
  /** Side the anchor sits on. Resolved from "auto" by {@link autoAnchor}. */
  side: Exclude<ConnectorAnchor, "auto">;
  point: Vec2;
}

/** Midpoint of a given side. */
export function anchorMidpoint(r: Rect, side: Exclude<ConnectorAnchor, "auto">): Vec2 {
  switch (side) {
    case "top":    return { x: r.x + r.w / 2, y: r.y };
    case "right":  return { x: r.x + r.w,     y: r.y + r.h / 2 };
    case "bottom": return { x: r.x + r.w / 2, y: r.y + r.h };
    case "left":   return { x: r.x,           y: r.y + r.h / 2 };
  }
}

/**
 * Pick the side of `from` whose midpoint is closest to `toCenter` (or
 * `to` rect center if a rect is supplied). Used when the user leaves the
 * anchor as "auto" so connectors re-route as endpoints move around.
 */
export function autoAnchor(from: Rect, to: Rect | Vec2): Exclude<ConnectorAnchor, "auto"> {
  const target = "w" in to ? rectCenter(to) : to;
  const sides: Exclude<ConnectorAnchor, "auto">[] = ["top", "right", "bottom", "left"];
  let best: Exclude<ConnectorAnchor, "auto"> = "right";
  let bestDist = Number.POSITIVE_INFINITY;
  for (const side of sides) {
    const m = anchorMidpoint(from, side);
    const dx = target.x - m.x;
    const dy = target.y - m.y;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = side;
    }
  }
  return best;
}

/** Resolve `auto` into a concrete side for both endpoints in one call. */
export function resolveAnchors(
  fromRect: Rect,
  toRect: Rect,
  fromAnchor: ConnectorAnchor = "auto",
  toAnchor: ConnectorAnchor = "auto",
): { from: AnchorPoint; to: AnchorPoint } {
  const fromSide = fromAnchor === "auto" ? autoAnchor(fromRect, toRect) : fromAnchor;
  const toSide = toAnchor === "auto" ? autoAnchor(toRect, fromRect) : toAnchor;
  return {
    from: { side: fromSide, point: anchorMidpoint(fromRect, fromSide) },
    to: { side: toSide, point: anchorMidpoint(toRect, toSide) },
  };
}

/** Outward normal vector from an anchor side — used to inset path endpoints. */
export function anchorNormal(side: Exclude<ConnectorAnchor, "auto">): Vec2 {
  switch (side) {
    case "top":    return { x: 0, y: -1 };
    case "right":  return { x: 1, y: 0 };
    case "bottom": return { x: 0, y: 1 };
    case "left":   return { x: -1, y: 0 };
  }
}
