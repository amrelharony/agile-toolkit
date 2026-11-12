/**
 * Every tool AI task's server prompt, by task id. Server-only. Add a tool's
 * prompt here when its task goes into `index.ts`.
 */

import "server-only";
import type { AiTaskPrompt } from "../task-types";
import { suggestOptionsPrompt } from "./_example.server";
import { agendaPrompt } from "./facilitator-timers.server";

// See index.ts on `any`: each prompt's input is checked by its task's schema first.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const AI_PROMPTS: readonly (AiTaskPrompt<any> & { taskId: string })[] = [
  suggestOptionsPrompt,
  agendaPrompt,
];
