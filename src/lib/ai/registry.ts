/**
 * Look up a tool AI task by id. Browser-safe (schemas and fallbacks only).
 *
 * The routes use it to find the task a request names. A tool page should
 * import its own task module directly (`@/lib/ai/tasks/<toolId>`) and pass the
 * def to useToolAi / <AiButton>, so a page bundles only its own tasks, not
 * this whole list.
 */

import type { AiTaskDef } from "./task-types";
import { AI_TASKS } from "./tasks";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTask = AiTaskDef<any, any>;

const BY_ID: ReadonlyMap<string, AnyTask> = new Map(AI_TASKS.map((t) => [t.id, t]));

/** The task with this id, or undefined. */
export function getAiTask(id: string): AnyTask | undefined {
  return BY_ID.get(id);
}

/** Every registered task, in the index's order. */
export function listAiTasks(): readonly AnyTask[] {
  return AI_TASKS;
}
