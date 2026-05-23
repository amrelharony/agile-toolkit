import type { NextRequest } from "next/server";
import { handleJsonRpc, type JsonRpcRequest } from "@/lib/mcp/transport-http";
import { verifyBearer } from "@/lib/mcp/pat";

// Ensure register-all runs in this runtime so the registry is populated
// when an MCP request lands here without ever rendering the client.
import "@/lib/actions/register-all";

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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { status: 400 }
    );
  }

  // Single request or batch — MCP servers should handle both.
  const requests: JsonRpcRequest[] = Array.isArray(body)
    ? (body as JsonRpcRequest[])
    : [body as JsonRpcRequest];

  const responses = await Promise.all(
    requests.map((r) => handleJsonRpc(r, auth.userId))
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
