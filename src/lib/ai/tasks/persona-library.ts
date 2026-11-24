/**
 * Persona Library's AI task, the def: draft one persona (a made-up name,
 * a role, goals, frustrations, habits, a paraphrased quote, context and
 * tags) from research notes or interviews. The page takes contact details
 * out first (redactPii, and "Participant N" for interviews), puts the
 * draft in the add form, and nothing is saved until the person edits it
 * and presses Save. The output's caps are tighter than the CRUD's, so any
 * answer fits the form.
 *
 * At its caps the input is about 36 KB in 3-byte text, under
 * TOOL_AI_BODY_BUDGET, so it needs no fitter. Without AI the keyword rules
 * answer (`personaFromNotesFallback`, in `persona-library.lite.ts`, which
 * pages import). The prompt is in `persona-library.server.ts`.
 */

import { z } from "zod";
import { defineAiTask } from "../define-task";
import { PERSONA_TIERS } from "@/lib/stores/workspace-types";
import {
  DRAFT_CONTEXT_MAX,
  DRAFT_NAME_MAX,
  DRAFT_POINTS_MAX,
  DRAFT_POINT_MAX,
  DRAFT_QUOTE_MAX,
  DRAFT_ROLE_MAX,
  DRAFT_SUMMARY_MAX,
  DRAFT_TAGS_MAX,
  DRAFT_TAG_MAX,
  PERSONA_NAMES_MAX,
  PERSONA_NAME_ITEM_MAX,
  PERSONA_NOTES_MAX,
  PERSONA_NOTES_MIN,
  personaFromNotesFallback,
} from "./persona-library.lite";

export {
  PERSONA_NAMES_MAX,
  PERSONA_NAME_ITEM_MAX,
  PERSONA_NOTES_MAX,
  PERSONA_NOTES_MIN,
  personaFromNotesFallback,
} from "./persona-library.lite";

const input = z.object({
  notes: z.string().trim().min(PERSONA_NOTES_MIN).max(PERSONA_NOTES_MAX),
  tier: z.enum(PERSONA_TIERS),
  /** The names already in the library, which the draft must not reuse. */
  names: z.array(z.string().max(PERSONA_NAME_ITEM_MAX)).max(PERSONA_NAMES_MAX),
});

const Point = z.string().trim().min(1).max(DRAFT_POINT_MAX);

const output = z.object({
  name: z.string().trim().min(1).max(DRAFT_NAME_MAX),
  role: z.string().trim().min(1).max(DRAFT_ROLE_MAX),
  summary: z.string().trim().max(DRAFT_SUMMARY_MAX).optional(),
  goals: z.array(Point).max(DRAFT_POINTS_MAX),
  pains: z.array(Point).max(DRAFT_POINTS_MAX),
  behaviours: z.array(Point).max(DRAFT_POINTS_MAX),
  quote: z.string().trim().max(DRAFT_QUOTE_MAX).optional(),
  context: z.string().trim().max(DRAFT_CONTEXT_MAX).optional(),
  tags: z.array(z.string().trim().min(1).max(DRAFT_TAG_MAX)).max(DRAFT_TAGS_MAX),
});

export type PersonaFromNotesInput = z.infer<typeof input>;
export type PersonaFromNotesOutput = z.infer<typeof output>;

export const personaFromNotesTask = defineAiTask({
  id: "persona-library.from_notes",
  toolId: "persona-library",
  tier: "full",
  effort: "low",
  maxTokens: 4096,
  input,
  output,
  fallback: personaFromNotesFallback,
  sample: {
    notes: [
      "Participant 1:",
      "Works night shifts as a nurse and plans meals on her phone during breaks.",
      "“I want dinner sorted before I get home, so that I'm not cooking at midnight.”",
      "“It's frustrating when a recipe needs ten things I don't have.”",
      "She usually orders on Sunday for the whole week.",
    ].join("\n"),
    tier: "primary",
    names: ["Tom"],
  },
});
