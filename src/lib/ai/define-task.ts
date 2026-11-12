/**
 * Helpers that make a task's two halves with their types checked: the input
 * and output types are read off the zod schemas, so `fallback`, `sample` and
 * the prompt's `user(input)` can't drift from them.
 *
 *   // tasks/<toolId>.ts (browser-safe)
 *   export const myTask = defineAiTask({ id: "my-tool.do_thing", input, output, … });
 *   // tasks/<toolId>.server.ts (server-only)
 *   export const myPrompt = defineAiPrompt(myTask, { system: "…", user: (i) => … });
 */

import type { ZodType } from "zod";
import type { AiTaskDef, AiTaskPrompt } from "./task-types";

/**
 * A task definition, its types read from the schemas only (`sample` and
 * `fallback` are checked against them, never used to widen them).
 */
export function defineAiTask<I, O>(
  def: Omit<AiTaskDef<I, O>, "fallback" | "sample"> & {
    fallback(input: NoInfer<I>): NoInfer<O>;
    sample: NoInfer<I>;
  }
): AiTaskDef<I, O> {
  return def;
}

/**
 * A task's server prompt. `task` is only there to tie the prompt's input type
 * to the task's; the registry pairs them by id.
 */
export function defineAiPrompt<I, O>(
  task: AiTaskDef<I, O>,
  prompt: AiTaskPrompt<I>
): AiTaskPrompt<I> & { taskId: AiTaskDef<I, O>["id"] } {
  return { ...prompt, taskId: task.id };
}

/** The input type of a task (for a tool's own helpers). */
export type AiTaskInput<T> = T extends AiTaskDef<infer I, unknown> ? I : never;
/** The output type of a task. */
export type AiTaskOutput<T> = T extends AiTaskDef<unknown, infer O> ? O : never;

/** A schema's parsed type, for writing a task's fallback outside the def. */
export type SchemaOf<S> = S extends ZodType<infer T> ? T : never;
