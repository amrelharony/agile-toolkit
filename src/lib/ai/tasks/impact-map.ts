/**
 * Impact Map's AI task, the def: draft the actors, their impacts and a few
 * deliverables under a goal. The person accepts a branch at a time, or all
 * of them, into the map, with Undo; nothing is saved before. The fallback
 * and the caps live in `impact-map.lite.ts`, which the page imports. The
 * prompt lives in `impact-map.server.ts`.
 */

import { z } from "zod";
import { defineAiTask } from "../define-task";
import {
  IMPACT_DRAFT_ACTORS_MAX,
  IMPACT_DRAFT_ACTOR_MAX,
  IMPACT_DRAFT_CONTEXT_MAX,
  IMPACT_DRAFT_DELIVERABLES_MAX,
  IMPACT_DRAFT_EXISTING_MAX,
  IMPACT_DRAFT_IMPACTS_MAX,
  IMPACT_DRAFT_PERSONAS_MAX,
  IMPACT_DRAFT_TEXT_MAX,
  fallbackImpactMap,
} from "./impact-map.lite";

export {
  GENERIC_ACTORS,
  IMPACT_DRAFT_ACTORS_MAX,
  IMPACT_DRAFT_DELIVERABLES_MAX,
  IMPACT_DRAFT_IMPACTS_MAX,
  fallbackImpactMap,
} from "./impact-map.lite";

const text = (max: number) => z.string().trim().max(max);
const filled = (max: number) => z.string().trim().min(1).max(max);

const input = z.object({
  /** The goal (the map's root). */
  goal: filled(IMPACT_DRAFT_TEXT_MAX),
  /** The goal's measure. */
  measure: text(IMPACT_DRAFT_TEXT_MAX).optional(),
  /** The linked Product Goal's why, and what the person adds ("Anything Amr should know"). */
  context: text(IMPACT_DRAFT_CONTEXT_MAX),
  /** The library's main and secondary personas: the only names a draft may use. */
  personas: z
    .array(z.object({ name: filled(IMPACT_DRAFT_TEXT_MAX), role: text(IMPACT_DRAFT_TEXT_MAX) }))
    .max(IMPACT_DRAFT_PERSONAS_MAX),
  /** The actors already on the map, so a draft doesn't repeat them. */
  actors: z.array(filled(IMPACT_DRAFT_TEXT_MAX)).max(IMPACT_DRAFT_EXISTING_MAX),
});

const output = z.object({
  actors: z
    .array(
      z.object({
        name: filled(IMPACT_DRAFT_ACTOR_MAX),
        /** A persona's name, exactly as given, when the actor is one. */
        persona: text(IMPACT_DRAFT_TEXT_MAX).optional(),
        impacts: z
          .array(
            z.object({
              text: filled(IMPACT_DRAFT_TEXT_MAX),
              deliverables: z
                .array(filled(IMPACT_DRAFT_TEXT_MAX))
                .max(IMPACT_DRAFT_DELIVERABLES_MAX),
            })
          )
          .min(1)
          .max(IMPACT_DRAFT_IMPACTS_MAX),
      })
    )
    .min(1)
    .max(IMPACT_DRAFT_ACTORS_MAX),
});

export type ImpactDraftInput = z.infer<typeof input>;
export type ImpactDraftOutput = z.infer<typeof output>;
export type DraftedActor = ImpactDraftOutput["actors"][number];

export const impactMapDraftTask = defineAiTask({
  id: "impact-map.draft",
  toolId: "impact-map",
  tier: "full",
  effort: "high",
  maxTokens: 8192,
  input,
  output,
  fallback: fallbackImpactMap,
  sample: {
    goal: "Grow repeat orders by 20% by June",
    measure: "Share of customers who order again within 30 days",
    context: "Most customers try one box and never come back.",
    personas: [{ name: "Busy parent", role: "Cooks for a family of four on weeknights" }],
    actors: [],
  },
});
