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
const URL_BASE = (process.env.AGILE_TOOLKIT_URL ?? "https://agile.amrelharony.com").replace(
  /\/+$/,
  ""
);

if (!PAT) {
  process.stderr.write(
    "[agile-toolkit-mcp] missing AGILE_TOOLKIT_PAT env var. Mint a PAT at <your-app>/settings/access-tokens and set it.\n"
  );
  process.exit(1);
}

const ENDPOINT = `${URL_BASE}/api/mcp`;
const FETCH_TIMEOUT_MS = 30_000;
const MAX_BUFFER_BYTES = 1_048_576; // 1 MiB — generous for any sane JSON-RPC line

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
  // Notifications (no id) must never receive a response per JSON-RPC. If the
  // upstream call fails we log to stderr but emit nothing to stdout, otherwise
  // we'd write an unsolicited `{id:null,error}` the client never asked for and
  // strict MCP clients reject.
  const isNotification = request.id === undefined || request.id === null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${PAT}`,
      },
      body: JSON.stringify(request),
      signal: controller.signal,
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
      if (isNotification) {
        process.stderr.write(
          `[agile-toolkit-mcp] notification ${request.method} got HTTP ${response.status}; suppressing response\n`
        );
        return null;
      }
      return rpcError(request.id ?? null, -32000, `HTTP ${response.status}: ${text.slice(0, 200)}`);
    }

    return (await response.json()) as JsonRpcResponse;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isNotification) {
      process.stderr.write(
        `[agile-toolkit-mcp] notification ${request.method} failed (${msg}); suppressing response\n`
      );
      return null;
    }
    if (controller.signal.aborted) {
      return rpcError(request.id ?? null, -32000, `Request timed out after ${FETCH_TIMEOUT_MS}ms`);
    }
    return rpcError(request.id ?? null, -32000, `Network error: ${msg}`);
  } finally {
    clearTimeout(timer);
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
  // Cap the buffer to prevent unbounded growth if upstream sends a single
  // huge line without newlines. Anything past the cap is dropped and we
  // emit a stderr warning.
  if (buffer.length > MAX_BUFFER_BYTES) {
    process.stderr.write(
      `[agile-toolkit-mcp] dropped ${buffer.length} bytes (no newline within ${MAX_BUFFER_BYTES})\n`
    );
    buffer = "";
    return;
  }
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
    void forward(request)
      .then((resp) => {
        if (resp) write(resp);
      })
      .catch((err) => {
        // Defensive: forward() should always resolve to a JsonRpcResponse
        // via its internal try/catch, but a bug there would otherwise
        // surface as an unhandled rejection.
        process.stderr.write(
          `[agile-toolkit-mcp] forward rejected: ${err instanceof Error ? err.message : String(err)}\n`
        );
      });
  }
});

process.stdin.on("end", () => {
  process.exit(0);
});

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
