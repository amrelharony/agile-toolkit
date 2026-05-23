import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { registry } from "@/lib/actions/registry";
import { handleJsonRpc, type JsonRpcRequest, type JsonRpcResponse } from "@/lib/mcp/transport-http";

/**
 * Smoke tests for the MCP HTTP JSON-RPC transport.
 *
 * The transport reads from the singleton action registry. We register
 * a couple of disposable test actions in beforeEach + clean up in
 * afterEach so other suites that share the singleton aren't affected.
 */

const TEST_USER = "test-user-id";
const TEST_IDS = [
  "__mcptest.add",
  "__mcptest.read_state",
] as const;

beforeEach(() => {
  registry.register({
    id: "__mcptest.add",
    toolId: "__mcptest",
    name: "add",
    category: "write",
    description: "Add two numbers.",
    paramsSchema: z.object({ a: z.number(), b: z.number() }),
    handler: async (params: { a: number; b: number }) => ({ sum: params.a + params.b }),
  });

  registry.register({
    id: "__mcptest.read_state",
    toolId: "__mcptest",
    name: "read_state",
    category: "read",
    description: "Read static state.",
    paramsSchema: z.object({}),
    handler: async () => ({ ready: true }),
  });
});

afterEach(() => {
  for (const id of TEST_IDS) registry.unregister(id);
});

/**
 * Route-level batching mimic — the actual batch entrypoint lives in
 * src/app/api/mcp/route.ts. We replicate just the Promise.all over an
 * array so the batch behaviour can be exercised in isolation.
 */
async function handleBatch(
  body: JsonRpcRequest | JsonRpcRequest[],
  userId: string
): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  const reqs = Array.isArray(body) ? body : [body];
  const results = await Promise.all(reqs.map((r) => handleJsonRpc(r, userId)));
  const filtered = results.filter((r): r is NonNullable<typeof r> => r !== null);
  if (filtered.length === 0) return null;
  return Array.isArray(body) ? filtered : filtered[0];
}

describe("handleJsonRpc — initialize", () => {
  it("returns protocol version + serverInfo", async () => {
    const res = await handleJsonRpc(
      { jsonrpc: "2.0", id: 1, method: "initialize" },
      TEST_USER
    );
    expect(res).not.toBeNull();
    expect(res?.id).toBe(1);
    const result = res?.result as {
      protocolVersion: string;
      serverInfo: { name: string; version: string };
      capabilities: { tools: { listChanged: boolean } };
    };
    expect(result.protocolVersion).toBe("2024-11-05");
    expect(result.serverInfo.name).toBe("agile-toolkit");
    expect(result.serverInfo.version).toBe("0.1.0");
    expect(result.capabilities.tools).toBeDefined();
  });
});

describe("handleJsonRpc — tools/list", () => {
  it("returns the populated registry as MCP tools", async () => {
    const res = await handleJsonRpc(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      TEST_USER
    );
    expect(res?.error).toBeUndefined();
    const result = res?.result as { tools: Array<{ name: string; description: string; inputSchema: unknown }> };
    expect(Array.isArray(result.tools)).toBe(true);
    const names = result.tools.map((t) => t.name);
    expect(names).toContain("__mcptest.add");
    expect(names).toContain("__mcptest.read_state");
  });
});

describe("handleJsonRpc — tools/call", () => {
  it("routes to the registered handler and returns a content block", async () => {
    const res = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "__mcptest.add", arguments: { a: 2, b: 3 } },
      },
      TEST_USER
    );
    expect(res?.error).toBeUndefined();
    const result = res?.result as { content: Array<{ type: string; text: string }>; isError: boolean };
    expect(result.isError).toBe(false);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain('"sum":5');
  });

  it("resolves an Anthropic-format (underscore) name via registry.resolve", async () => {
    const res = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "__mcptest_add", arguments: { a: 4, b: 5 } },
      },
      TEST_USER
    );
    const result = res?.result as { content: Array<{ text: string }>; isError: boolean };
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain('"sum":9');
  });

  it("returns -32601 for an unknown tool name", async () => {
    const res = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "nope.not.real", arguments: {} },
      },
      TEST_USER
    );
    expect(res?.error?.code).toBe(-32601);
  });

  it("returns -32602 when arguments fail schema validation", async () => {
    const res = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "__mcptest.add", arguments: { a: "not a number" } },
      },
      TEST_USER
    );
    expect(res?.error?.code).toBe(-32602);
  });
});

describe("handleJsonRpc — error cases", () => {
  it("method not found returns -32601", async () => {
    const res = await handleJsonRpc(
      { jsonrpc: "2.0", id: 7, method: "foo/bar" },
      TEST_USER
    );
    expect(res?.error?.code).toBe(-32601);
    expect(res?.error?.message).toContain("foo/bar");
  });

  it("notification (no id) returns null", async () => {
    const res = await handleJsonRpc(
      { jsonrpc: "2.0", method: "notifications/initialized" } as JsonRpcRequest,
      TEST_USER
    );
    expect(res).toBeNull();
  });

  it("notification (null id) returns null", async () => {
    const res = await handleJsonRpc(
      { jsonrpc: "2.0", id: null, method: "notifications/initialized" },
      TEST_USER
    );
    expect(res).toBeNull();
  });
});

describe("handleJsonRpc — batch (route-level wrapper)", () => {
  it("passes an array, gets an array back", async () => {
    const batch: JsonRpcRequest[] = [
      { jsonrpc: "2.0", id: 10, method: "initialize" },
      { jsonrpc: "2.0", id: 11, method: "tools/list" },
    ];
    const res = await handleBatch(batch, TEST_USER);
    expect(Array.isArray(res)).toBe(true);
    const arr = res as JsonRpcResponse[];
    expect(arr).toHaveLength(2);
    expect(arr[0].id).toBe(10);
    expect(arr[1].id).toBe(11);
  });

  it("filters out null responses (notifications) from batches", async () => {
    const batch: JsonRpcRequest[] = [
      { jsonrpc: "2.0", method: "notifications/initialized" } as JsonRpcRequest,
      { jsonrpc: "2.0", id: 12, method: "initialize" },
    ];
    const res = await handleBatch(batch, TEST_USER);
    expect(Array.isArray(res)).toBe(true);
    expect((res as JsonRpcResponse[]).length).toBe(1);
    expect((res as JsonRpcResponse[])[0].id).toBe(12);
  });
});
