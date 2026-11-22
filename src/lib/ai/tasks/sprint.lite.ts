/**
 * The Sprint Cockpit's AI task, the lite half pages import (no zod; the
 * def, with its schemas, is `sprint.ts` and loads on first AI use).
 */

import { lazyAiTask } from "../task-ref";
import { riskNote } from "@/lib/sprints/risk";
import type { RiskNoteInput, RiskNoteOutput } from "./sprint";
export type { RiskNoteInput, RiskNoteOutput } from "./sprint";

/** At most this many reasons go to the model (the rule gives up to nine). */
export const RISK_NOTE_REASONS_MAX = 9;
export const RISK_NOTE_MAX = 700;

/**
 * The note without AI, cut to the output's cap. An input with no headline
 * (which the schema refuses) gives no note: it throws, and the button asks
 * to fill the tool in first.
 */
function fallbackNote(i: RiskNoteInput): string {
  const note = riskNote(i);
  if (!note.trim()) throw new Error("The risk rule has nothing to say about this sprint.");
  return note.length > RISK_NOTE_MAX ? `${note.slice(0, RISK_NOTE_MAX - 1).trimEnd()}…` : note;
}

/** The task's answer without AI: the risk rule's own sentences (`riskNote`). */
export const sprintRiskNoteFallback = (i: RiskNoteInput): RiskNoteOutput => ({
  note: fallbackNote(i),
});

export const sprintRiskNoteTask = lazyAiTask<RiskNoteInput, RiskNoteOutput>(
  { id: "sprint.risk_note", toolId: "sprint", fallback: sprintRiskNoteFallback },
  () => import("./sprint").then((m) => m.sprintRiskNoteTask)
);
