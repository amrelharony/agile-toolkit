/**
 * Transport robustness: a tools/call handler that resolves to void must
 * still produce a valid MCP text-content block.
 *
 * `JSON.stringify(undefined) === undefined` (not a string), so without a
 * guard the transport would emit `content: [{ type: "text", text: undefined }]`
 * — `text` vanishes on JSON serialisation, violating MCP's content schema.
 * The transport coerces such results to the string "null".
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { registry } from "@/lib/actions/registry";
import { handleJsonRpc } from "@/lib/mcp/transport-http";

const VOID_ID = "__voidtest.returns_void";

beforeEach(() => {
  registry.register({
    id: VOID_ID,
    toolId: "__voidtest",
    name: "returns_void",
    category: "read",
    description: "Resolves to undefined — exercises the void-result guard.",
    paramsSchema: z.object({}),
    // Explicitly returns undefined (void).
    handler: async () => undefined as unknown as Record<string, never>,
  });
});

afterEach(() => registry.unregister(VOID_ID));

describe("handleJsonRpc — void handler result", () => {
  it("emits a string `text` (never undefined) and is not an error", async () => {
    const res = await handleJsonRpc(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: VOID_ID, arguments: {} } },
      "user-1"
    );
    const result = res?.result as {
      content: Array<{ type: string; text: string }>;
      isError: boolean;
    };
    expect(result.isError).toBe(false);
    expect(result.content[0].type).toBe("text");
    expect(typeof result.content[0].text).toBe("string");
    expect(result.content[0].text).toBe("null");

    // The text field must survive a JSON round-trip (i.e. not be dropped).
    const roundTripped = JSON.parse(JSON.stringify(result.content[0]));
    expect("text" in roundTripped).toBe(true);
  });
});
