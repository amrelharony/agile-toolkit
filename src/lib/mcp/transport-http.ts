import { registry } from "@/lib/actions/registry";
import { makeContext } from "@/lib/actions/context";
import { runWithScope } from "@/lib/actions/scope-context";

/**
 * Minimal MCP HTTP transport — implements the subset of JSON-RPC 2.0
 * methods Claude Desktop / Claude Code call:
 *
 *   initialize        — protocol handshake
 *   tools/list        — enumerate available tools
 *   tools/call        — invoke a tool by name + arguments
 *   notifications/initialized — client → server "ready" notification (no response)
 *
 * Anything else returns the JSON-RPC `-32601 method not found` error.
 *
 * Auth happens BEFORE this transport runs — the route handler verifies
 * the bearer PAT and supplies the `userId` for the action context.
 */

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const PROTOCOL_VERSION = "2024-11-05";

/** Emitted once per `tools/call` for observability. The transport stays
 *  DB-free — the route supplies a callback that persists these. */
export interface McpCallObservation {
  actionId: string;
  ms: number;
  isError: boolean;
}

export async function handleJsonRpc(
  request: JsonRpcRequest,
  userId: string,
  squadProfileIds: readonly string[] = [],
  onCall?: (obs: McpCallObservation) => void
): Promise<JsonRpcResponse | null> {
  // Notifications (no id, no response).
  if (request.id === undefined || request.id === null) {
    // notifications/initialized is the only one we care about — silently
    // ack. Other notifications (cancelled, progress) are ignored.
    return null;
  }

  const id = request.id;
  const method = request.method;

  try {
    if (method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {
            tools: { listChanged: false },
          },
          serverInfo: {
            name: "agile-toolkit",
            version: "0.1.0",
          },
        },
      };
    }

    if (method === "tools/list") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: registry.toMcpTools(),
        },
      };
    }

    if (method === "tools/call") {
      const params = (request.params ?? {}) as {
        name?: string;
        arguments?: Record<string, unknown>;
      };
      if (typeof params.name !== "string") {
        return jsonRpcError(id, -32602, "Missing tool name");
      }
      const name = params.name;
      const action = registry.resolve(name);
      if (!action) {
        return jsonRpcError(id, -32601, `Unknown tool: ${name}`);
      }
      const safeParse = (
        action.paramsSchema as {
          safeParse?: (v: unknown) => {
            success: boolean;
            data?: unknown;
            error?: { message: string };
          };
        }
      ).safeParse;
      if (typeof safeParse !== "function") {
        // Defensive: an action was registered with a non-Zod schema.
        return jsonRpcError(id, -32603, `Tool ${name} has an invalid schema.`);
      }
      const parsed = safeParse.call(action.paramsSchema, params.arguments ?? {});
      if (!parsed.success) {
        return jsonRpcError(
          id,
          -32602,
          `Invalid arguments: ${parsed.error?.message ?? "schema violation"}`
        );
      }
      const ctx = makeContext(userId, "mcp", undefined, squadProfileIds);
      // C1: dispatch to mcpHandler if the action defined one — it reads/
      // writes Supabase directly via server-store.ts. Without it, the
      // fallback `handler` operates on the empty server-side Zustand
      // singleton and silently no-ops for the real user.
      const fn = action.mcpHandler ?? action.handler;
      // Wrap handler call so semantic failures surface as isError:true in
      // the content block rather than -32603 internal errors. MCP clients
      // distinguish these.
      const startedAt = Date.now();
      let payload: unknown;
      let isError = false;
      try {
        // Run the handler inside the squad-scope frame so server-store's
        // read/write helpers enforce the PAT's scope (migration 0024) across
        // every Supabase call the handler makes. An empty scope (unscoped PAT /
        // owner) is a no-op — server-store behaves exactly as before.
        payload = await runWithScope(ctx.squadProfileIds, () => fn(parsed.data, ctx));
      } catch (err) {
        isError = true;
        // Surface the message of intentional handler errors (a plain Error,
        // e.g. "risk … not found") — these are semantic and help the agent.
        // Anything else (notably raw Supabase/Postgrest error objects, which
        // are NOT Error instances and carry schema details / constraint codes)
        // is logged server-side and replaced with a generic message, matching
        // the scrubbing policy the access-tokens route already enforces.
        if (!(err instanceof Error)) {
          // eslint-disable-next-line no-console
          console.error(`[mcp/tools-call] ${name} threw a non-Error:`, err);
        }
        payload = { error: err instanceof Error ? err.message : "internal tool error" };
      }
      let text: string;
      try {
        // JSON.stringify returns `undefined` (NOT a string) for undefined,
        // functions, and symbols. A handler that resolves to void would then
        // emit `content: [{ type: "text", text: undefined }]`, which drops
        // `text` on serialisation — an invalid MCP text-content block. Coerce
        // such results to "null" so `text` is always a string.
        text = typeof payload === "string" ? payload : (JSON.stringify(payload) ?? "null");
      } catch {
        // Circular reference or non-serialisable result.
        text = `[unserialisable result from ${name}]`;
        isError = true;
      }
      // Observability: emit per-call timing + outcome. Best-effort — the
      // callback (DB write) is the route's concern and must never throw here.
      if (onCall) {
        try {
          onCall({ actionId: action.id, ms: Date.now() - startedAt, isError });
        } catch {
          /* never let logging break a tool call */
        }
      }
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text }],
          isError,
        },
      };
    }

    return jsonRpcError(id, -32601, `Method not found: ${method}`);
  } catch (err) {
    // Unexpected failure in dispatch itself (not a handler-thrown error, which
    // is caught above). Log the full detail server-side; return a bounded
    // message so internal/DB details never leak to the client.
    // eslint-disable-next-line no-console
    console.error(`[mcp/transport] ${method} failed:`, err);
    const msg = err instanceof Error ? err.message : "internal error";
    return jsonRpcError(id, -32603, `Internal error: ${msg}`);
  }
}

function jsonRpcError(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
