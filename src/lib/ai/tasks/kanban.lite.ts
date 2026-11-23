/**
 * Kanban's AI task, the lite half pages import (no zod; the def, with its
 * schemas, is `kanban.ts` and loads on first AI use).
 */

import { lazyAiTask } from "../task-ref";
import {
  BLOCKER_TEMPLATE,
  FINISH_TEMPLATE,
  POLICY_TEMPLATES,
  START_TEMPLATE,
  STATIK_QUESTIONS,
} from "@/lib/kanban/statik";
import type { PoliciesInput, PoliciesOutput } from "./kanban";
export type { PoliciesInput, PoliciesOutput } from "./kanban";

/** Stages the task reads: every stage of a board but Done (the Flow board has 4). */
export const POLICY_STAGES_MAX = 6;
/** A stage id, as the boards name them ("in_progress"). */
export const POLICY_STAGE_MAX = 20;
export const POLICY_LABEL_MAX = 40;
/** One policy, a start or finish point, the blocker policy, a question. */
export const POLICY_TEXT_MAX = 200;
/** One STATIK note sent along. */
export const POLICY_NOTE_MAX = 1000;
export const POLICY_QUESTIONS_MAX = 3;

/** A policy for a stage the templates don't know: in our words, short. */
const GENERIC_POLICY = {
  enter: "It is ready for this step and someone has room to take it",
  exit: "The work of this step is done and someone has checked it",
};

/**
 * Starter policies without AI: a template entry and exit policy for each
 * stage sent (Done is never one), skipping a stage that already has both,
 * plus the start, finish and blocker templates and three STATIK questions.
 */
export function kanbanPoliciesFallback(input: PoliciesInput): PoliciesOutput {
  const existing = new Map(input.existing.map((p) => [p.stage, p]));
  const policies = input.stages
    .filter((s) => s.stage !== "done")
    .filter((s) => {
      const had = existing.get(s.stage);
      return !(had?.enter?.trim() && had?.exit?.trim());
    })
    .slice(0, POLICY_STAGES_MAX)
    .map((s) => ({ stage: s.stage, ...(POLICY_TEMPLATES[s.stage] ?? GENERIC_POLICY) }));
  return {
    policies,
    startPoint: START_TEMPLATE,
    finishPoint: FINISH_TEMPLATE,
    blockerPolicy: BLOCKER_TEMPLATE,
    questions: STATIK_QUESTIONS.slice(0, POLICY_QUESTIONS_MAX),
  };
}

/**
 * The answer as the page uses it: only policies for stages it sent (never
 * Done), one per stage (the first), each with something to say, in the
 * board's stage order; blank start, finish and blocker lines dropped.
 */
export function cleanPoliciesAnswer(output: PoliciesOutput, input: PoliciesInput): PoliciesOutput {
  const order = input.stages.filter((s) => s.stage !== "done").map((s) => s.stage);
  const byStage = new Map<string, PoliciesOutput["policies"][number]>();
  for (const p of output.policies) {
    if (!order.includes(p.stage) || byStage.has(p.stage)) continue;
    const enter = p.enter?.trim();
    const exit = p.exit?.trim();
    if (!enter && !exit) continue;
    byStage.set(p.stage, {
      stage: p.stage,
      ...(enter ? { enter } : {}),
      ...(exit ? { exit } : {}),
    });
  }
  const line = (s: string | undefined) => (s?.trim() ? s.trim() : undefined);
  const startPoint = line(output.startPoint);
  const finishPoint = line(output.finishPoint);
  const blockerPolicy = line(output.blockerPolicy);
  return {
    policies: order.flatMap((s) => (byStage.has(s) ? [byStage.get(s)!] : [])),
    ...(startPoint ? { startPoint } : {}),
    ...(finishPoint ? { finishPoint } : {}),
    ...(blockerPolicy ? { blockerPolicy } : {}),
    questions: (output.questions ?? [])
      .map((q) => q.trim())
      .filter(Boolean)
      .slice(0, POLICY_QUESTIONS_MAX),
  };
}

export const kanbanPoliciesTask = lazyAiTask<PoliciesInput, PoliciesOutput>(
  {
    id: "kanban.policies",
    toolId: "kanban",
    fallback: kanbanPoliciesFallback,
  },
  () => import("./kanban").then((m) => m.kanbanPoliciesTask)
);
