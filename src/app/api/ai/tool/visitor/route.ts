import type { NextRequest } from "next/server";
import { VISITOR_CALLER_NAME, pickModel, resolveVisitorBackend } from "@/lib/agent/upstream";
import {
  TOOL_AI_DEADLINE_MS,
  TOOL_AI_VISITOR_MAX_BODY_BYTES,
  type ToolAiErrorCode,
} from "@/lib/ai/contract";
import { PROMPT_RUN_TASK } from "@/lib/ai/prompt-run";
import { getAiTask } from "@/lib/ai/registry";
import { getAiPrompt } from "@/lib/ai/registry.server";
import { runAiTask, type RunAiTaskError } from "@/lib/ai/run-task.server";
import { PayloadTooLargeError, readBoundedText } from "@/lib/mcp/read-bounded";
import { clientIpOrNull, isSameOrigin, withinRateLimit } from "@/lib/server/public-guard";
import { getSquadAdminClient } from "@/lib/squads/server";
import { meterVisitor, type MeterResult } from "@/lib/visitor-ai/meter";
import { quotaHeaders } from "@/lib/visitor-ai/quota-headers";
import { cairoDay, ipBucket, visitorKey } from "@/lib/visitor-ai/visitor-key";

/**
 * POST /api/ai/tool/visitor: a tool's Ask Amr for signed-out visitors.
 *
 * Reachable without a session through an exact-match middleware bypass. Body
 * `{ task, input }` (lib/ai/contract.ts). The server builds the prompt from
 * the task's server half; the browser never sends one, nor the model,
 * max_tokens or the reasoning effort. Each use counts against the same daily
 * allowance as Amr's chat (visitor_ai_meter, migration 0037).
 *
 * In order, each step refusing with `{ error: code }`:
 *   1. Kill switch: VISITOR_AI_ENABLED=1 and OPENCLAW_API_KEY
 *      (resolveVisitorBackend), else 503 disabled.
 *   2. Same site only, else 403 forbidden.
 *   3. Burst brake: 30 requests a minute per address (a whole IPv6 /64 is one
 *      address) and instance, its own bucket ("tool-ai"), else 429 slow_down.
 *   4. Body cap of 64 KiB, else 413 too_large; unreadable JSON is 400
 *      bad_request.
 *   5. The task: unknown is 400 unknown_task; an owner-only task, and the
 *      owner's prompt.run, are 400 owner_only; an input that doesn't fit the
 *      task's schema is 400 bad_input. None of these is metered.
 *   6. The daily visitor code (visitor-key.ts) from the address and
 *      VISITOR_AI_HASH_SECRET. No secret, or no address in production, is
 *      503 meter_unavailable.
 *   7. The meter, as a new turn: no answer is 503 meter_unavailable (fails
 *      closed); a limit is 429 with its code (visitor_limit,
 *      visitor_peak_limit, site_limit, site_peak_limit, site_busy), or 503
 *      disabled when the config row switches visitors off.
 *   8. runAiTask on VISITOR_AI_MODEL with X-Caller VISITOR_CALLER_NAME, the
 *      effort capped by the config row. A repair call is metered again with
 *      newTurn = false, so it counts only toward the call caps; if the meter
 *      refuses it, the task's fallback answers instead.
 * Every answer after the meter carries the quota headers (VISITOR_HEADERS),
 * so the chat panel's count stays right.
 *
 * Privacy: the address is used for the burst brake (in memory) and the
 * visitor code, and is never stored or logged. Logs carry the task id, the
 * outcome, the time and token counts only, never input or answer text, an
 * address or a code. No cookie is read or set.
 *
 * Runs on Node (node:crypto for the HMAC, the service-role client), with
 * maxDuration 300 s and its own 240 s deadline (TOOL_AI_DEADLINE_MS).
 */

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;
/** The visitor bucket used when a dev server sees no address. */
const LOCAL_IP = "127.0.0.1";

const NO_STORE = { "cache-control": "no-store" };

function refuse(
  status: number,
  error: ToolAiErrorCode,
  headers: Record<string, string> = {}
): Response {
  return Response.json({ error }, { status, headers: { ...NO_STORE, ...headers } });
}

const ERROR_STATUS: Record<RunAiTaskError, number> = {
  bad_input: 400,
  timeout: 504,
  upstream_busy: 503,
  upstream_error: 502,
  aborted: 499,
};

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const backend = resolveVisitorBackend();
  if (!backend) return refuse(503, "disabled");
  if (!isSameOrigin(req)) return refuse(403, "forbidden");
  if (!withinRateLimit(req, "tool-ai", RATE_LIMIT, RATE_WINDOW_MS, ipBucket)) {
    return refuse(429, "slow_down", { "retry-after": "60" });
  }

  let raw: unknown;
  try {
    raw = JSON.parse(await readBoundedText(req, TOOL_AI_VISITOR_MAX_BODY_BYTES));
  } catch (err) {
    if (err instanceof PayloadTooLargeError) return refuse(413, "too_large");
    return refuse(400, "bad_request");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return refuse(400, "bad_request");
  const { task: taskId, input } = raw as { task?: unknown; input?: unknown };
  if (typeof taskId !== "string" || taskId.length > 80) return refuse(400, "bad_request");
  if (taskId === PROMPT_RUN_TASK) return refuse(400, "owner_only");
  const task = getAiTask(taskId);
  const prompt = task ? getAiPrompt(task.id) : undefined;
  if (!task || !prompt) return refuse(400, "unknown_task");
  if (task.ownerOnly) return refuse(400, "owner_only");
  if (!task.input.safeParse(input).success) return refuse(400, "bad_input");

  const ip = clientIpOrNull(req) ?? (process.env.NODE_ENV === "production" ? null : LOCAL_IP);
  const key = ip ? visitorKey(ip, cairoDay(), process.env.VISITOR_AI_HASH_SECRET) : null;
  if (!key) {
    console.warn("[tool-ai] 503 meter_unavailable: no visitor code");
    return refuse(503, "meter_unavailable");
  }

  const admin = getSquadAdminClient();
  const meter = admin ? await meterVisitor(admin, key, true) : null;
  if (!meter) {
    console.warn("[tool-ai] 503 meter_unavailable");
    return refuse(503, "meter_unavailable");
  }
  let latest: MeterResult = meter;
  if (!meter.allowed) {
    const reason = meter.reason ?? "site_busy";
    return refuse(reason === "disabled" ? 503 : 429, reason, quotaHeaders(meter));
  }

  const result = await runAiTask({
    task,
    prompt,
    input,
    backend: { ...backend, model: pickModel(backend, task.tier, "visitor") },
    caller: VISITOR_CALLER_NAME,
    effortCap: meter.reasoningEffort,
    signal: req.signal,
    startedAt,
    deadlineMs: TOOL_AI_DEADLINE_MS,
    // The repair is one more model call: counted toward the call caps only.
    beforeRepair: async () => {
      if (!admin) return false;
      const again = await meterVisitor(admin, key, false);
      if (!again) return false;
      latest = again;
      return again.allowed;
    },
  });

  const quota = quotaHeaders(latest);
  if (!result.ok) {
    if (result.error === "aborted") return new Response(null, { status: 499 });
    return refuse(ERROR_STATUS[result.error], result.error, quota);
  }
  return Response.json(
    {
      ok: true,
      data: result.data,
      source: result.source,
      ...(result.reason ? { reason: result.reason } : {}),
    },
    { headers: { ...NO_STORE, ...quota } }
  );
}
