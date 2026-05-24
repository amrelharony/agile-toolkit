import { registry } from "@/lib/actions/registry";
import { makeContext } from "@/lib/actions/context";

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

export async function handleJsonRpc(
  request: JsonRpcRequest,
  userId: string
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
      const ctx = makeContext(userId, "mcp");
      // C1: dispatch to mcpHandler if the action defined one — it reads/
      // writes Supabase directly via server-store.ts. Without it, the
      // fallback `handler` operates on the empty server-side Zustand
      // singleton and silently no-ops for the real user.
      const fn = action.mcpHandler ?? action.handler;
      // Wrap handler call so semantic failures surface as isError:true in
      // the content block rather than -32603 internal errors. MCP clients
      // distinguish these.
      let payload: unknown;
      let isError = false;
      try {
        payload = await fn(parsed.data, ctx);
      } catch (err) {
        isError = true;
        payload = { error: err instanceof Error ? err.message : String(err) };
      }
      let text: string;
      try {
        text = typeof payload === "string" ? payload : JSON.stringify(payload);
      } catch {
        // Circular reference or non-serialisable result.
        text = `[unserialisable result from ${name}]`;
        isError = true;
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
    const msg = err instanceof Error ? err.message : String(err);
    return jsonRpcError(id, -32603, `Internal error: ${msg}`);
  }
}

function jsonRpcError(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
