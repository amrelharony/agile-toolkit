/**
 * The AI behind "Ask Amr for names": Picker's `picker.theme_names` task,
 * reused (Team Mixer has no AI task of its own, and no AI ever sees who is
 * in a group: it gets a theme and a count). Where AI is off the page offers
 * the built-in names (lib/team-mixer/names), which work without it.
 */

import { THEME_NAMES_MAX, themeNamesTask } from "@/lib/ai/tasks/picker";
import type { AiTaskDef } from "@/lib/ai/task-types";

export interface GroupNameAi<I, O> {
  task: AiTaskDef<I, O>;
  /** The task's input for a theme and a number of names. */
  input: (theme: string, count: number) => I;
  /** The names in the task's answer. */
  names: (output: O) => string[];
  /** The most names the task gives at once. */
  max: number;
}

// `any`: the task's own input and output types, erased for the page; the
// task's schemas check both at run time.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const GROUP_NAME_AI: GroupNameAi<any, any> | null = {
  task: themeNamesTask,
  input: (theme: string, count: number) => ({ theme, count }),
  names: (output: { names: string[] }) => output.names,
  max: THEME_NAMES_MAX,
};
