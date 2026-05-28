import type { NextRequest } from "next/server";
import { handleJsonRpc, type JsonRpcRequest } from "@/lib/mcp/transport-http";
import { verifyBearer } from "@/lib/mcp/pat";

// Ensure register-all runs in this runtime so the registry is populated
// when an MCP request lands here without ever rendering the client.
import "@/lib/actions/register-all";

/**
 * Per-token rate limit. In-memory token bucket — instance-local, so the
 * effective ceiling on a multi-instance deploy is `LIMIT × instances`.
 * That's fine for the threat we care about (a runaway agent burning
 * Supabase quota or LLM tokens); strict global enforcement would need
 * Redis/Upstash and isn't worth the dependency for a single-user toolkit.
 *
 * Bucket refills lazily on each call rather than on a setInterval — no
 * dangling timers when the route module unloads.
 */
const RATE_LIMIT_PER_MIN = 120;
const REFILL_INTERVAL_MS = 60_000;
const MAX_BUCKET_ENTRIES = 1000;
const bucket = new Map<string, { tokens: number; updated: number }>();

/** Drop bucket entries older than 5 × the refill window when the map
 *  exceeds MAX_BUCKET_ENTRIES. Defensive against unbounded memory growth
 *  on a long-lived instance — every distinct PAT that ever called sticks
 *  around otherwise. */
function pruneBucket(now: number): void {
  if (bucket.size <= MAX_BUCKET_ENTRIES) return;
  const cutoff = now - 5 * REFILL_INTERVAL_MS;
  bucket.forEach((v, k) => {
    if (v.updated < cutoff) bucket.delete(k);
  });
}

function consumeToken(tokenId: string): boolean {
  const now = Date.now();
  pruneBucket(now);
  const entry = bucket.get(tokenId);
  if (!entry) {
    bucket.set(tokenId, { tokens: RATE_LIMIT_PER_MIN - 1, updated: now });
    return true;
  }
  const elapsed = now - entry.updated;
  if (elapsed >= REFILL_INTERVAL_MS) {
    bucket.set(tokenId, { tokens: RATE_LIMIT_PER_MIN - 1, updated: now });
    return true;
  }
  // Partial refill proportional to elapsed time — smoother than hard
  // reset-at-window-end which lets a client burn the full quota in a
  // sub-second burst.
  const refill = Math.floor((elapsed / REFILL_INTERVAL_MS) * RATE_LIMIT_PER_MIN);
  const tokens = Math.min(RATE_LIMIT_PER_MIN, entry.tokens + refill);
  if (tokens <= 0) {
    return false;
  }
  bucket.set(tokenId, { tokens: tokens - 1, updated: now });
  return true;
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

  if (!consumeToken(auth.tokenId)) {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32002,
          message: `Rate limit exceeded — max ${RATE_LIMIT_PER_MIN} requests/min per token.`,
        },
      }),
      {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "60" },
      }
    );
  }

  // Bound the incoming body. JSON-RPC payloads for our toolset are tiny
  // (≪10kB even with large argument blobs); a megabyte is more headroom
  // than any well-behaved client will ever need. Without this, a token
  // holder with a buggy or malicious client can stream multi-MB JSON at
  // a serverless function, forcing it to buffer the body before parsing.
  const MAX_BODY_BYTES = 1_048_576; // 1 MiB
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
    body = await req.json();
  } catch {
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

  const responses = await Promise.all(
    requests.map((r) => handleJsonRpc(r, auth.userId, auth.squadProfileIds))
  );
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
