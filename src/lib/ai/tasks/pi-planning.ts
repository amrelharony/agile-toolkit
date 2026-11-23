/**
 * PI Planning's AI task, the def: read the board's risks still to sort and
 * suggest each one's ROAM status (owned, accepted or mitigated; never
 * resolved, which only the room can say), with a reason and a next
 * action. The person accepts each suggestion, with Undo. Without AI,
 * keyword rules answer (lib/pi-planning/roam `guessRoam`, through
 * `pi-planning.lite.ts`, which pages import). The prompt lives in
 * `pi-planning.server.ts`.
 *
 * Risks travel with short ids (r1…r40) that the page maps back, and
 * `fitRoamInput` trims what the page sends to fit the visitor route's
 * body cap.
 */

import { z } from "zod";
import { defineAiTask } from "../define-task";
import {
  ROAM_ACTION_MAX,
  ROAM_ID_MAX,
  ROAM_NOTE_MAX,
  ROAM_REASON_MAX,
  ROAM_RISKS_MAX,
  ROAM_SUGGESTED,
  ROAM_TASK_ID,
  ROAM_TEAM_MAX,
  ROAM_TITLE_MAX,
  roamFallback,
} from "./pi-planning.lite";

export {
  ROAM_ACTION_MAX,
  ROAM_ID_MAX,
  ROAM_NOTE_MAX,
  ROAM_REASON_MAX,
  ROAM_RISKS_MAX,
  ROAM_SUGGESTED,
  ROAM_TASK_ID,
  ROAM_TEAM_MAX,
  ROAM_TITLE_MAX,
  fitRoamInput,
  roamAskFor,
  roamAskId,
  roamFallback,
  roamItemId,
} from "./pi-planning.lite";

const input = z.object({
  risks: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(ROAM_ID_MAX),
        title: z.string().trim().min(1).max(ROAM_TITLE_MAX),
        team: z.string().trim().max(ROAM_TEAM_MAX),
        note: z.string().trim().max(ROAM_NOTE_MAX).optional(),
      })
    )
    .min(1)
    .max(ROAM_RISKS_MAX),
});

const output = z.object({
  risks: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(ROAM_ID_MAX),
        roam: z.enum(ROAM_SUGGESTED),
        reason: z.string().trim().min(1).max(ROAM_REASON_MAX),
        action: z.string().trim().min(1).max(ROAM_ACTION_MAX),
      })
    )
    .max(ROAM_RISKS_MAX),
});

export type RoamInput = z.infer<typeof input>;
export type RoamOutput = z.infer<typeof output>;

export const roamTask = defineAiTask({
  id: ROAM_TASK_ID,
  toolId: "pi-planning",
  tier: "flash",
  effort: "low",
  // 40 answers of up to 300 characters each, with their keys.
  maxTokens: 8192,
  input,
  output,
  fallback: roamFallback,
  sample: {
    risks: [
      { id: "r1", title: "PCI audit could slip the release", team: "Checkout" },
      {
        id: "r2",
        title: "The new card provider needs legal sign-off on its contract",
        team: "Payments",
      },
      {
        id: "r3",
        title: "App store review could hold up the push release",
        team: "Mobile",
        note: "We'll submit a week early and keep the web fallback on.",
      },
    ],
  },
});
