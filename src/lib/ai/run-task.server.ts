/**
 * Run one tool AI task against the gateway and return its JSON answer, checked.
 *
 * Both tool AI routes call this. In order:
 *   1. The input is checked with the task's schema (`bad_input`).
 *   2. The messages are built on the server: the task's instructions, the
 *      agile-only scope rule, the prompt-injection guardrail and the
 *      "answer with JSON only, in this shape" line in the system message; the
 *      task's data, sanitised and wrapped in `<user_content>`, as the user's.
 *   3. One streamed call (buildUpstreamBody always streams): max_tokens from
 *      the task, reasoning effort the lower of the task's and the cap,
 *      temperature 0.3. Only `delta.content` is kept; reasoning is ignored.
 *   4. The answer is parsed tolerantly (parse-answer.ts). Then:
 *      - parsed: the answer, `source: "ai"`;
 *      - empty with finish_reason "length": the fallback, reason "length"
 *        (a repair would run out the same way);
 *      - malformed: one repair call, with the bad text cut to 2,000
 *        characters, unless less than a minute of the deadline is left or
 *        `beforeRepair` says no (the visitor route re-meters there). Still
 *        malformed: the fallback, reason "bad_answer";
 *      - cut off by the deadline or a stalled stream, and not parseable: the
 *        fallback, reason "timeout".
 *   An upstream failure before any answer is an error the route turns into a
 *   status: `timeout` (504), `upstream_busy` (503), `upstream_error` (502), or
 *   `aborted` when the caller went away.
 *
 * Privacy: no input or answer text is ever logged. One line per call: the
 * task id, the outcome, the time taken and the token counts.
 */

import "server-only";
import {
  IDLE_TIMEOUT_MS,
  buildUpstreamBody,
  fetchWithFirstByteTimeout,
  idleTimeoutStream,
  minEffort,
  upstreamHeaders,
  type ReasoningEffortLevel,
  type UpstreamBackend,
} from "@/lib/agent/upstream";
import {
  PROMPT_GUARDRAIL,
  sanitizePromptBlock,
  wrapUserContent,
} from "@/lib/ai-prompts/prompt-utils";
import { pumpSseStream } from "@/lib/llm/stream-sse";
import { TOOL_TASK_SCOPE } from "@/lib/visitor-ai/scope";
import { z } from "zod";
import { parseAnswer } from "./parse-answer";
import { describeShape } from "./shape";
import type { AiFallbackReason, AiSource, AiTaskDef, AiTaskPrompt } from "./task-types";

/** No response headers from the gateway within this long: `timeout`. */
export const TOOL_AI_FIRST_BYTE_TIMEOUT_MS = 30_000;
/** The repair call is skipped when less than this is left before the deadline. */
export const REPAIR_MIN_REMAINING_MS = 60_000;
/** The repair note, after the bad answer. */
export const REPAIR_NOTE =
  "Your last answer was not valid JSON for the shape. Reply again with JSON only.";
/** How much of a bad answer goes back with the repair note. */
export const REPAIR_BAD_TEXT_CHARS = 2_000;
const TEMPERATURE = 0.3;
/** The task data's cap after sanitising (the input schemas cap it well below). */
const MAX_USER_CHARS = 48_000;
/** Answer text kept per call; more is dropped (max_tokens keeps it far below). */
const MAX_ANSWER_CHARS = 64_000;

export interface AiUsage {
  tokensIn: number;
  tokensOut: number;
}

export type RunAiTaskError =
  | "bad_input"
  | "timeout"
  | "upstream_busy"
  | "upstream_error"
  | "aborted";

export type RunAiTaskResult<O> =
  | {
      ok: true;
      data: O;
      source: AiSource;
      reason?: AiFallbackReason;
      model: string;
      usage?: AiUsage;
    }
  | { ok: false; error: RunAiTaskError; model: string; usage?: AiUsage };

export interface RunAiTaskArgs<I, O> {
  task: AiTaskDef<I, O>;
  prompt: AiTaskPrompt<I>;
  /** The input as the browser sent it; checked here with the task's schema. */
  input: unknown;
  /** The backend, with `model` already chosen (pickModel). */
  backend: Pick<UpstreamBackend, "provider" | "url" | "key" | "model">;
  /** X-Caller: CALLER_NAME for the owner, VISITOR_CALLER_NAME for visitors. */
  caller: string;
  /** The highest effort allowed (a visitor's config row); null or missing: no cap. */
  effortCap?: ReasoningEffortLevel | null;
  /** The request's own signal: the browser leaving aborts the upstream call. */
  signal?: AbortSignal;
  /** The whole run's budget in ms, counted from `startedAt`. */
  deadlineMs: number;
  /** When the request arrived (ms since 1970); default now. */
  startedAt?: number;
  /** Asked before the repair call; false skips it and the fallback stands in. */
  beforeRepair?: () => Promise<boolean>;
  fetchImpl?: typeof fetch;
  firstByteTimeoutMs?: number;
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** The system message for a task. */
export function buildTaskSystem(
  task: Pick<AiTaskDef, "output">,
  prompt: Pick<AiTaskPrompt, "system" | "shape">
): string {
  const isArray = task.output instanceof z.ZodArray;
  const shape = prompt.shape ?? describeShape(task.output);
  return [
    prompt.system.trim(),
    TOOL_TASK_SCOPE,
    "Write every text value as plain text: no Markdown, no links, no HTML.",
    PROMPT_GUARDRAIL.trim(),
    `Answer with one JSON ${isArray ? "array" : "object"} only, no prose, matching this shape:\n${shape}`,
  ].join("\n\n");
}

/** The task's data as the user message: sanitised, and wrapped as untrusted content. */
export function buildTaskUser<I>(prompt: AiTaskPrompt<I>, input: I): string {
  return wrapUserContent(sanitizePromptBlock(prompt.user(input), MAX_USER_CHARS), true);
}

type CallOutcome =
  | { kind: "error"; error: Exclude<RunAiTaskError, "bad_input"> }
  | {
      kind: "answer";
      content: string;
      finish: string | null;
      usage?: AiUsage;
      /** The stream ended early: the deadline, a stall or a broken connection. */
      cut: boolean;
    };

function addUsage(a: AiUsage | undefined, b: AiUsage | undefined): AiUsage | undefined {
  if (!a) return b;
  if (!b) return a;
  return { tokensIn: a.tokensIn + b.tokensIn, tokensOut: a.tokensOut + b.tokensOut };
}

function readUsage(raw: unknown): AiUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const u = raw as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
  return { tokensIn: n(u.prompt_tokens), tokensOut: n(u.completion_tokens) };
}

/** One streamed call; never throws. */
async function callModel<I, O>(
  args: RunAiTaskArgs<I, O>,
  messages: ChatMessage[],
  effort: ReasoningEffortLevel,
  deadlineAt: number
): Promise<CallOutcome> {
  const controller = new AbortController();
  const onCallerAbort = () => controller.abort();
  if (args.signal?.aborted) controller.abort();
  else args.signal?.addEventListener("abort", onCallerAbort, { once: true });
  let deadlineHit = false;
  const deadlineTimer = setTimeout(
    () => {
      deadlineHit = true;
      controller.abort();
    },
    Math.max(0, deadlineAt - Date.now())
  );
  const callerGone = () => Boolean(args.signal?.aborted) && !deadlineHit;

  try {
    const body = buildUpstreamBody(
      {
        messages,
        max_tokens: args.task.maxTokens,
        temperature: TEMPERATURE,
        reasoning_effort: effort,
      },
      args.backend
    );
    const result = await fetchWithFirstByteTimeout(
      args.backend.url,
      {
        method: "POST",
        headers: upstreamHeaders(args.backend, args.caller),
        body: JSON.stringify(body),
      },
      {
        controller,
        timeoutMs: args.firstByteTimeoutMs ?? TOOL_AI_FIRST_BYTE_TIMEOUT_MS,
        fetchImpl: args.fetchImpl,
      }
    );
    if (!result.ok) {
      if (result.reason === "aborted") {
        return { kind: "error", error: callerGone() ? "aborted" : "timeout" };
      }
      return { kind: "error", error: result.reason === "timeout" ? "timeout" : "upstream_busy" };
    }
    const res = result.response;
    if (!res.ok || !res.body) {
      // Never read or logged: the gateway's error text could echo the request.
      res.body?.cancel().catch(() => {});
      return {
        kind: "error",
        error: res.status === 429 || res.status >= 500 ? "upstream_busy" : "upstream_error",
      };
    }

    let stalled = false;
    const idle = idleTimeoutStream(res.body, IDLE_TIMEOUT_MS, () => {
      stalled = true;
      controller.abort();
    });
    let content = "";
    let finish: string | null = null;
    let usage: AiUsage | undefined;
    let broken = false;
    try {
      await pumpSseStream(new Response(idle.stream), controller.signal, ({ data }) => {
        if (data === "[DONE]") return;
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(data) as Record<string, unknown>;
        } catch {
          return;
        }
        if (payload.usage) usage = readUsage(payload.usage) ?? usage;
        const choice = (payload.choices as Array<Record<string, unknown>> | undefined)?.[0];
        if (!choice) return;
        const delta = choice.delta as Record<string, unknown> | undefined;
        // reasoning_content is the model thinking aloud: never part of the answer.
        if (typeof delta?.content === "string" && content.length < MAX_ANSWER_CHARS) {
          content += delta.content;
        }
        if (typeof choice.finish_reason === "string") finish = choice.finish_reason;
      });
    } catch {
      broken = true;
    } finally {
      idle.stop();
    }
    if (callerGone()) return { kind: "error", error: "aborted" };
    return {
      kind: "answer",
      content: content.slice(0, MAX_ANSWER_CHARS),
      finish,
      usage,
      cut: broken || stalled || deadlineHit,
    };
  } finally {
    clearTimeout(deadlineTimer);
    args.signal?.removeEventListener("abort", onCallerAbort);
  }
}

function logLine(taskId: string, outcome: string, startedAt: number, usage: AiUsage | undefined) {
  // Counts only: never the input, the answer or who asked.
  // eslint-disable-next-line no-console
  console.info(
    `[tool-ai] ${taskId} ${outcome} ${Date.now() - startedAt}ms in=${usage?.tokensIn ?? 0} out=${usage?.tokensOut ?? 0}`
  );
}

/** Run one task. Never throws for an upstream problem; see the file comment. */
export async function runAiTask<I, O>(args: RunAiTaskArgs<I, O>): Promise<RunAiTaskResult<O>> {
  const { task, prompt, backend } = args;
  const startedAt = args.startedAt ?? Date.now();
  const deadlineAt = startedAt + args.deadlineMs;
  const model = backend.model;

  const parsedInput = task.input.safeParse(args.input);
  if (!parsedInput.success) {
    logLine(task.id, "bad_input", startedAt, undefined);
    return { ok: false, error: "bad_input", model };
  }
  const input = parsedInput.data;
  const fallback = (reason: AiFallbackReason, usage: AiUsage | undefined): RunAiTaskResult<O> => {
    logLine(task.id, `fallback_${reason}`, startedAt, usage);
    return { ok: true, data: task.fallback(input), source: "fallback", reason, model, usage };
  };

  if (Date.now() >= deadlineAt) {
    logLine(task.id, "timeout", startedAt, undefined);
    return { ok: false, error: "timeout", model };
  }

  const effort = minEffort(task.effort, args.effortCap);
  const system: ChatMessage = { role: "system", content: buildTaskSystem(task, prompt) };
  const user: ChatMessage = { role: "user", content: buildTaskUser(prompt, input) };

  const first = await callModel(args, [system, user], effort, deadlineAt);
  if (first.kind === "error") {
    logLine(task.id, first.error, startedAt, undefined);
    return { ok: false, error: first.error, model };
  }
  let usage = first.usage;

  const firstParsed = parseAnswer(first.content, task.output);
  if (firstParsed.ok) {
    logLine(task.id, "ai", startedAt, usage);
    return { ok: true, data: firstParsed.data, source: "ai", model, usage };
  }
  if (first.content.trim() === "" && first.finish === "length") return fallback("length", usage);
  if (first.cut) return fallback("timeout", usage);

  // Malformed: one repair, if there is time and the caller agrees.
  if (deadlineAt - Date.now() < REPAIR_MIN_REMAINING_MS) return fallback("bad_answer", usage);
  if (args.beforeRepair) {
    let allowed = false;
    try {
      allowed = await args.beforeRepair();
    } catch {
      allowed = false;
    }
    if (!allowed) return fallback("bad_answer", usage);
  }

  const repair = await callModel(
    args,
    [
      system,
      user,
      { role: "assistant", content: first.content.slice(0, REPAIR_BAD_TEXT_CHARS) },
      { role: "user", content: REPAIR_NOTE },
    ],
    effort,
    deadlineAt
  );
  if (repair.kind === "error") {
    if (repair.error === "aborted") {
      logLine(task.id, "aborted", startedAt, usage);
      return { ok: false, error: "aborted", model, usage };
    }
    return fallback("bad_answer", usage);
  }
  usage = addUsage(usage, repair.usage);
  const repaired = parseAnswer(repair.content, task.output);
  if (repaired.ok) {
    logLine(task.id, "ai_repaired", startedAt, usage);
    return { ok: true, data: repaired.data, source: "ai", model, usage };
  }
  if (repair.content.trim() === "" && repair.finish === "length") return fallback("length", usage);
  if (repair.cut) return fallback("timeout", usage);
  return fallback("bad_answer", usage);
}
