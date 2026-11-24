/**
 * Parking Lot's AI task, the lite half pages import (no zod; the def, with
 * its schemas, is `parking-lot.ts` and loads on first AI use).
 */

import { lazyAiTask } from "../task-ref";
import { routeByRules } from "@/lib/parking-lot/route-rules";
import type { ParkingRouteInput, ParkingRouteOutput, ParkingRouteSuggestion } from "./parking-lot";
export type { ParkingRouteInput, ParkingRouteOutput, ParkingRouteSuggestion } from "./parking-lot";

/** At most this many points per ask: a meeting's parking lot, not a backlog. */
export const PARKING_ROUTE_MAX_ITEMS = 30;
/** A point's words as sent: the first 500 characters say where it belongs. */
export const PARKING_ROUTE_TEXT_MAX = 500;
/**
 * Ids are the items' own ("parking_x1y2z3w4"). A stored id can be longer (an
 * agent may choose one), so the page leaves such a point out of the ask.
 */
export const PARKING_ROUTE_ID_MAX = 64;

/** The suggestions without AI: the keyword rules, one per point, in the points' order. */
export function fallbackRoutes(items: ParkingRouteInput["items"]): ParkingRouteSuggestion[] {
  return items.map((item) => ({ id: item.id, ...routeByRules(item.text) }));
}

/** The task's answer without AI. */
export const parkingRouteFallback = ({ items }: ParkingRouteInput): ParkingRouteOutput => ({
  routes: fallbackRoutes(items),
});

export const parkingRouteTask = lazyAiTask<ParkingRouteInput, ParkingRouteOutput>(
  { id: "parking-lot.route", toolId: "parking-lot", fallback: parkingRouteFallback },
  () => import("./parking-lot").then((m) => m.parkingRouteTask)
);
