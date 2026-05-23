#!/usr/bin/env node

/**
 * Agile Toolkit MCP stdio relay.
 *
 * Reads JSON-RPC messages from stdin (newline-delimited), POSTs each to
 * the deployed Agile Toolkit's HTTP MCP endpoint with the configured
 * PAT, and writes the response to stdout.
 *
 * This is a PURE RELAY: it doesn't know what an action is, what the
 * tool list looks like, or how the toolkit's state is structured.
 * The action set always matches whatever the deployed server exposes
 * — no version skew possible between this binary and the live registry.
 *
 * Env:
 *   AGILE_TOOLKIT_PAT  — bearer token minted at /settings/access-tokens
 *   AGILE_TOOLKIT_URL  — base URL of the deployed app
 *                        (default: https://agile.amrelharony.com)
 *
 * Errors are logged to stderr (which Claude Desktop displays in its
 * developer console) and result in a JSON-RPC error response if a
 * request id was present.
 */

const PAT = process.env.AGILE_TOOLKIT_PAT;
const URL_BASE = (process.env.AGILE_TOOLKIT_URL ?? "https://agile.amrelharony.com").replace(/\/+$/, "");

if (!PAT) {
  process.stderr.write(
    "[agile-toolkit-mcp] missing AGILE_TOOLKIT_PAT env var. Mint a PAT at <your-app>/settings/access-tokens and set it.\n"
  );
  process.exit(1);
}

const ENDPOINT = `${URL_BASE}/api/mcp`;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

async function forward(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${PAT}`,
      },
      body: JSON.stringify(request),
    });

    // 204 = notification ack; nothing to forward back to stdout.
    if (response.status === 204) return null;

    if (!response.ok) {
      // Try to parse a JSON-RPC error body; otherwise synthesise one.
      const text = await response.text().catch(() => "");
      try {
        const parsed = JSON.parse(text) as JsonRpcResponse;
        if (parsed && parsed.jsonrpc === "2.0") return parsed;
      } catch {
        /* fall through */
      }
      return rpcError(request.id ?? null, -32000, `HTTP ${response.status}: ${text.slice(0, 200)}`);
    }

    return (await response.json()) as JsonRpcResponse;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return rpcError(request.id ?? null, -32000, `Network error: ${msg}`);
  }
}

function rpcError(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function write(msg: JsonRpcResponse): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

// Buffer stdin and parse newline-delimited JSON.
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  let idx: number;
  while ((idx = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let request: JsonRpcRequest;
    try {
      request = JSON.parse(line) as JsonRpcRequest;
    } catch {
      process.stderr.write(`[agile-toolkit-mcp] dropped malformed line\n`);
      continue;
    }
    void forward(request).then((resp) => {
      if (resp) write(resp);
    });
  }
});

process.stdin.on("end", () => {
  process.exit(0);
});

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
