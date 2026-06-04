import type { NextRequest } from "next/server";
import {
  handleJsonRpc,
  type JsonRpcRequest,
  type McpCallObservation,
} from "@/lib/mcp/transport-http";
import { verifyBearer } from "@/lib/mcp/pat";
import { registry } from "@/lib/actions/registry";
import { tryConsume, rateCategoryForAction, type RateCategory } from "@/lib/mcp/rate-limit";
import { buildCallLogRow, logMcpCalls } from "@/lib/mcp/call-log";
import { readBoundedText, PayloadTooLargeError } from "@/lib/mcp/read-bounded";

// Ensure register-all runs in this runtime so the registry is populated
// when an MCP request lands here without ever rendering the client.
import "@/lib/actions/register-all";

/**
 * Map one JSON-RPC request to the rate-limit category it consumes. Only
 * `tools/call` is categorised by the resolved action (read / write /
 * intent); handshake + discovery methods (initialize, tools/list,
 * notifications) are cheap reads. An unknown tool name is treated as a read
 * so a typo doesn't burn the scarcer write/intent budget — it errors in the
 * handler regardless.
 */
function categoryForRequest(req: JsonRpcRequest): RateCategory {
  if (req.method !== "tools/call") return "read";
  const name = (req.params as { name?: string } | undefined)?.name;
  if (typeof name !== "string") return "read";
  const action = registry.resolve(name);
  return action ? rateCategoryForAction(action) : "read";
}

/**
 * MCP HTTP transport.
 *
 * Auth: `Authorization: Bearer pat_…` only. The bearer is a Personal
 * Access Token minted in /settings/access-tokens. Supabase sessions are
 * intentionally NOT accepted here — different trust model, different
 * audit trail.
 *
 * Body: JSON-RPC 2.0. See `src/lib/mcp/transport-http.ts` for supported
 * methods.
 *
 * GET: returns metadata for discovery without a bearer. Useful for
 * configuring the stdio relay.
 */

export async function GET() {
  return Response.json({
    server: "agile-toolkit-mcp",
    protocolVersion: "2024-11-05",
    transport: "http",
  });
}

export async function POST(req: NextRequest) {
  const bearer = extractBearer(req.headers.get("authorization"));
  if (!bearer) {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32001, message: "Missing or invalid Authorization bearer." },
      }),
      { status: 401, headers: { "content-type": "application/json" } }
    );
  }

  const auth = await verifyBearer(bearer);
  if (!auth) {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32001, message: "Invalid or revoked PAT." },
      }),
      { status: 401, headers: { "content-type": "application/json" } }
    );
  }

  // Rate limiting is applied AFTER the body is parsed (below) so it can be
  // split by action category — reads, writes, and intents have different
  // ceilings. The body-size + batch caps already protect the parse step.

  // Bound the incoming body. JSON-RPC payloads for our toolset are tiny
  // (≪10kB even with large argument blobs); a megabyte is more headroom
  // than any well-behaved client will ever need. Without this, a token
  // holder with a buggy or malicious client can stream multi-MB JSON at
  // a serverless function, forcing it to buffer the body before parsing.
  const MAX_BODY_BYTES = 1_048_576; // 1 MiB
  // Cheap fast-path: reject early when the client advertises an oversize
  // body. This is only a hint — a client can lie or omit Content-Length
  // (chunked transfer-encoding), so the authoritative cap is enforced while
  // streaming the body below via readBoundedText.
  const lenHeader = req.headers.get("content-length");
  if (lenHeader) {
    const len = Number(lenHeader);
    if (Number.isFinite(len) && len > MAX_BODY_BYTES) {
      return Response.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32600, message: "Request body too large" },
        },
        { status: 413 }
      );
    }
  }
  let body: unknown;
  try {
    // Enforce the byte cap WHILE reading, independent of Content-Length, so a
    // header-less/chunked oversize payload can't force unbounded buffering.
    body = JSON.parse(await readBoundedText(req, MAX_BODY_BYTES));
  } catch (err) {
    if (err instanceof PayloadTooLargeError) {
      return Response.json(
        { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request body too large" } },
        { status: 413 }
      );
    }
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { status: 400 }
    );
  }

  // Single request or batch — MCP servers should handle both. Reject
  // anything that isn't an object or an array of objects with -32600
  // Invalid Request rather than silently 204-ing.
  const isObj = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);
  // Cap batch size: each handler may fan out to a Supabase query, so a
  // 10k-element batch (well within the 1 MiB body cap) spawns 10k parallel
  // queries via Promise.all below — enough to OOM a small serverless
  // instance even though the rate limiter only deducted one token.
  const MAX_BATCH = 100;
  if (Array.isArray(body)) {
    if (body.length === 0 || !body.every(isObj)) {
      return Response.json(
        { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } },
        { status: 400 }
      );
    }
    if (body.length > MAX_BATCH) {
      return Response.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32600, message: `Batch too large (max ${MAX_BATCH})` },
        },
        { status: 413 }
      );
    }
  } else if (!isObj(body)) {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } },
      { status: 400 }
    );
  }

  const requests: JsonRpcRequest[] = Array.isArray(body)
    ? (body as unknown as JsonRpcRequest[])
    : [body as unknown as JsonRpcRequest];

  // Per-category rate limit: tally how many reads / writes / intents this
  // request (or batch) consumes, then atomically charge each category's
  // bucket. A batch is rejected as a whole if any single category is over
  // its limit (nothing is charged in that case).
  const counts: Partial<Record<RateCategory, number>> = {};
  for (const r of requests) {
    const cat = categoryForRequest(r);
    counts[cat] = (counts[cat] ?? 0) + 1;
  }
  const limit = tryConsume(auth.tokenId, counts);
  if (!limit.ok) {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32002,
          message: `Rate limit exceeded — max ${limit.limit} ${limit.category} requests/min per token.`,
        },
      }),
      {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "60" },
      }
    );
  }

  // Collect per-call observations during dispatch, then persist them.
  const observations: McpCallObservation[] = [];
  const responses = await Promise.all(
    requests.map((r) =>
      handleJsonRpc(r, auth.userId, auth.squadProfileIds, (obs) => observations.push(obs))
    )
  );

  // Observability: best-effort write to mcp_call_log. logMcpCalls never
  // throws (swallows DB errors, no-ops without service-role env), so this
  // can't affect the response — we await only to flush before the
  // serverless function freezes.
  if (observations.length > 0) {
    await logMcpCalls(
      observations.map((o) => buildCallLogRow(o, auth.userId, auth.squadProfileIds))
    );
  }

  const filtered = responses.filter((r): r is NonNullable<typeof r> => r !== null);

  // Notifications-only batch returns 204 No Content per JSON-RPC spec.
  if (filtered.length === 0) {
    return new Response(null, { status: 204 });
  }

  return Response.json(Array.isArray(body) ? filtered : filtered[0]);
}

function extractBearer(header: string | null): string | null {
  if (!header) return null;
  const m = header.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : null;
}
