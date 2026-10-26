import { Square } from "lucide-react";
import type { MethodToolConfig } from "@/components/prioritization/method-tool";
import { EISENHOWER_ACTIONS } from "@/lib/history/event-actions";
import { buildExample } from "./example";
import { EisenhowerInputs } from "./inputs";

/**
 * The tool for the shared method shell's pieces (its add, save, delete and
 * example actions, and the row editor). Both answers are needed to save;
 * an edit that changes them moves the task by derivation (logged as a
 * move).
 */
export const EIS_CONFIG: MethodToolConfig = {
  methodId: "eisenhower",
  toolId: "eisenhower",
  title: "Eisenhower Matrix",
  description:
    "Answer two questions per task (is it urgent, is it important) and add a due date if it has one: the matrix sorts it into Do, Schedule, Delegate or Delete.",
  icon: Square,
  noun: { one: "task", many: "tasks" },
  titleLabel: "Task",
  titlePlaceholder: "e.g. Send the board pack to finance",
  submitLabel: "Add task",
  listLabel: "Tasks by quadrant",
  emptyText:
    "No tasks yet. Add one above, or load an example to see a filled matrix: an overdue fix, work to plan, asks to hand off and chores to drop.",
  history: {
    ITEM_ADDED: EISENHOWER_ACTIONS.TASK_ADDED,
    ITEM_UPDATED: EISENHOWER_ACTIONS.TASK_MOVED,
    ITEM_REMOVED: EISENHOWER_ACTIONS.TASK_REMOVED,
  },
  Inputs: EisenhowerInputs,
  buildExample: () => buildExample(),
};
