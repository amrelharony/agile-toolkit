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

// Refuse to send the bearer PAT over plaintext HTTP. The default is HTTPS, but
// a misconfigured AGILE_TOOLKIT_URL would otherwise leak the token in the
// Authorization header to any network observer. localhost dev URLs are exempt.
function parseBaseUrl(raw: string): URL {
  try {
    return new URL(raw);
  } catch {
    process.stderr.write(`[agile-toolkit-mcp] invalid AGILE_TOOLKIT_URL: ${raw}\n`);
    process.exit(1);
  }
}
const PARSED_URL = parseBaseUrl(URL_BASE);
if (
  PARSED_URL.protocol !== "https:" &&
  PARSED_URL.hostname !== "localhost" &&
  PARSED_URL.hostname !== "127.0.0.1"
) {
  process.stderr.write(
    `[agile-toolkit-mcp] refusing to send the PAT to a non-HTTPS URL (${URL_BASE}). Use https:// or a localhost dev URL.\n`
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
  // Notifications must never receive a response per JSON-RPC. A notification is
  // a request with NO `id` member — `"id": null` is a *real* request the server
  // must answer (echoing id:null). Detect by member presence, not value, so an
  // id:null request isn't silently dropped (which would hang the client).
  const isNotification = !("id" in request);
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
      const text = await response.text().catch(() => "");
      // Notifications carry no `id`, so they must never produce stdout —
      // this check has to come BEFORE the parse-and-return below. The route
      // answers every non-2xx with a well-formed JSON-RPC envelope carrying
      // `id: null` (401 on a revoked/expired PAT, 413, 429), so the parse
      // branch always succeeded first and relayed that envelope: the client
      // got an unsolicited response for an id it never issued, and the
      // diagnostic naming the failing notification was never written.
      if (isNotification) {
        process.stderr.write(
          `[agile-toolkit-mcp] notification ${request.method} got HTTP ${response.status}; suppressing response\n`
        );
        return null;
      }
      // Try to parse a JSON-RPC error body; otherwise synthesise one.
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
  // Cap only the UNTERMINATED remainder (a single huge line with no newline).
  // This runs AFTER draining complete lines so a chunk that both completes a
  // line and starts a long tail can't discard the complete, parseable message.
  if (buffer.length > MAX_BUFFER_BYTES) {
    process.stderr.write(
      `[agile-toolkit-mcp] dropped ${buffer.length} bytes (no newline within ${MAX_BUFFER_BYTES})\n`
    );
    buffer = "";
  }
});

process.stdin.on("end", () => {
  process.exit(0);
});

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
