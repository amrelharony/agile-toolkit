/**
 * Parking Lot's AI task, the browser-safe half: where each open parked point
 * could go (the backlog, an impediment, a retro action, or dropped), with a
 * short reason. The person accepts each suggestion; an accepted one goes
 * through the hand-off routes (or the drop), with Undo. Nothing is sent by
 * the AI itself.
 *
 * Without AI the keyword rules answer (lib/parking-lot/route-rules), so the
 * review works the same with AI off. The prompt is in `parking-lot.server.ts`.
 */

import { z } from "zod";
import { defineAiTask } from "../define-task";
import { PARKING_DESTINATIONS } from "@/lib/parking-lot/model";
import { ROUTE_REASON_MAX, routeByRules } from "@/lib/parking-lot/route-rules";

/** At most this many points per ask: a meeting's parking lot, not a backlog. */
export const PARKING_ROUTE_MAX_ITEMS = 30;
/** A point's words as sent: the first 500 characters say where it belongs. */
export const PARKING_ROUTE_TEXT_MAX = 500;
/**
 * Ids are the items' own ("parking_x1y2z3w4"). A stored id can be longer (an
 * agent may choose one), so the page leaves such a point out of the ask.
 */
export const PARKING_ROUTE_ID_MAX = 64;
const ID_MAX = PARKING_ROUTE_ID_MAX;

const input = z.object({
  items: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(ID_MAX),
        text: z.string().trim().min(1).max(PARKING_ROUTE_TEXT_MAX),
        meeting: z.string().trim().max(200).optional(),
      })
    )
    .min(1)
    .max(PARKING_ROUTE_MAX_ITEMS),
});

const output = z.object({
  routes: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(ID_MAX),
        destination: z.enum(PARKING_DESTINATIONS),
        reason: z.string().trim().min(1).max(ROUTE_REASON_MAX),
      })
    )
    .max(PARKING_ROUTE_MAX_ITEMS),
});

export type ParkingRouteInput = z.infer<typeof input>;
export type ParkingRouteSuggestion = z.infer<typeof output>["routes"][number];

/** The suggestions without AI: the keyword rules, one per point, in the points' order. */
export function fallbackRoutes(items: ParkingRouteInput["items"]): ParkingRouteSuggestion[] {
  return items.map((item) => ({ id: item.id, ...routeByRules(item.text) }));
}

export const parkingRouteTask = defineAiTask({
  id: "parking-lot.route",
  toolId: "parking-lot",
  tier: "flash",
  effort: "low",
  maxTokens: 4096,
  input,
  output,
  fallback: ({ items }) => ({ routes: fallbackRoutes(items) }),
  sample: {
    items: [
      {
        id: "parking_a1",
        text: "We can't deploy until the platform team approves the firewall change",
        meeting: "Daily Scrum",
      },
      { id: "parking_a2", text: "Add CSV export to the monthly report", meeting: "Daily Scrum" },
      { id: "parking_a3", text: "Our standups run long when we solve problems in them" },
    ],
  },
});
