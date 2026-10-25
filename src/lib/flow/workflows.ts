/**
 * The two boards' workflows, in board order. Kept apart from ./items (which
 * re-exports them) so ./cycle can read a stage's kind without importing the
 * item builders, which import lib/kanban/flow, which imports ./cycle.
 */

import type { FlowItem, FlowStage, FlowWorkflow, StageKind } from "./types";

/**
 * The Sprint board over `Story.status`, as kanban/sprint-view SPRINT_COLUMNS
 * lays it out: To do is the sprint's queue, In progress and Review are work
 * in progress. A story still marked "backlog" (planned in but not started)
 * waits in To do, as on the board.
 */
export const SPRINT_WORKFLOW: FlowWorkflow = {
  source: "sprint",
  stages: [
    { id: "todo", label: "To do", kind: "queue" },
    { id: "in_progress", label: "In progress", kind: "active" },
    { id: "review", label: "Review", kind: "active" },
    { id: "done", label: "Done", kind: "done" },
  ],
};

/**
 * The Flow board's columns (kanban/flow-view FLOW_COLUMNS). Backlog and
 * Ready are queues; In progress and Review are the columns whose entry
 * starts a card's cycle time (WORKING in lib/kanban/flow).
 */
export const BOARD_WORKFLOW: FlowWorkflow = {
  source: "flow",
  stages: [
    { id: "backlog", label: "Backlog", kind: "queue" },
    { id: "ready", label: "Ready", kind: "queue" },
    { id: "in_progress", label: "In progress", kind: "active" },
    { id: "review", label: "Review", kind: "active" },
    { id: "done", label: "Done", kind: "done" },
  ],
};

/** The workflow an item's stage ids belong to: stories are on the Sprint board, cards on the Flow board. */
export function workflowOf(item: Pick<FlowItem, "kind">): FlowWorkflow {
  return item.kind === "story" ? SPRINT_WORKFLOW : BOARD_WORKFLOW;
}

/** The stage `id` of `workflow`, or undefined when it has none. */
export function stageOf(workflow: FlowWorkflow, id: string): FlowStage | undefined {
  return workflow.stages.find((s) => s.id === id);
}

/** What the item's current stage means (queue, active, done); null for a stage its workflow lacks. */
export function stageKind(item: Pick<FlowItem, "kind" | "stage">): StageKind | null {
  return stageOf(workflowOf(item), item.stage)?.kind ?? null;
}
