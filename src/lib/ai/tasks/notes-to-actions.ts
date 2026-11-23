/**
 * Notes to Actions' AI task, the def: read pasted meeting notes and list
 * the actions, decisions, blockers, stories, bugs and open questions in
 * them, each with the line it came from. The page checks every answer
 * against the notes (`groundedItems`: no invented items, owners or dates),
 * the person keeps the ones that are real, and only then sends them, each
 * with Undo. Nothing is sent by the AI itself.
 *
 * The roster is never sent: owners are matched on the device. At its caps
 * the input is about 36 KB in 3-byte text, under TOOL_AI_BODY_BUDGET, so it
 * needs no fitter. Without AI the keyword rules answer (`extractByRules`,
 * through `notes-to-actions.lite.ts`, which pages import). The prompt is in
 * `notes-to-actions.server.ts`.
 */

import { z } from "zod";
import { defineAiTask } from "../define-task";
import { MEETING_NOTE_ITEM_KINDS } from "@/lib/stores/workspace-types";
import {
  FOUND_DETAIL_MAX,
  FOUND_MAX,
  FOUND_OWNER_MAX,
  FOUND_QUOTE_MAX,
  FOUND_TEXT_MAX,
} from "@/lib/notes-to-actions/extract";
import {
  EXTRACT_MEETING_MAX,
  EXTRACT_NOTES_MAX,
  extractNotesFallback,
} from "./notes-to-actions.lite";

export {
  EXTRACT_MEETING_MAX,
  EXTRACT_NOTES_MAX,
  extractNotesFallback,
} from "./notes-to-actions.lite";

const Day = z
  .string()
  .max(10)
  .regex(/^\d{4}-\d{2}-\d{2}$/);

const input = z.object({
  notes: z.string().trim().min(1).max(EXTRACT_NOTES_MAX),
  meeting: z.string().trim().max(EXTRACT_MEETING_MAX).optional(),
  date: Day,
  sprintEnd: Day.optional(),
});

const output = z.object({
  items: z
    .array(
      z.object({
        kind: z.enum(MEETING_NOTE_ITEM_KINDS),
        text: z.string().trim().min(1).max(FOUND_TEXT_MAX),
        detail: z.string().trim().max(FOUND_DETAIL_MAX).optional(),
        owner: z.string().trim().max(FOUND_OWNER_MAX).optional(),
        due: Day.optional(),
        quote: z.string().trim().min(1).max(FOUND_QUOTE_MAX),
      })
    )
    .max(FOUND_MAX),
});

export type ExtractNotesInput = z.infer<typeof input>;
export type ExtractNotesOutput = z.infer<typeof output>;

export const notesToActionsExtractTask = defineAiTask({
  id: "notes-to-actions.extract",
  toolId: "notes-to-actions",
  tier: "full",
  effort: "low",
  maxTokens: 8192,
  input,
  output,
  fallback: extractNotesFallback,
  sample: {
    notes: [
      "Sprint Review, 20 Nov",
      "- Ana to update the onboarding copy by Friday",
      "- Decided: we stop supporting the old export",
      "- Waiting on legal sign-off for the cookie banner",
      "- CSV export cuts off long names",
      "- Do we demo on staging or live?",
    ].join("\n"),
    meeting: "Sprint Review",
    date: "2026-11-20",
  },
});
