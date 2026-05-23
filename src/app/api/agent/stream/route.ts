import type { NextRequest } from "next/server";
import { requireAuthorizedUser } from "@/lib/auth/require-user";

/**
 * Agent streaming proxy.
 *
 * POST body shape (subset of Anthropic Messages API):
 *   {
 *     model: string,
 *     messages: Array<{role, content}>,
 *     system: string,
 *     tools: Array<{name, description, input_schema}>,
 *     max_tokens: number,
 *   }
 *
 * If ANTHROPIC_API_KEY is set in the server env, we proxy directly to
 * Anthropic and stream the raw SSE back. The client gets the same wire
 * format whether the call originated here or directly from the browser.
 *
 * If ANTHROPIC_API_KEY is NOT set, we return 200 with
 * `{"mode":"client"}` so the browser falls back to its BYOK key.
 *
 * GET returns the mode without making any LLM call — convenience for
 * the client to know which transport to use before sending a message.
 */

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export async function GET() {
  // Re-use the same auth gate so an unauthenticated probe gets 401.
  try {
    await requireAuthorizedUser();
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }
  const mode = process.env.ANTHROPIC_API_KEY ? "server" : "client";
  return Response.json({ mode });
}

export async function POST(req: NextRequest) {
  try {
    await requireAuthorizedUser();
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }

  const serverKey = process.env.ANTHROPIC_API_KEY;
  if (!serverKey) {
    return Response.json({ mode: "client" }, { status: 200 });
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

  // Whitelist fields we forward to Anthropic — drop anything else the
  // client tried to slip in (custom headers, system_override, etc.).
  const b = body as Record<string, unknown>;
  const forward: Record<string, unknown> = {
    model: typeof b.model === "string" ? b.model : "claude-opus-4-7",
    max_tokens: typeof b.max_tokens === "number" ? Math.min(8192, Math.max(64, Math.floor(b.max_tokens))) : 2048,
    stream: true,
  };
  if (Array.isArray(b.messages)) forward.messages = b.messages;
  if (typeof b.system === "string") forward.system = b.system;
  if (Array.isArray(b.tools)) forward.tools = b.tools;
  if (b.tool_choice && typeof b.tool_choice === "object") forward.tool_choice = b.tool_choice;

  const upstream = await fetch(ANTHROPIC_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": serverKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(forward),
  });

  if (!upstream.ok || !upstream.body) {
    // Map common upstream errors to short codes the client can surface.
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

  // Stream the SSE response straight through. Preserve the content-type
  // so the browser's EventSource-like parser still treats it as SSE.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
