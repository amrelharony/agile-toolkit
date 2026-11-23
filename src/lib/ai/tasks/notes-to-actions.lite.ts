/**
 * Notes to Actions' AI task, the lite half pages import (no zod; the def,
 * with its schemas, is `notes-to-actions.ts` and loads on first AI use):
 * the caps, the finding without AI and the ref.
 */

import { lazyAiTask } from "../task-ref";
import { extractByRules } from "@/lib/notes-to-actions/extract";
import type { ExtractNotesInput, ExtractNotesOutput } from "./notes-to-actions";
export type { ExtractNotesInput, ExtractNotesOutput } from "./notes-to-actions";

/** The pasted notes' cap (TOOL_TEXT_MAX.paste). */
export const EXTRACT_NOTES_MAX = 12000;
export const EXTRACT_MEETING_MAX = 200;

/**
 * What the keyword rules find (lib/notes-to-actions/extract): lines that
 * start like an action, a decision, a blocker, a bug, a story or a
 * question. Blank notes throw, as the schema refuses them.
 */
export function extractNotesFallback(input: ExtractNotesInput): ExtractNotesOutput {
  if (!input.notes.trim()) throw new Error("Paste the notes first.");
  return { items: extractByRules(input) };
}

export const notesToActionsExtractTask = lazyAiTask<ExtractNotesInput, ExtractNotesOutput>(
  { id: "notes-to-actions.extract", toolId: "notes-to-actions", fallback: extractNotesFallback },
  () => import("./notes-to-actions").then((m) => m.notesToActionsExtractTask)
);
