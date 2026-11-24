/**
 * Kickoff's AI task, the def: draft lines for a kickoff's sections from its
 * title and a short brief (plus the Product Goal and the vision), and for
 * an Inception deck or Trade-off sliders a few more trade-offs that could
 * give way. The person accepts one, all or none of them; nothing is written
 * on its own. The caps, the input builder and the fallback live in
 * `kickoff.lite.ts`, which pages import. The prompt lives in
 * `kickoff.server.ts`.
 */

import { z } from "zod";
import { defineAiTask } from "../define-task";
import { KICKOFF_FORMATS } from "@/lib/stores/workspace-types";
import {
  KICKOFF_DRAFT_BRIEF_MAX,
  KICKOFF_DRAFT_EXISTING_LINE_MAX,
  KICKOFF_DRAFT_EXISTING_MAX,
  KICKOFF_DRAFT_GOAL_MAX,
  KICKOFF_DRAFT_ITEMS_MAX,
  KICKOFF_DRAFT_LINE_OUT_MAX,
  KICKOFF_DRAFT_SECTION_MAX,
  KICKOFF_DRAFT_SLIDERS_IN_MAX,
  KICKOFF_DRAFT_SLIDERS_OUT_MAX,
  KICKOFF_DRAFT_SLIDER_MAX,
  KICKOFF_DRAFT_TITLE_MAX,
  KICKOFF_DRAFT_VISION_MAX,
  kickoffDraftFallback,
} from "./kickoff.lite";

export {
  KICKOFF_DRAFT_EXISTING_MAX,
  KICKOFF_DRAFT_ITEMS_MAX,
  KICKOFF_DRAFT_SLIDERS_OUT_MAX,
  firstSentence,
  kickoffDraftFallback,
  kickoffDraftInputFor,
} from "./kickoff.lite";

const input = z.object({
  format: z.enum(KICKOFF_FORMATS),
  title: z.string().trim().min(1).max(KICKOFF_DRAFT_TITLE_MAX),
  /** May be empty: the draft then starts from the format's own lines. */
  brief: z.string().trim().max(KICKOFF_DRAFT_BRIEF_MAX),
  goal: z.string().trim().max(KICKOFF_DRAFT_GOAL_MAX).optional(),
  vision: z.string().trim().max(KICKOFF_DRAFT_VISION_MAX).optional(),
  /** What the kickoff already holds, so the draft doesn't repeat it. */
  existing: z
    .array(z.string().trim().min(1).max(KICKOFF_DRAFT_EXISTING_LINE_MAX))
    .max(KICKOFF_DRAFT_EXISTING_MAX),
  /** The trade-offs already on the list (Inception and Trade-offs). */
  sliders: z
    .array(z.string().trim().min(1).max(KICKOFF_DRAFT_SLIDER_MAX))
    .max(KICKOFF_DRAFT_SLIDERS_IN_MAX)
    .optional(),
});

const output = z.object({
  items: z
    .array(
      z.object({
        section: z.string().trim().min(1).max(KICKOFF_DRAFT_SECTION_MAX),
        text: z.string().trim().min(1).max(KICKOFF_DRAFT_LINE_OUT_MAX),
      })
    )
    .max(KICKOFF_DRAFT_ITEMS_MAX),
  sliders: z
    .array(z.string().trim().min(1).max(KICKOFF_DRAFT_SLIDER_MAX))
    .max(KICKOFF_DRAFT_SLIDERS_OUT_MAX)
    .optional(),
});

export type KickoffDraftInput = z.infer<typeof input>;
export type KickoffDraftOutput = z.infer<typeof output>;

export const kickoffDraftTask = defineAiTask({
  id: "kickoff.draft",
  toolId: "kickoff",
  tier: "full",
  effort: "low",
  maxTokens: 6144,
  input,
  output,
  fallback: kickoffDraftFallback,
  sample: {
    format: "inception",
    title: "Tap to pay on phones",
    brief:
      "Let shop owners take card payments by tapping the buyer's card on their own phone. Most of our sellers still carry a separate card machine.",
    goal: "Small shop owners take every payment on their phone, with no card machine.",
    existing: [],
    sliders: ["Scope", "Date", "Cost", "Quality"],
  },
});
