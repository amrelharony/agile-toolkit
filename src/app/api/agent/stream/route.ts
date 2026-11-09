import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuthorizedUser } from "@/lib/auth/require-user";
import { readBoundedText, PayloadTooLargeError } from "@/lib/mcp/read-bounded";
import {
  IDLE_TIMEOUT_MS,
  buildUpstreamBody,
  fetchWithFirstByteTimeout,
  idleTimeoutStream,
  resolveOwnerBackend,
  upstreamHeaders,
} from "@/lib/agent/upstream";

/**
 * Agent streaming proxy for the signed-in owner. OpenAI-compatible chat
 * completions, streamed back to the browser as raw SSE.
 *
 * Backend (see `resolveOwnerBackend` in lib/agent/upstream.ts):
 *   1. OpenClaw, the owner's gateway (OPENCLAW_API_KEY, OPENCLAW_URL,
 *      OPENCLAW_MODEL). It holds the GLM key on the VPS, so the toolkit needs
 *      no GLM key of its own once this is set.
 *   2. GLM_API_KEY → open.bigmodel.cn (GLM_AGENT_MODEL, optional GLM_BASE_URL).
 *   3. ZAI_API_KEY → api.z.ai (ZAI_AGENT_MODEL, optional ZAI_BASE_URL).
 * With none of them set, GET and POST answer `{"mode":"client"}` and the
 * browser uses its own BYOK GLM key from the AI Settings dialog.
 *
 * Runtime: Edge. A GLM turn with function calling routinely takes 5-20s, and
 * longer with reasoning; the 10s Node serverless cap on Vercel Hobby would cut
 * many off, while Edge streams responses natively via Web Streams. The
 * tool-use loop itself runs in the browser, so multi-round work isn't bounded
 * by the per-turn cap.
 *
 * Timeouts: no response headers from the upstream within 20s → 504 (Vercel
 * Edge must start a response within 25s, or the platform's own 504 fires
 * first, without this route's body or X-RateLimit-* headers); once streaming,
 * no new chunk for 30s → the stream errors and the upstream request is
 * aborted (as on amrelharony.com).
 *
 * Edge-safe imports only: `requireAuthorizedUser` uses `next/headers`
 * cookies + `@supabase/ssr` createServerClient, both Edge-compatible, and
 * lib/agent/upstream.ts uses Web APIs only.
 *
 * POST body shape (OpenAI chat completions; `buildUpstreamBody` decides what
 * is actually forwarded):
 *   {
 *     messages: Array<OpenAIMessage>,
 *     tools?: Array<{type:"function", function:{...}}>,
 *     stream: true,
 *     max_tokens?: number,          // clamped to 64..8192
 *     temperature?: number,         // clamped to 0..2
 *     reasoning_effort?: "low" | "high" | "max", // OpenClaw and Z.AI only
 *   }
 * The model always comes from the server env, `tool_choice` is "auto"
 * whenever tools are sent, and usage reporting is always requested.
 *
 * GET returns the mode, provider and model the server is using, so the client
 * doesn't have to guess.
 */

export const runtime = "edge";

/**
 * Most tool definitions forwarded per request, besides those the history's
 * tool_calls call (always kept: cutting one makes the upstream reject the
 * turn). The browser sends at most 64 plus any the conversation already used;
 * this only stops a runaway client from shipping the whole registry (~830
 * tools, ~590 KB) to the gateway.
 */
const MAX_FORWARDED_TOOLS = 256;

interface RateLimit {
  allowed: boolean;
  daily_used: number;
  daily_max: number;
  weekly_used: number;
  weekly_max: number;
  monthly_used: number;
  monthly_max: number;
}

/** X-RateLimit-* headers the client parses into the usage bar. */
function rateHeaders(r: RateLimit): Record<string, string> {
  return {
    "x-ratelimit-daily": String(r.daily_used),
    "x-ratelimit-daily-max": String(r.daily_max),
    "x-ratelimit-weekly": String(r.weekly_used),
    "x-ratelimit-weekly-max": String(r.weekly_max),
    "x-ratelimit-monthly": String(r.monthly_used),
    "x-ratelimit-monthly-max": String(r.monthly_max),
  };
}

/**
 * Atomic check-and-record against the per-user windows. Returns the usage
 * snapshot, or null when rate limiting is unavailable (RPC missing / errored)
 * — in which case we FAIL OPEN: the agent must never break because the
 * usage table isn't migrated yet.
 */
async function checkRate(supabase: SupabaseClient): Promise<RateLimit | null> {
  try {
    const { data, error } = await supabase.rpc("check_chat_rate_limit");
    if (error || !data) return null;
    return data as RateLimit;
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    await requireAuthorizedUser();
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }
  const b = resolveOwnerBackend();
  return Response.json({
    mode: b ? "server" : "client",
    model: b?.model ?? null,
    provider: b?.provider ?? null,
  });
}

export async function POST(req: NextRequest) {
  let supabase: SupabaseClient;
  try {
    ({ supabase } = await requireAuthorizedUser());
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }

  const be = resolveOwnerBackend();
  if (!be) {
    return Response.json({ mode: "client", provider: null }, { status: 200 });
  }

  let body: unknown;
  try {
    // Bound the body while streaming (independent of Content-Length), so a
    // header-less/chunked oversize payload can't force unbounded buffering on
    // this Edge function. 4 MiB is generous for multi-turn message history +
    // tool results while still capping the DoS surface.
    const MAX_BODY_BYTES = 4 * 1_048_576; // 4 MiB
    body = JSON.parse(await readBoundedText(req, MAX_BODY_BYTES));
  } catch (err) {
    if (err instanceof PayloadTooLargeError) {
      return Response.json({ error: "payload_too_large" }, { status: 413 });
    }
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  // Rate limit at TURN start only — but decide "turn start" SERVER-side.
  // The previous gate trusted the client's `x-agent-new-turn` header, so a
  // client that simply omitted it was never metered at all — defeating the
  // cost-protection ceiling (migration 0020) for exactly the runaway-client
  // scenario it exists for. A turn's later tool-use rounds are recognisable
  // from the payload itself: they return tool results to the model, so the
  // trailing message has role "tool"; round 0 of a turn ends with the user's
  // message. Metering on that shape keeps "one row ≈ one turn" without
  // letting the client opt out. The header is still honoured in the
  // metering-ON direction only (belt and braces — it can add a check, never
  // skip one). 429 short-circuits before we spend any gateway tokens.
  // Fail-open if the check is unavailable (RPC missing / errored).
  let rate: RateLimit | null = null;
  const bodyMessages = (body as Record<string, unknown>).messages;
  const lastMessage =
    Array.isArray(bodyMessages) && bodyMessages.length > 0
      ? (bodyMessages[bodyMessages.length - 1] as { role?: unknown } | null)
      : null;
  const isToolRound = lastMessage?.role === "tool";
  if (!isToolRound || req.headers.get("x-agent-new-turn") === "1") {
    rate = await checkRate(supabase);
    if (rate && !rate.allowed) {
      return Response.json(
        { error: "rate_limited", limits: rate },
        { status: 429, headers: { "retry-after": "3600", ...rateHeaders(rate) } }
      );
    }
  }
  // checkRate already recorded this turn before the upstream call, so every
  // response below carries the X-RateLimit-* headers — otherwise a failed
  // turn (e.g. an OpenClaw 413) would consume quota without the bar showing it.
  const limitHeaders = rate ? rateHeaders(rate) : undefined;

  // Whitelist the fields we forward: drop anything the client tried to slip
  // in (custom headers, a model override, arbitrary upstream parameters).
  // BUG-G12: tools are shape-checked, never forwarded verbatim as a list.
  const forward = buildUpstreamBody(body as Record<string, unknown>, be, {
    maxTools: MAX_FORWARDED_TOOLS,
  });

  // One controller for the whole upstream call: the browser closing the tab
  // aborts it (we stop paying for tokens nobody reads), and so do both
  // timeouts.
  const upstreamAbort = new AbortController();
  if (req.signal?.aborted) upstreamAbort.abort();
  else req.signal?.addEventListener("abort", () => upstreamAbort.abort(), { once: true });

  const result = await fetchWithFirstByteTimeout(
    be.url,
    { method: "POST", headers: upstreamHeaders(be), body: JSON.stringify(forward) },
    { controller: upstreamAbort }
  );

  if (!result.ok) {
    if (result.reason === "timeout") {
      return Response.json({ error: "upstream_timeout" }, { status: 504, headers: limitHeaders });
    }
    if (result.reason === "aborted") {
      // The browser went away; nobody reads this.
      return new Response(null, { status: 499 });
    }
    return Response.json({ error: "upstream_unreachable" }, { status: 502, headers: limitHeaders });
  }

  const upstream = result.response;
  if (!upstream.ok || !upstream.body) {
    let detail = "";
    try {
      detail = (await upstream.text()).slice(0, 300);
    } catch {
      /* ignore */
    }
    return Response.json(
      { error: "upstream", status: upstream.status, detail },
      { status: upstream.status, headers: limitHeaders }
    );
  }

  // Pass the SSE through untouched, but end it if the gateway stalls. The idle
  // timer also stops when the browser cancels the body or the upstream errors;
  // req.signal is a second hook for a disconnect, where Edge fires it.
  const idle = idleTimeoutStream(upstream.body, IDLE_TIMEOUT_MS, () => upstreamAbort.abort());
  req.signal?.addEventListener("abort", idle.stop, { once: true });

  return new Response(idle.stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      ...(limitHeaders ?? {}),
    },
  });
}
