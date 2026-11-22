/**
 * Helpers that make a task's two halves with their types checked: the input
 * and output types are read off the zod schemas, so `fallback`, `sample` and
 * the prompt's `user(input)` can't drift from them.
 *
 *   // tasks/<toolId>.lite.ts (no zod: what pages import, lib/ai/task-ref)
 *   export const myFallback = (i: MyInput): MyOutput => …;
 *   export const myTask = lazyAiTask({ id: "my-tool.do_thing", toolId, fallback: myFallback },
 *     () => import("./<toolId>").then((m) => m.myTask));
 *   // tasks/<toolId>.ts (the def: schemas, the same fallback)
 *   export const myTask = defineAiTask({ id: "my-tool.do_thing", input, output, fallback: myFallback, … });
 *   // tasks/<toolId>.server.ts (server-only)
 *   export const myPrompt = defineAiPrompt(myTask, { system: "…", user: (i) => … });
 */

import type { ZodType } from "zod";
import { noteLoadedAiTask } from "./task-ref";
import type { AiTaskDef, AiTaskPrompt } from "./task-types";

/**
 * A task definition, its types read from the schemas only (`sample` and
 * `fallback` are checked against them, never used to widen them). It is
 * noted as loaded, so the page's ref to it answers `peek()` at once.
 */
export function defineAiTask<I, O>(
  def: Omit<AiTaskDef<I, O>, "fallback" | "sample"> & {
    fallback(input: NoInfer<I>): NoInfer<O>;
    sample: NoInfer<I>;
  }
): AiTaskDef<I, O> {
  noteLoadedAiTask(def);
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
