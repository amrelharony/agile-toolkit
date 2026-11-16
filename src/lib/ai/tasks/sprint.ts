/**
 * The Sprint Cockpit's AI task, the browser-safe half: read what the risk
 * rule found (lib/sprints/risk `sprintRisk`) and write two or three plain
 * sentences on why the sprint goal is at risk and what the team could try.
 * The note is only shown: nothing is saved from it. Without AI the rule's
 * own sentences answer (`riskNote`). The prompt lives in `sprint.server.ts`.
 */

import { z } from "zod";
import { defineAiTask } from "../define-task";
import { riskNote, type RiskLevel } from "@/lib/sprints/risk";

/** At most this many reasons go to the model (the rule gives up to nine). */
export const RISK_NOTE_REASONS_MAX = 9;
export const RISK_NOTE_MAX = 700;

const LEVELS = ["none", "watch", "at_risk"] as const satisfies readonly RiskLevel[];

const input = z.object({
  sprint: z.string().trim().min(1).max(120),
  goal: z.string().trim().max(400).optional(),
  day: z.number().int().min(0).max(400),
  length: z.number().int().min(1).max(400),
  level: z.enum(LEVELS),
  headline: z.string().trim().min(1).max(240),
  reasons: z
    .array(
      z.object({
        level: z.enum(["watch", "at_risk"]),
        text: z.string().trim().min(1).max(300),
        tryThis: z.string().trim().min(1).max(300),
      })
    )
    .max(RISK_NOTE_REASONS_MAX),
});

const output = z.object({
  note: z.string().trim().min(1).max(RISK_NOTE_MAX),
});

export type RiskNoteInput = z.infer<typeof input>;
export type RiskNoteOutput = z.infer<typeof output>;

/** The note without AI, cut to the output's cap. */
function fallbackNote(i: RiskNoteInput): string {
  const note = riskNote(i);
  return note.length > RISK_NOTE_MAX ? `${note.slice(0, RISK_NOTE_MAX - 1).trimEnd()}…` : note;
}

export const sprintRiskNoteTask = defineAiTask({
  id: "sprint.risk_note",
  toolId: "sprint",
  tier: "flash",
  effort: "low",
  maxTokens: 2048,
  input,
  output,
  fallback: (i) => ({ note: fallbackNote(i) }),
  sample: {
    sprint: "Sprint 14",
    goal: "Customers can pay with a saved card",
    day: 6,
    length: 10,
    level: "at_risk",
    headline: "The sprint goal is at risk.",
    reasons: [
      {
        level: "at_risk",
        text: "At this pace the work left finishes around day 13, after the last day (day 10).",
        tryThis:
          "Agree with the Product Owner what to drop or split, so the part that meets the goal lands.",
      },
      {
        level: "watch",
        text: "2 stories are blocked on the board.",
        tryThis: "Unblock before starting anything new: ask who can help today.",
      },
    ],
  },
});
