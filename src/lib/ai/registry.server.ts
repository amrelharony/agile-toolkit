/**
 * Look up a task's server prompt by task id. Server-only: the prompts never
 * reach the browser.
 */

import "server-only";
import type { AiTaskPrompt } from "./task-types";
import { AI_PROMPTS } from "./tasks/index.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const BY_ID: ReadonlyMap<string, AiTaskPrompt<any>> = new Map(AI_PROMPTS.map((p) => [p.taskId, p]));

/** The prompt for this task id, or undefined. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getAiPrompt(id: string): AiTaskPrompt<any> | undefined {
  return BY_ID.get(id);
}

/** Every task id that has a prompt. */
export function listAiPromptIds(): string[] {
  return Array.from(BY_ID.keys());
}
