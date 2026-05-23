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
      const params = (request.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
      if (typeof params.name !== "string") {
        return jsonRpcError(id, -32602, "Missing tool name");
      }
      const name = params.name;
      const action = registry.resolve(name);
      if (!action) {
        return jsonRpcError(id, -32601, `Unknown tool: ${name}`);
      }
      const parsed = (action.paramsSchema as { safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: { message: string } } }).safeParse(params.arguments ?? {});
      if (!parsed.success) {
        return jsonRpcError(id, -32602, `Invalid arguments: ${parsed.error?.message ?? "schema violation"}`);
      }
      const ctx = makeContext(userId, "mcp");
      const result = await action.handler(parsed.data, ctx);
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: typeof result === "string" ? result : JSON.stringify(result),
            },
          ],
          isError: false,
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
