import type { NextRequest } from "next/server";
import { requireAuthorizedUser } from "@/lib/auth/require-user";

/**
 * Agent streaming proxy — GLM (z.ai, OpenAI-compatible).
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

// BUG-G3: point at the same GLM endpoint the BYOK client and LLM
// Settings dialog use (open.bigmodel.cn), so the user's GLM key from
// open.bigmodel.cn/usercenter/apikeys works against both. The legacy
// ZAI_* env names are still honoured for back-compat.
const GLM_ENDPOINT = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
const DEFAULT_MODEL = "glm-4.5-flash"; // free tier; override via GLM_AGENT_MODEL

function serverKey(): string | undefined {
  return process.env.GLM_API_KEY ?? process.env.ZAI_API_KEY;
}
function serverModel(): string {
  return process.env.GLM_AGENT_MODEL ?? process.env.ZAI_AGENT_MODEL ?? DEFAULT_MODEL;
}

export async function GET() {
  try {
    await requireAuthorizedUser();
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }
  const hasServerKey = !!serverKey();
  return Response.json({
    mode: hasServerKey ? "server" : "client",
    model: hasServerKey ? serverModel() : null,
    provider: "glm",
  });
}

export async function POST(req: NextRequest) {
  try {
    await requireAuthorizedUser();
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }

  const key = serverKey();
  if (!key) {
    return Response.json({ mode: "client", provider: "glm" }, { status: 200 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
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
    model: serverModel(),
    stream: true,
    // GLM defaults to 1024 if omitted — bump for tool-use chains.
    max_tokens:
      typeof b.max_tokens === "number"
        ? Math.min(8192, Math.max(64, Math.floor(b.max_tokens)))
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

  const upstream = await fetch(GLM_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(forward),
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
      { status: upstream.status }
    );
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
