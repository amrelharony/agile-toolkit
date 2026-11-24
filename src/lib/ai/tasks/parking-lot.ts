/**
 * Parking Lot's AI task, the def: where each open parked point could go
 * (the backlog, an impediment, a retro action, or dropped), with a short
 * reason. The person accepts each suggestion; an accepted one goes through
 * the hand-off routes (or the drop), with Undo. Nothing is sent by the AI
 * itself.
 *
 * Without AI the keyword rules answer (lib/parking-lot/route-rules), so the
 * review works the same with AI off. That fallback and the caps live in
 * `parking-lot.lite.ts`, which pages import. The prompt is in
 * `parking-lot.server.ts`.
 */

import { z } from "zod";
import { defineAiTask } from "../define-task";
import { PARKING_DESTINATIONS } from "@/lib/parking-lot/model";
import { ROUTE_REASON_MAX } from "@/lib/parking-lot/route-rules";
import {
  PARKING_ROUTE_ID_MAX,
  PARKING_ROUTE_MAX_ITEMS,
  PARKING_ROUTE_TEXT_MAX,
  parkingRouteFallback,
} from "./parking-lot.lite";

export {
  PARKING_ROUTE_ID_MAX,
  PARKING_ROUTE_MAX_ITEMS,
  PARKING_ROUTE_TEXT_MAX,
  fallbackRoutes,
  parkingRouteFallback,
} from "./parking-lot.lite";

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
export type ParkingRouteOutput = z.infer<typeof output>;
export type ParkingRouteSuggestion = ParkingRouteOutput["routes"][number];

export const parkingRouteTask = defineAiTask({
  id: "parking-lot.route",
  toolId: "parking-lot",
  tier: "flash",
  effort: "low",
  maxTokens: 4096,
  input,
  output,
  fallback: parkingRouteFallback,
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
