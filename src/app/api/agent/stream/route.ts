import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuthorizedUser } from "@/lib/auth/require-user";
import { readBoundedText, PayloadTooLargeError } from "@/lib/mcp/read-bounded";

/**
 * Agent streaming proxy — OpenClaw (preferred) or GLM, both OpenAI-compatible.
 *
 * Preferred backend is the user's OpenClaw gateway (chat.amrelharony.com),
 * which holds the GLM key server-side — so the toolkit needs NO separate
 * GLM/ZAI key once OPENCLAW_API_KEY is set. Falls back to a direct GLM key
 * (GLM_API_KEY / legacy ZAI_API_KEY) for back-compat.
 *
 * Runtime: Edge. GLM responses with function-calling routinely take
 * 5-20s per turn; 10s Node serverless cap on Vercel Hobby would cut
 * many off. Edge extends to 25s and supports streaming responses
 * natively via Web Streams. The tool-use loop itself happens in the
 * browser — multi-turn work isn't bounded by the per-turn cap.
 *
 * Edge-safe imports only: `requireAuthorizedUser` uses `next/headers`
 * cookies + `@supabase/ssr` createServerClient, both Edge-compatible.
 *
 * POST body shape (OpenAI / GLM chat completions):
 *   {
 *     model: string,
 *     messages: Array<OpenAIMessage>,
 *     tools?: Array<{type:"function", function:{...}}>,
 *     tool_choice?: "auto" | "none" | {type:"function", function:{name}},
 *     stream: true,
 *     max_tokens?: number,
 *   }
 *
 * If ZAI_API_KEY is set in the server env, we proxy directly to
 * api.z.ai/api/paas/v4/chat/completions and stream the raw SSE back.
 *
 * If ZAI_API_KEY is NOT set, we return 200 with `{"mode":"client"}`
 * so the browser falls back to its BYOK key (configured via the
 * AI Settings dialog as a GLM provider).
 *
 * GET returns the mode + the default model the server is using, so
 * the client doesn't have to guess.
 */

export const runtime = "edge";

// OpenClaw (the user's own OpenAI-compatible gateway) is the preferred backend;
// it proxies to GLM with the GLM key held server-side. Configure via
// OPENCLAW_API_KEY (+ optional OPENCLAW_URL / OPENCLAW_MODEL). When absent we
// fall back to a direct GLM key (open.bigmodel.cn) for back-compat; the legacy
// ZAI_* env names are still honoured.
const OPENCLAW_ENDPOINT =
  process.env.OPENCLAW_URL ?? "https://chat.amrelharony.com/v1/chat/completions";
const GLM_ENDPOINT = "https://open.bigmodel.cn/api/paas/v4/chat/completions";

interface Backend {
  key: string;
  endpoint: string;
  model: string;
  provider: "openclaw" | "glm";
}

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

/** Resolve the active server backend, preferring OpenClaw. null ⇒ BYOK client. */
function backend(): Backend | null {
  const oc = process.env.OPENCLAW_API_KEY;
  if (oc) {
    return {
      key: oc,
      endpoint: OPENCLAW_ENDPOINT,
      // OpenClaw exposes openclaw / openclaw-fast / openclaw-flash (it maps to
      // z.ai GLM-5 server-side). NOT the raw "zai glm-5.1" model id.
      model: process.env.OPENCLAW_MODEL ?? "openclaw",
      provider: "openclaw",
    };
  }
  const glm = process.env.GLM_API_KEY ?? process.env.ZAI_API_KEY;
  if (glm) {
    return {
      key: glm,
      endpoint: GLM_ENDPOINT,
      model: process.env.GLM_AGENT_MODEL ?? process.env.ZAI_AGENT_MODEL ?? "glm-4.5-flash",
      provider: "glm",
    };
  }
  return null;
}

export async function GET() {
  try {
    await requireAuthorizedUser();
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }
  const b = backend();
  return Response.json({
    mode: b ? "server" : "client",
    model: b?.model ?? null,
    provider: b?.provider ?? "openclaw",
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

  const be = backend();
  if (!be) {
    return Response.json({ mode: "client", provider: "openclaw" }, { status: 200 });
  }

  // Rate limit at TURN start only. The client flags round 0 with
  // `x-agent-new-turn`; a turn's later tool-use rounds pass through unmetered,
  // so one row ≈ one turn (not one POST). 429 short-circuits before we spend
  // any gateway tokens. Fail-open if the check is unavailable.
  let rate: RateLimit | null = null;
  if (req.headers.get("x-agent-new-turn") === "1") {
    rate = await checkRate(supabase);
    if (rate && !rate.allowed) {
      return Response.json(
        { error: "rate_limited", limits: rate },
        { status: 429, headers: { "retry-after": "3600", ...rateHeaders(rate) } }
      );
    }
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

  // Whitelist fields we forward — drop anything the client tried to
  // slip in (custom headers, model override beyond our env, etc.).
  // BUG-G12: don't forward `tools` from the client verbatim. A
  // compromised authenticated client could inject fake tool definitions
  // to influence the model's output. The agent's tool execution is
  // client-side and only resolves against the local registry, so the
  // upstream gets nothing useful from a server-built tools list either
  // — but at minimum we validate the shape strictly.
  const b = body as Record<string, unknown>;
  const forward: Record<string, unknown> = {
    model: be.model,
    stream: true,
    // GLM defaults to 1024 if omitted — bump for tool-use chains.
    // Number.isFinite rejects NaN/±Infinity (which `typeof === "number"`
    // alone lets through, forwarding `null` to the gateway).
    max_tokens: Number.isFinite(b.max_tokens)
      ? Math.min(8192, Math.max(64, Math.floor(b.max_tokens as number)))
      : 4096,
  };
  if (Array.isArray(b.messages)) forward.messages = b.messages;
  if (Array.isArray(b.tools)) {
    // Defensive shape check: each entry must be {type:"function", function:{name:string,...}}.
    const safe = b.tools.filter((t) => {
      if (!t || typeof t !== "object") return false;
      const tt = t as Record<string, unknown>;
      if (tt.type !== "function") return false;
      const fn = tt.function as Record<string, unknown> | undefined;
      return !!fn && typeof fn.name === "string" && fn.name.length > 0 && fn.name.length <= 128;
    });
    if (safe.length > 0) forward.tools = safe;
  }
  if (
    b.tool_choice === "auto" ||
    b.tool_choice === "none" ||
    b.tool_choice === "required" ||
    (typeof b.tool_choice === "object" && b.tool_choice !== null)
  ) {
    forward.tool_choice = b.tool_choice;
  }
  // GLM-specific: enable thinking trace. Validate the shape (boolean or
  // object) so the client can't pass arbitrary upstream parameters.
  // (BUG-G13)
  if (typeof b.thinking === "boolean") {
    forward.thinking = b.thinking;
  } else if (b.thinking && typeof b.thinking === "object" && !Array.isArray(b.thinking)) {
    forward.thinking = b.thinking;
  }

  // Propagate the client abort signal: if the browser tab closes mid-stream
  // we want to stop billing GLM for tokens the client will never read.
  const upstream = await fetch(be.endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${be.key}`,
    },
    body: JSON.stringify(forward),
    signal: req.signal,
  });

  if (!upstream.ok || !upstream.body) {
    let detail = "";
    try {
      detail = (await upstream.text()).slice(0, 300);
    } catch {
      /* ignore */
    }
    return Response.json(
      { error: "upstream", status: upstream.status, detail },
      // checkRate already recorded this turn's usage row before the upstream
      // fetch, so surface the X-RateLimit-* headers here too — otherwise a
      // failed turn (e.g. an OpenClaw 413) silently consumes quota without the
      // bar ever reflecting it.
      { status: upstream.status, headers: rate ? rateHeaders(rate) : undefined }
    );
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      ...(rate ? rateHeaders(rate) : {}),
    },
  });
}
