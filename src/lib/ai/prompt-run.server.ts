/**
 * The owner's "Run with AI" (task prompt.run, lib/ai/prompt-run.ts): the AI
 * Prompts drawer's prompt goes to the owner's gateway, and the answer comes
 * back as plain-text SSE events while it is written.
 *
 * The prompt is the owner's own, built by the tool's prompt builder from the
 * owner's own data, so it goes as it is, like the drawer's own-key run does.
 * Only `delta.content` is passed on; reasoning is dropped. The stream ends
 * with `{"error": code}` before [DONE] when the answer stops early: "cut" (a
 * stall or a broken connection), "time_limit" (the route's deadline) or
 * "length" (the model's token limit). No text is logged.
 */

import "server-only";
import {
  IDLE_TIMEOUT_MS,
  MAX_TOKENS_CEILING,
  buildUpstreamBody,
  fetchWithFirstByteTimeout,
  idleTimeoutStream,
  upstreamHeaders,
  type UpstreamBackend,
} from "@/lib/agent/upstream";
import { pumpSseStream } from "@/lib/llm/stream-sse";
import { PROMPT_RUN_TASK, type PromptRunInput } from "./prompt-run";
import { TOOL_AI_FIRST_BYTE_TIMEOUT_MS, type AiUsage } from "./run-task.server";

export interface PromptRunArgs {
  input: PromptRunInput;
  /** The owner's backend, with `model` already chosen. */
  backend: Pick<UpstreamBackend, "provider" | "url" | "key" | "model">;
  caller: string;
  signal?: AbortSignal;
  deadlineMs: number;
  startedAt?: number;
  fetchImpl?: typeof fetch;
  firstByteTimeoutMs?: number;
  /**
   * Called once when the answer is over, with the token counts if the gateway
   * sent them. Awaited before the stream's [DONE] and close, so its work (the
   * owner's token write) finishes while the function is still serving the
   * response; keep it short (the owner's write has its own 2.5 s timeout).
   */
  onDone?: (usage: AiUsage | undefined) => void | Promise<void>;
}

export type PromptRunResult =
  | { ok: true; stream: ReadableStream<Uint8Array> }
  | { ok: false; error: "timeout" | "upstream_busy" | "upstream_error" | "aborted" };

/** The system message: the drawer's own, plus plain text. */
export function promptRunSystem(toolName: string | undefined): string {
  const safe = toolName
    ?.replace(/["\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  const lead = safe
    ? `You are an expert Agile coach reviewing data from the "${safe}" tool. Be specific and cite values.`
    : "You are an expert Agile coach. Be specific and cite values.";
  return `${lead} Write plain text: no Markdown headings, tables or links. Simple dashes for lists are fine.`;
}

const enc = new TextEncoder();
const event = (value: unknown) => enc.encode(`data: ${JSON.stringify(value)}\n\n`);
const DONE = enc.encode("data: [DONE]\n\n");

function log(outcome: string, startedAt: number, usage: AiUsage | undefined) {
  // eslint-disable-next-line no-console
  console.info(
    `[tool-ai] ${PROMPT_RUN_TASK} ${outcome} ${Date.now() - startedAt}ms in=${usage?.tokensIn ?? 0} out=${usage?.tokensOut ?? 0}`
  );
}

/** Start the run: an error before any answer, or the plain-text stream. */
export async function runPromptStream(args: PromptRunArgs): Promise<PromptRunResult> {
  const startedAt = args.startedAt ?? Date.now();
  const deadlineAt = startedAt + args.deadlineMs;
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
  const finishUp = () => {
    clearTimeout(deadlineTimer);
    args.signal?.removeEventListener("abort", onCallerAbort);
  };

  const body = buildUpstreamBody(
    {
      messages: [
        { role: "system", content: promptRunSystem(args.input.toolName) },
        { role: "user", content: args.input.prompt },
      ],
      max_tokens: MAX_TOKENS_CEILING,
      reasoning_effort: "high",
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
    finishUp();
    const error =
      result.reason === "aborted"
        ? args.signal?.aborted && !deadlineHit
          ? "aborted"
          : "timeout"
        : result.reason === "timeout"
          ? "timeout"
          : "upstream_busy";
    log(error, startedAt, undefined);
    return { ok: false, error };
  }
  const res = result.response;
  if (!res.ok || !res.body) {
    finishUp();
    res.body?.cancel().catch(() => {});
    const error = res.status === 429 || res.status >= 500 ? "upstream_busy" : "upstream_error";
    log(error, startedAt, undefined);
    return { ok: false, error };
  }

  let stalled = false;
  const idle = idleTimeoutStream(res.body, IDLE_TIMEOUT_MS, () => {
    stalled = true;
    controller.abort();
  });
  const upstream = new Response(idle.stream);

  const stream = new ReadableStream<Uint8Array>({
    async start(out) {
      let usage: AiUsage | undefined;
      let finish: string | null = null;
      let broken = false;
      let gone = false;
      const push = (chunk: Uint8Array) => {
        if (gone) return;
        try {
          out.enqueue(chunk);
        } catch {
          gone = true;
        }
      };
      try {
        await pumpSseStream(upstream, controller.signal, ({ data }) => {
          if (data === "[DONE]") return;
          let payload: Record<string, unknown>;
          try {
            payload = JSON.parse(data) as Record<string, unknown>;
          } catch {
            return;
          }
          if (payload.usage && typeof payload.usage === "object") {
            const u = payload.usage as Record<string, unknown>;
            usage = {
              tokensIn: typeof u.prompt_tokens === "number" ? u.prompt_tokens : 0,
              tokensOut: typeof u.completion_tokens === "number" ? u.completion_tokens : 0,
            };
          }
          const choice = (payload.choices as Array<Record<string, unknown>> | undefined)?.[0];
          if (!choice) return;
          const delta = choice.delta as Record<string, unknown> | undefined;
          if (typeof delta?.content === "string" && delta.content)
            push(event({ text: delta.content }));
          if (typeof choice.finish_reason === "string") finish = choice.finish_reason;
        });
      } catch {
        broken = true;
      } finally {
        idle.stop();
        finishUp();
      }
      const ending = deadlineHit
        ? "time_limit"
        : broken || stalled
          ? "cut"
          : finish === "length"
            ? "length"
            : null;
      if (ending) push(event({ error: ending }));
      // Before the close: once the response ends, a serverless function can
      // be frozen, and a write started after that may never land.
      try {
        await args.onDone?.(usage);
      } catch {
        /* best effort */
      }
      push(DONE);
      if (!gone) {
        try {
          out.close();
        } catch {
          /* already closed */
        }
      }
      log(ending ?? "ok", startedAt, usage);
    },
    cancel() {
      // The browser stopped reading (Stop, or the drawer closed): stop paying for tokens.
      controller.abort();
    },
  });
  return { ok: true, stream };
}
