/**
 * The small, board-side part of Kanban's Definition of Workflow: names,
 * labels and the few readers the boards, their "Add why" dialog and the
 * Markdown export use on first load.
 *
 * Kept apart from ./workflow (which re-exports all of it) so the boards
 * don't carry the definition's engine (normalising, versions, compares and
 * the SLE suggestion, with the flow counts they read). Only the Definition
 * of Workflow card, which loads with its card, reaches that.
 */

import type {
  KanbanClassOfService,
  KanbanColumnId,
  MeetingCadence,
  WorkflowDefinition,
  WorkflowStagePolicy,
} from "@/lib/stores/workspace-types";
import { BOARD_WORKFLOW, SPRINT_WORKFLOW } from "@/lib/flow/workflows";
import type { FlowWorkflow } from "@/lib/flow/types";

export type WorkflowBoard = "sprint" | "flow";

export const BOARD_NAME: Record<WorkflowBoard, string> = {
  sprint: "Sprint board",
  flow: "Flow board",
};

export const CLASS_LABEL: Record<KanbanClassOfService, string> = {
  standard: "Standard",
  expedite: "Expedite",
  fixed_date: "Fixed date",
  intangible: "Intangible",
};

export const CADENCE_LABEL: Record<MeetingCadence, string> = {
  daily: "Daily",
  weekly: "Weekly",
  fortnightly: "Every two weeks",
  monthly: "Monthly",
  quarterly: "Quarterly",
};

export function isWorkflowBoard(value: unknown): value is WorkflowBoard {
  return value === "sprint" || value === "flow";
}

/** The board's workflow (lib/flow): stage ids shared with its items. */
export function boardWorkflow(board: WorkflowBoard): FlowWorkflow {
  return board === "sprint" ? SPRINT_WORKFLOW : BOARD_WORKFLOW;
}

/** The stages a policy can be written for: every stage of the board but Done. */
export function policyStages(board: WorkflowBoard): { id: string; label: string }[] {
  return boardWorkflow(board)
    .stages.filter((s) => s.kind !== "done")
    .map((s) => ({ id: s.id, label: s.label }));
}

/** The board the definition describes, or null when it names none yet. */
export function describedBoard(def: WorkflowDefinition | null | undefined): WorkflowBoard | null {
  return isWorkflowBoard(def?.board) ? def.board : null;
}

/** The stage policy written for `stage`, or undefined. */
export function stagePolicy(
  def: WorkflowDefinition | null | undefined,
  stage: string
): WorkflowStagePolicy | undefined {
  return (def?.policies ?? []).find((p) => p.stage === stage);
}

/** "SLE: 85% within 8 days" */
export function sleText(sle: WorkflowDefinition["sle"]): string | null {
  if (!sle) return null;
  return `SLE: ${sle.pct}% within ${sle.days} ${sle.days === 1 ? "day" : "days"}`;
}

/** The Sprint board's columns share the Flow board's limits: To do uses Ready's. */
const WIP_COLUMNS: Record<WorkflowBoard, { key: KanbanColumnId; label: string }[]> = {
  flow: [
    { key: "ready", label: "Ready" },
    { key: "in_progress", label: "In progress" },
    { key: "review", label: "Review" },
  ],
  sprint: [
    { key: "ready", label: "To do" },
    { key: "in_progress", label: "In progress" },
    { key: "review", label: "Review" },
  ],
};

/** The WIP limits the board shows, by column label. */
export function wipColumns(board: WorkflowBoard): { key: KanbanColumnId; label: string }[] {
  return WIP_COLUMNS[board];
}

/* ── History payloads ────────────────────────────────────────────────── */

/**
 * BLOCK_NOTED's payload: the card or story, whether its cluster is one of
 * the defaults (and which) or the team's own, and the side. Never the
 * cluster's or the cause's text: a custom cluster is words someone typed.
 */
export function blockNotedPayload(
  idKey: "cardId" | "storyId",
  id: string,
  cluster: string | undefined,
  side: string | undefined,
  defaults: readonly { label: string }[]
): Record<string, string | number> {
  const key = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const index = cluster ? defaults.findIndex((d) => key(d.label) === key(cluster)) : -1;
  return {
    [idKey]: id,
    cluster: !cluster ? "none" : index >= 0 ? "default" : "custom",
    ...(index >= 0 ? { clusterIndex: index } : {}),
    ...(side ? { side } : {}),
  };
}
