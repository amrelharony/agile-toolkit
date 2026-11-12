import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuthorizedUser } from "@/lib/auth/require-user";
import { CALLER_NAME, pickModel, resolveOwnerBackend } from "@/lib/agent/upstream";
import {
  TOOL_AI_DEADLINE_MS,
  TOOL_AI_OWNER_MAX_BODY_BYTES,
  type ToolAiErrorCode,
} from "@/lib/ai/contract";
import { meterOwner, recordOwnerTokens, type OwnerMeterResult } from "@/lib/ai/owner-meter.server";
import { PROMPT_RUN_TASK, promptRunInput } from "@/lib/ai/prompt-run";
import { runPromptStream } from "@/lib/ai/prompt-run.server";
import { getAiTask } from "@/lib/ai/registry";
import { getAiPrompt } from "@/lib/ai/registry.server";
import { runAiTask, type RunAiTaskError } from "@/lib/ai/run-task.server";
import { PayloadTooLargeError, readBoundedText } from "@/lib/mcp/read-bounded";

/**
 * POST /api/ai/tool: a tool's Ask Amr for the signed-in owner.
 *
 * Not on the middleware's bypass list, so the middleware's owner check runs
 * first; the handler checks again with requireAuthorizedUser. Body
 * `{ task, input }` (lib/ai/contract.ts): the task's id and its input. The
 * server builds the prompt from the task's server half and forwards it to the
 * owner's backend (resolveOwnerBackend) on the task's model tier (pickModel),
 * with X-Caller CALLER_NAME.
 *
 * In order, each step refusing with `{ error: code }`:
 *   1. Signed in as the owner, else 401 unauthenticated / 403 / 503 (from
 *      requireAuthorizedUser).
 *   2. A backend is set up, else 503 no_backend.
 *   3. Body cap of 256 KiB, else 413 too_large; unreadable JSON is 400
 *      bad_request.
 *   4. The task exists (400 unknown_task) and the input fits its schema (400
 *      bad_input).
 *   5. The owner's limiter, check_tool_ai_rate_limit (migration 0040): 300 a
 *      day, 1,500 a week, 5,000 a month, recorded with the real model. Over a
 *      limit is 429 rate_limited; no answer from it (missing, an error, a
 *      timeout) is 503 meter_unavailable. It fails closed, unlike the chat's.
 *   6. runAiTask (lib/ai/run-task.server.ts): 200 `{ ok, data, source,
 *      reason? }`, or 504 timeout / 503 upstream_busy / 502 upstream_error.
 *
 * The special task "prompt.run" (lib/ai/prompt-run.ts) is the AI Prompts
 * drawer's Run with AI: its answer streams back as plain-text SSE events.
 *
 * Runs on Node with maxDuration 300 s; the run's own deadline is 240 s
 * (TOOL_AI_DEADLINE_MS), past which the repair call is skipped and the
 * upstream call is aborted. The browser leaving aborts it too. Logs carry the
 * task id, the outcome, the time and token counts only.
 */

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

function refuse(
  status: number,
  error: ToolAiErrorCode,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {}
): Response {
  return Response.json({ error, ...extra }, { status, headers: { ...NO_STORE, ...headers } });
}

const ERROR_STATUS: Record<RunAiTaskError, number> = {
  bad_input: 400,
  timeout: 504,
  upstream_busy: 503,
  upstream_error: 502,
  aborted: 499,
};

function limits(m: OwnerMeterResult) {
  return {
    daily: m.daily,
    daily_max: m.dailyMax,
    weekly: m.weekly,
    weekly_max: m.weeklyMax,
    monthly: m.monthly,
    monthly_max: m.monthlyMax,
  };
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  let supabase: SupabaseClient;
  try {
    ({ supabase } = await requireAuthorizedUser());
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }

  const backend = resolveOwnerBackend();
  if (!backend) return refuse(503, "no_backend");

  let raw: unknown;
  try {
    raw = JSON.parse(await readBoundedText(req, TOOL_AI_OWNER_MAX_BODY_BYTES));
  } catch (err) {
    if (err instanceof PayloadTooLargeError) return refuse(413, "too_large");
    return refuse(400, "bad_request");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return refuse(400, "bad_request");
  const { task: taskId, input } = raw as { task?: unknown; input?: unknown };
  if (typeof taskId !== "string" || taskId.length > 80) return refuse(400, "bad_request");

  // ── Run with AI: the owner's own prompt, streamed back as text ───────────
  if (taskId === PROMPT_RUN_TASK) {
    const parsed = promptRunInput.safeParse(input);
    if (!parsed.success) return refuse(400, "bad_input");
    const model = pickModel(backend, "full");
    const meter = await meterOwner(supabase, PROMPT_RUN_TASK, model);
    if (!meter) return refuse(503, "meter_unavailable");
    if (!meter.allowed) {
      return refuse(429, "rate_limited", { limits: limits(meter) }, { "retry-after": "3600" });
    }
    const run = await runPromptStream({
      input: parsed.data,
      backend: { ...backend, model },
      caller: CALLER_NAME,
      signal: req.signal,
      startedAt,
      deadlineMs: TOOL_AI_DEADLINE_MS,
      // Awaited before the stream closes, so the write lands on serverless too.
      onDone: async (usage) => {
        if (usage && meter.id) {
          await recordOwnerTokens(supabase, meter.id, usage.tokensIn, usage.tokensOut);
        }
      },
    });
    if (!run.ok) {
      if (run.error === "aborted") return new Response(null, { status: 499 });
      return refuse(ERROR_STATUS[run.error], run.error);
    }
    return new Response(run.stream, {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store, no-transform",
        "x-accel-buffering": "no",
      },
    });
  }

  // ── A registered JSON task ────────────────────────────────────────────────
  const task = getAiTask(taskId);
  const prompt = task ? getAiPrompt(task.id) : undefined;
  if (!task || !prompt) return refuse(400, "unknown_task");
  // Checked before the meter, so a malformed request costs nothing.
  if (!task.input.safeParse(input).success) return refuse(400, "bad_input");

  const model = pickModel(backend, task.tier);
  const meter = await meterOwner(supabase, task.id, model);
  if (!meter) return refuse(503, "meter_unavailable");
  if (!meter.allowed) {
    return refuse(429, "rate_limited", { limits: limits(meter) }, { "retry-after": "3600" });
  }

  const result = await runAiTask({
    task,
    prompt,
    input,
    backend: { ...backend, model },
    caller: CALLER_NAME,
    signal: req.signal,
    startedAt,
    deadlineMs: TOOL_AI_DEADLINE_MS,
  });
  if (result.usage && meter.id) {
    await recordOwnerTokens(supabase, meter.id, result.usage.tokensIn, result.usage.tokensOut);
  }
  if (!result.ok) {
    if (result.error === "aborted") return new Response(null, { status: 499 });
    return refuse(ERROR_STATUS[result.error], result.error);
  }
  return Response.json(
    {
      ok: true,
      data: result.data,
      source: result.source,
      ...(result.reason ? { reason: result.reason } : {}),
    },
    { headers: NO_STORE }
  );
}
