/**
 * Kanban's AI task, the def: draft the policies of a Definition of
 * Workflow from what the team wrote while designing it (its STATIK notes),
 * the board's stages and WIP limits and the policies it already has. The
 * person accepts each suggestion into the definition, with Undo. Without
 * AI, starter templates answer (`kanbanPoliciesFallback` in
 * `kanban.lite.ts`, which pages import). The prompt lives in
 * `kanban.server.ts`.
 */

import { z } from "zod";
import { defineAiTask } from "../define-task";
import {
  POLICY_LABEL_MAX,
  POLICY_NOTE_MAX,
  POLICY_QUESTIONS_MAX,
  POLICY_STAGE_MAX,
  POLICY_STAGES_MAX,
  POLICY_TEXT_MAX,
  kanbanPoliciesFallback,
} from "./kanban.lite";

export {
  POLICY_LABEL_MAX,
  POLICY_NOTE_MAX,
  POLICY_QUESTIONS_MAX,
  POLICY_STAGE_MAX,
  POLICY_STAGES_MAX,
  POLICY_TEXT_MAX,
  cleanPoliciesAnswer,
  kanbanPoliciesFallback,
} from "./kanban.lite";

const CLASSES = ["standard", "expedite", "fixed_date", "intangible"] as const;

const note = z.string().trim().max(POLICY_NOTE_MAX).optional();
const text = z.string().trim().max(POLICY_TEXT_MAX);

const input = z.object({
  board: z.enum(["sprint", "flow"]),
  workItem: text.optional(),
  stages: z
    .array(
      z.object({
        stage: z.string().trim().min(1).max(POLICY_STAGE_MAX),
        label: z.string().trim().min(1).max(POLICY_LABEL_MAX),
        /** The column's WIP limit; null for none. */
        wip: z.number().int().min(0).max(999).nullable(),
      })
    )
    .min(1)
    .max(POLICY_STAGES_MAX),
  notes: z.object({ inside: note, outside: note, demand: note, capability: note }),
  existing: z
    .array(
      z.object({
        stage: z.string().trim().min(1).max(POLICY_STAGE_MAX),
        enter: text.optional(),
        exit: text.optional(),
      })
    )
    .max(POLICY_STAGES_MAX),
  classes: z.array(z.enum(CLASSES)).max(CLASSES.length),
});

const output = z.object({
  policies: z
    .array(
      z.object({
        stage: z.string().trim().min(1).max(POLICY_STAGE_MAX),
        enter: text.optional(),
        exit: text.optional(),
      })
    )
    .max(POLICY_STAGES_MAX),
  startPoint: text.optional(),
  finishPoint: text.optional(),
  blockerPolicy: text.optional(),
  questions: z
    .array(z.string().trim().min(1).max(POLICY_TEXT_MAX))
    .max(POLICY_QUESTIONS_MAX)
    .optional(),
});

export type PoliciesInput = z.infer<typeof input>;
export type PoliciesOutput = z.infer<typeof output>;

export const kanbanPoliciesTask = defineAiTask({
  id: "kanban.policies",
  toolId: "kanban",
  tier: "full",
  effort: "low",
  maxTokens: 4096,
  input,
  output,
  fallback: kanbanPoliciesFallback,
  sample: {
    board: "flow",
    workItem: "A customer support request a developer has to change code for",
    stages: [
      { stage: "backlog", label: "Backlog", wip: null },
      { stage: "ready", label: "Ready", wip: 5 },
      { stage: "in_progress", label: "In progress", wip: 3 },
      { stage: "review", label: "Review", wip: 2 },
    ],
    notes: {
      inside: "Too many requests started at once; reviews wait for days.",
      outside: "Support can't tell customers when a fix will land.",
      demand: "About 12 requests a week from support, two of them urgent.",
    },
    existing: [{ stage: "review", exit: "Checked by someone other than the author" }],
    classes: ["standard", "expedite"],
  },
});
