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

const ZAI_ENDPOINT = "https://api.z.ai/api/paas/v4/chat/completions";
const DEFAULT_MODEL = "glm-4.5-flash"; // free tier; override via ZAI_AGENT_MODEL

function serverModel(): string {
  return process.env.ZAI_AGENT_MODEL || DEFAULT_MODEL;
}

export async function GET() {
  try {
    await requireAuthorizedUser();
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }
  const hasServerKey = !!process.env.ZAI_API_KEY;
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

  const serverKey = process.env.ZAI_API_KEY;
  if (!serverKey) {
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
  const b = body as Record<string, unknown>;
  const forward: Record<string, unknown> = {
    model: serverModel(),
    stream: true,
    // GLM defaults to 1024 if omitted — bump for tool-use chains.
    max_tokens: typeof b.max_tokens === "number"
      ? Math.min(8192, Math.max(64, Math.floor(b.max_tokens)))
      : 4096,
  };
  if (Array.isArray(b.messages)) forward.messages = b.messages;
  if (Array.isArray(b.tools)) forward.tools = b.tools;
  if (b.tool_choice !== undefined) forward.tool_choice = b.tool_choice;
  // GLM-specific: enable thinking trace. Returned in `reasoning_content`
  // deltas; the client orchestrator ignores them (not part of the
  // transcript), but it doesn't hurt to pass through.
  if (b.thinking !== undefined) forward.thinking = b.thinking;

  const upstream = await fetch(ZAI_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${serverKey}`,
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
