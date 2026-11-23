/**
 * Persona Library's AI task, the lite half pages import (no zod; the def,
 * with its schemas, is `persona-library.ts` and loads on first AI use): the
 * caps, the draft without AI and the ref.
 */

import { lazyAiTask } from "../task-ref";
import { personaFromNotes } from "@/lib/personas/from-notes";
import type { PersonaFromNotesInput, PersonaFromNotesOutput } from "./persona-library";
export type { PersonaFromNotesInput, PersonaFromNotesOutput } from "./persona-library";

export {
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
} from "@/lib/personas/from-notes";

/**
 * A persona from the notes by keyword rules (lib/personas/from-notes):
 * goals, frustrations and habits from the sentences that say them, the
 * role from "as a …", a quote, tags and a made-up name not in `names`.
 * Throws on notes, a tier or names the schema refuses.
 */
export function personaFromNotesFallback(input: PersonaFromNotesInput): PersonaFromNotesOutput {
  return personaFromNotes(input.notes, input.tier, input.names);
}

export const personaFromNotesTask = lazyAiTask<PersonaFromNotesInput, PersonaFromNotesOutput>(
  {
    id: "persona-library.from_notes",
    toolId: "persona-library",
    fallback: personaFromNotesFallback,
  },
  () => import("./persona-library").then((m) => m.personaFromNotesTask)
);
