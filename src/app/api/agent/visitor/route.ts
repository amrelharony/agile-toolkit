import type { NextRequest } from "next/server";
import {
  IDLE_TIMEOUT_MS,
  VISITOR_CALLER_NAME,
  buildUpstreamBody,
  fetchWithFirstByteTimeout,
  idleTimeoutStream,
  resolveVisitorBackend,
  upstreamHeaders,
} from "@/lib/agent/upstream";
import { readBoundedText, PayloadTooLargeError } from "@/lib/mcp/read-bounded";
import { clientIpOrNull, isSameOrigin, withinRateLimit } from "@/lib/server/public-guard";
import { getSquadAdminClient } from "@/lib/squads/server";
import { VISITOR_HEADERS, VISITOR_LIMITS, type VisitorErrorCode } from "@/lib/visitor-ai/contract";
import { meterVisitor, type MeterResult } from "@/lib/visitor-ai/meter";
import { buildVisitorSystemPrompt } from "@/lib/visitor-ai/prompt";
import { parseVisitorBody } from "@/lib/visitor-ai/request";
import { cairoDay, ipBucket, visitorKey } from "@/lib/visitor-ai/visitor-key";

/**
 * POST /api/agent/visitor: Amr's AI for signed-out visitors.
 *
 * Reachable without a session through an exact-match middleware bypass. The
 * browser runs the tool loop (its tools act on the visitor's own data, in
 * their browser) and posts the conversation here; this route adds the
 * server's own system prompt and forwards it to the owner's OpenClaw gateway
 * on VISITOR_AI_MODEL, streaming the answer back. The browser never chooses
 * the model, the prompt, max_tokens or the reasoning effort.
 *
 * In order, each step refusing with `{ error: code }` (codes in
 * lib/visitor-ai/contract.ts):
 *   1. Kill switch: VISITOR_AI_ENABLED=1 and OPENCLAW_API_KEY, else 503 disabled.
 *   2. Same site only, else 403 forbidden.
 *   3. Burst brake: 30 requests a minute per address (a whole IPv6 /64 is
 *      one address here, as in the meter) and instance, else 429 slow_down.
 *   4. Body cap of 256 KiB, else 413 too_large.
 *   5. parseVisitorBody rebuilds the body from allowed fields, else 400
 *      bad_request (or round_limit after 5 tool rounds).
 *   6. The daily visitor code (visitor-key.ts) from the address and
 *      VISITOR_AI_HASH_SECRET. No secret, or no address in production, is
 *      503 meter_unavailable.
 *   7. The meter (visitor_ai_meter, migration 0037) checks the limits in
 *      visitor_ai_config and counts the request: every request is a call, a
 *      new visitor message also a turn. No database, an error or a timeout is
 *      503 meter_unavailable (fails closed); a limit is 429 with its code, or
 *      503 disabled when the config row switches visitors off.
 *   8. The upstream call: no response within 30 s is 504 timeout; the
 *      gateway's 429 / 5xx, or no answer at all, is 503 upstream_busy; any
 *      other error 502 upstream_error. Once streaming, 30 s without a chunk
 *      ends the stream.
 * Every answer after the meter carries the quota headers (VISITOR_HEADERS).
 *
 * Privacy: the address is used for the burst brake (in memory) and the
 * visitor code, and is never stored or logged. Logs carry status codes only,
 * never message text, an address or a code. No cookie is read or set.
 *
 * Runs on Node (node:crypto for the HMAC, the service-role client), with
 * maxDuration 60 s for a long reasoning answer.
 */

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Room for the most the browser may send (test/api/agent-visitor-route.test.ts
 * checks it): VISITOR_LIMITS.totalChars of text at up to 3 bytes each in UTF-8
 * (144,000 bytes for Chinese or Japanese), plus 24 tool schemas (the 24
 * biggest come to about 68 KB) and the JSON around them. 192 KiB was too
 * small for that. What goes on to the gateway is smaller again: parseVisitorBody
 * keeps the tools within REQUEST_LIMITS.toolsJsonBytes.
 */
const MAX_BODY_BYTES = 256 * 1024;
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;
/** Reply plus reasoning. */
const MAX_TOKENS = 4096;
/** No response headers within this long ⇒ 504 (Node has room for 30 s, unlike Edge's 25 s start). */
const FIRST_BYTE_TIMEOUT_MS = 30_000;
/** The visitor bucket used when a dev server sees no address. */
const LOCAL_IP = "127.0.0.1";

const NO_STORE = { "cache-control": "no-store" };

function refuse(
  status: number,
  error: VisitorErrorCode,
  headers: Record<string, string> = {}
): Response {
  return Response.json({ error }, { status, headers: { ...NO_STORE, ...headers } });
}

/** The quota headers for one meter answer. */
function quotaHeaders(m: MeterResult): Record<string, string> {
  const headers: Record<string, string> = {
    [VISITOR_HEADERS.remaining]: String(Math.max(0, m.turnsMax - m.turnsUsed)),
    [VISITOR_HEADERS.limit]: String(m.turnsMax),
    [VISITOR_HEADERS.peak]: m.peak ? "1" : "0",
    [VISITOR_HEADERS.peakLimit]: String(m.peakTurnsMax),
  };
  if (m.peak) {
    headers[VISITOR_HEADERS.peakRemaining] = String(Math.max(0, m.peakTurnsMax - m.peakTurnsUsed));
    if (m.peakEndsAt) headers[VISITOR_HEADERS.peakEnds] = m.peakEndsAt;
  }
  return headers;
}

export async function POST(req: NextRequest) {
  const backend = resolveVisitorBackend();
  if (!backend) return refuse(503, "disabled");
  if (!isSameOrigin(req)) return refuse(403, "forbidden");
  if (!withinRateLimit(req, "visitor-ai", RATE_LIMIT, RATE_WINDOW_MS, ipBucket)) {
    return refuse(429, "slow_down", { "retry-after": "60" });
  }

  let raw: unknown;
  try {
    raw = JSON.parse(await readBoundedText(req, MAX_BODY_BYTES));
  } catch (err) {
    if (err instanceof PayloadTooLargeError) return refuse(413, "too_large");
    return refuse(400, "bad_request");
  }
  const parsed = parseVisitorBody(raw);
  if (!parsed.ok) return refuse(400, parsed.error);
  const body = parsed.body;

  const ip = clientIpOrNull(req) ?? (process.env.NODE_ENV === "production" ? null : LOCAL_IP);
  const key = ip ? visitorKey(ip, cairoDay(), process.env.VISITOR_AI_HASH_SECRET) : null;
  if (!key) {
    console.warn("[visitor-ai] 503 meter_unavailable: no visitor code");
    return refuse(503, "meter_unavailable");
  }

  const admin = getSquadAdminClient();
  const meter = admin ? await meterVisitor(admin, key, body.newTurn) : null;
  if (!meter) {
    console.warn("[visitor-ai] 503 meter_unavailable");
    return refuse(503, "meter_unavailable");
  }
  const quota = quotaHeaders(meter);
  if (!meter.allowed) {
    const reason = meter.reason ?? "site_busy";
    return refuse(reason === "disabled" ? 503 : 429, reason, quota);
  }

  const system = await buildVisitorSystemPrompt({ toolId: body.toolId, query: body.lastUserText });
  const forward = buildUpstreamBody(
    {
      messages: [{ role: "system", content: system }, ...body.messages],
      tools: body.tools,
      max_tokens: MAX_TOKENS,
      reasoning_effort: meter.reasoningEffort,
    },
    backend,
    { maxTools: VISITOR_LIMITS.maxTools }
  );

  // One controller for the upstream call: the visitor closing the tab aborts
  // it (nobody reads the tokens), and so do both timeouts.
  const upstreamAbort = new AbortController();
  if (req.signal?.aborted) upstreamAbort.abort();
  else req.signal?.addEventListener("abort", () => upstreamAbort.abort(), { once: true });

  // X-Caller is the visitors' own (VISITOR_CALLER_NAME), never the owner's, so
  // the gateway's nginx rate-limits visitors apart from the owner's agent.
  const result = await fetchWithFirstByteTimeout(
    backend.url,
    {
      method: "POST",
      headers: upstreamHeaders(backend, VISITOR_CALLER_NAME),
      body: JSON.stringify(forward),
    },
    { controller: upstreamAbort, timeoutMs: FIRST_BYTE_TIMEOUT_MS }
  );

  if (!result.ok) {
    if (result.reason === "aborted") return new Response(null, { status: 499 });
    if (result.reason === "timeout") {
      console.warn("[visitor-ai] 504 timeout");
      return refuse(504, "timeout", quota);
    }
    console.warn("[visitor-ai] 503 upstream_busy: unreachable");
    return refuse(503, "upstream_busy", quota);
  }

  const upstream = result.response;
  if (!upstream.ok || !upstream.body) {
    // Never forwarded or logged: the gateway's error text could echo the request.
    upstream.body?.cancel().catch(() => {});
    console.warn(`[visitor-ai] upstream answered ${upstream.status}`);
    if (upstream.status === 429 || upstream.status >= 500) {
      return refuse(503, "upstream_busy", quota);
    }
    return refuse(502, "upstream_error", quota);
  }

  const idle = idleTimeoutStream(upstream.body, IDLE_TIMEOUT_MS, () => upstreamAbort.abort());
  req.signal?.addEventListener("abort", idle.stop, { once: true });

  return new Response(idle.stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
      ...quota,
    },
  });
}
