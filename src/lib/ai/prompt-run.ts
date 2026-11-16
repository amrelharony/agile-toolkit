/**
 * The owner's free-form "Run with AI" from the AI Prompts drawer, as a special
 * task of the owner route: the drawer's prompt goes to the owner's gateway and
 * the answer streams back as plain text. Owner-only (the visitor route
 * refuses it), so it is not in the task registry and has no fallback: the
 * drawer's Copy button is the way without AI.
 *
 * The stream is SSE: `data: {"text":"…"}` events as the text arrives, an
 * optional `data: {"error":"<code>"}` when the answer stops early, then
 * `data: [DONE]`. Browser-safe.
 */

import { z } from "zod";

export const PROMPT_RUN_TASK = "prompt.run";

/** The prompt's length limit, in characters. */
export const PROMPT_RUN_MAX_CHARS = 24_000;

export const promptRunInput = z.object({
  prompt: z.string().trim().min(1).max(PROMPT_RUN_MAX_CHARS),
  toolName: z.string().trim().max(120).optional(),
});

export type PromptRunInput = z.infer<typeof promptRunInput>;

/** One event of the stream, parsed. */
export type PromptRunEvent = { text: string } | { error: string };

/** Read one SSE `data:` payload of the stream; null for [DONE] or anything unreadable. */
export function parsePromptRunEvent(data: string): PromptRunEvent | null {
  if (data === "[DONE]") return null;
  try {
    const value = JSON.parse(data) as Record<string, unknown>;
    if (typeof value.text === "string") return { text: value.text };
    if (typeof value.error === "string") return { error: value.error };
  } catch {
    /* not ours */
  }
  return null;
}
