/**
 * What "Draft policies" sends: the board's stages (never Done) with their
 * WIP limits, what one work item is, the first four STATIK notes, the
 * policies already in the editor and the classes of service in use. Every
 * text cut to the task's caps here, so a long draft can't make the input
 * fail its schema; at its caps the input is about 7,500 characters, well
 * under the route's body budget even at 3 bytes a character.
 */

import type {
  KanbanCard,
  KanbanClassOfService,
  KanbanColumnId,
  StatikNotes,
} from "@/lib/stores/workspace-types";
import { policyStages, type WorkflowBoard } from "@/lib/kanban/workflow";
import { cutText } from "@/lib/utils/cut-text";
import {
  POLICY_LABEL_MAX,
  POLICY_NOTE_MAX,
  POLICY_STAGES_MAX,
  POLICY_TEXT_MAX,
  POLICY_WIP_MAX,
  type PoliciesInput,
} from "@/lib/ai/tasks/kanban.lite";
import { CLASSES, draftKeys, type WorkflowDraft } from "./form";

/** The column whose limit a stage shows: the Sprint board's To do shares Ready's. */
const WIP_KEY: Record<string, KanbanColumnId | null> = {
  backlog: null,
  ready: "ready",
  todo: "ready",
  in_progress: "in_progress",
  review: "review",
};

const cut = (s: string | undefined, max: number) => {
  const t = cutText((s ?? "").trim(), max).trim();
  return t === "" ? undefined : t;
};

export function policiesInput({
  board,
  draft,
  statik,
  wipLimits,
  cards,
}: {
  board: WorkflowBoard;
  draft: WorkflowDraft;
  statik: StatikNotes | undefined;
  wipLimits: Partial<Record<KanbanColumnId, number>>;
  cards: readonly KanbanCard[];
}): PoliciesInput {
  const stages = policyStages(board).slice(0, POLICY_STAGES_MAX);
  const notes: PoliciesInput["notes"] = {};
  for (const key of ["inside", "outside", "demand", "capability"] as const) {
    const note = cut(statik?.[key], POLICY_NOTE_MAX);
    if (note) notes[key] = note;
  }
  const used = new Set(cards.map((c) => c.class));
  const classes: KanbanClassOfService[] =
    board === "flow" ? CLASSES.filter((c) => used.has(c)) : [];
  const workItem = cut(draft.workItem, POLICY_TEXT_MAX);
  return {
    board,
    ...(workItem ? { workItem } : {}),
    stages: stages.map((s) => {
      const key = WIP_KEY[s.id] ?? null;
      const limit = key ? wipLimits[key] : undefined;
      return {
        stage: s.id,
        label: cutText(s.label, POLICY_LABEL_MAX),
        // A synced or agent-written limit can be any number: the task takes up to 999.
        wip:
          typeof limit === "number" && limit > 0
            ? Math.min(POLICY_WIP_MAX, Math.round(limit))
            : null,
      };
    }),
    notes,
    existing: stages.flatMap((s) => {
      const enter = cut(draft[draftKeys.enterKey(s.id)], POLICY_TEXT_MAX);
      const exit = cut(draft[draftKeys.exitKey(s.id)], POLICY_TEXT_MAX);
      return enter || exit
        ? [{ stage: s.id, ...(enter ? { enter } : {}), ...(exit ? { exit } : {}) }]
        : [];
    }),
    classes,
  };
}
