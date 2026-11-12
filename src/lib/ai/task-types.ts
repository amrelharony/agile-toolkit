/**
 * The shape of one tool AI task: what a tool asks Amr's AI to do, with what
 * input, and what comes back. Browser-safe: no server code, no prompt text.
 *
 * Every task comes in two modules (see lib/ai/tasks/_example.ts):
 *   - `tasks/<toolId>.ts`, browser-safe: the AiTaskDef below, made with
 *     defineAiTask. The tool page imports it for the Ask Amr button, and its
 *     `fallback` runs in the browser when there is no AI.
 *   - `tasks/<toolId>.server.ts`, server-only: the AiTaskPrompt, made with
 *     defineAiPrompt. Only the routes read it, so a prompt never reaches the
 *     browser and the browser never sends one.
 */

import type { ZodType } from "zod";
import type { ModelTier } from "@/lib/agent/upstream";

/** Task ids are "<toolId>.<name>", lower case: "quick-vote.suggest_options". */
export type AiTaskId = `${string}.${string}`;

export interface AiTaskDef<I = unknown, O = unknown> {
  /** "<toolId>.<name>", unique across the registry. */
  id: AiTaskId;
  /** The tool the task belongs to ("ai" for the shared example). */
  toolId: string;
  /** "flash" for small, quick tasks; "full" when the answer needs the bigger model. */
  tier: ModelTier;
  /** The reasoning effort asked for; a visitor's config row can lower it, never raise it. */
  effort: "low" | "high";
  /**
   * The answer's token budget, reasoning included: at least 4096 when the
   * output holds an array, at least 2048 otherwise (test/ai/task-contract
   * checks it). The route clamps it to 8192.
   */
  maxTokens: number;
  /** What the browser sends. Every string and array has a hard cap. */
  input: ZodType<I>;
  /** What the model must answer. Every string and array has a hard cap. */
  output: ZodType<O>;
  /**
   * The answer without AI: a template or a heuristic, so the tool works fully
   * when AI is off, refused, busy or wrong. Pure and synchronous.
   */
  fallback(input: I): O;
  /** A realistic input: the contract test, the golden test and the probe use it. */
  sample: I;
  /**
   * Only the signed-in owner may run it: the visitor route refuses it, and
   * useToolAi / <AiButton> hide it from visitors (no consent card).
   */
  ownerOnly?: boolean;
}

/** The server half of a task: the instructions and the user message. */
export interface AiTaskPrompt<I = unknown> {
  /**
   * What to do, in plain words. The runner adds the agile-only scope rule, the
   * prompt-injection guardrail and the "answer with JSON only, in this
   * shape" line after it.
   */
  system: string;
  /**
   * The task's data as text. The runner sanitises it and wraps it in
   * `<user_content>` tags, so everything here is treated as data, never as
   * instructions. Label the parts ("Question: …").
   */
  user(input: I): string;
  /**
   * Optional: the answer's shape in words, used instead of the one generated
   * from the output schema.
   */
  shape?: string;
}

/** Where an answer came from: the model, or the task's own fallback. */
export type AiSource = "ai" | "fallback";

/**
 * Why a fallback stood in: the model ran out of tokens before answering
 * ("length"), answered with something unusable twice ("bad_answer"), or ran
 * out of time ("timeout").
 */
export type AiFallbackReason = "length" | "bad_answer" | "timeout";
