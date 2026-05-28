/**
 * Squad-scope plumbing contract tests.
 *
 * Phase 0 lands the scope plumbing end-to-end:
 *   1. access_tokens.squad_profile_ids is read on PAT verify
 *   2. transport-http passes scope into ActionContext as the 3rd arg
 *   3. makeContext exposes ctx.squadProfileIds (always an array)
 *
 * This file locks in the contract so squads writing scope-aware
 * handlers in Phase 1 can rely on ctx.squadProfileIds being:
 *   - Always defined (never undefined / null)
 *   - Always an array (possibly empty)
 *   - A deep copy of the input (handler mutations don't leak back to
 *     the request scope)
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { registry } from "@/lib/actions/registry";
import { handleJsonRpc } from "@/lib/mcp/transport-http";
import { makeContext } from "@/lib/actions/context";

const PROBE_ID = "__scopetest.read_ctx";

beforeEach(() => {
  registry.register({
    id: PROBE_ID,
    toolId: "__scopetest",
    name: "read_ctx",
    category: "read",
    description: "Return ctx.squadProfileIds verbatim — used by the contract suite.",
    paramsSchema: z.object({}),
    handler: async (_params, ctx) => ({
      squadProfileIds: ctx.squadProfileIds,
      source: ctx.source,
      userId: ctx.userId,
    }),
  });
});

afterEach(() => {
  registry.unregister(PROBE_ID);
});

describe("makeContext — squad scope default", () => {
  it("defaults squadProfileIds to []", () => {
    const ctx = makeContext("u1", "mcp");
    expect(ctx.squadProfileIds).toEqual([]);
    expect(Array.isArray(ctx.squadProfileIds)).toBe(true);
  });

  it("preserves the supplied scope as a copy", () => {
    const input = ["a", "b"];
    const ctx = makeContext("u1", "mcp", undefined, input);
    expect(ctx.squadProfileIds).toEqual(["a", "b"]);
    // Mutation of the input must not affect the context copy.
    input.push("c");
    expect(ctx.squadProfileIds).toEqual(["a", "b"]);
  });

  it("accepts a readonly array (won't widen back to mutable)", () => {
    const ro: readonly string[] = ["x"];
    const ctx = makeContext("u1", "agent", undefined, ro);
    expect(ctx.squadProfileIds).toEqual(["x"]);
  });
});

describe("handleJsonRpc — squad scope flow", () => {
  it("defaults to empty scope when 3rd arg omitted", async () => {
    const res = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: PROBE_ID, arguments: {} },
      },
      "user-x"
    );
    const text = (res?.result as { content: [{ text: string }] }).content[0].text;
    const parsed = JSON.parse(text) as { squadProfileIds: string[]; userId: string };
    expect(parsed.squadProfileIds).toEqual([]);
    expect(parsed.userId).toBe("user-x");
  });

  it("passes the supplied scope into the handler's ctx", async () => {
    const res = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: PROBE_ID, arguments: {} },
      },
      "user-x",
      ["profile-a", "profile-b"]
    );
    const text = (res?.result as { content: [{ text: string }] }).content[0].text;
    const parsed = JSON.parse(text) as { squadProfileIds: string[] };
    expect(parsed.squadProfileIds).toEqual(["profile-a", "profile-b"]);
  });

  it("does not leak scope from one call to the next", async () => {
    // First call: scoped
    await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: PROBE_ID, arguments: {} },
      },
      "user-x",
      ["profile-a"]
    );
    // Second call: no scope arg → must observe []
    const res = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: PROBE_ID, arguments: {} },
      },
      "user-x"
    );
    const text = (res?.result as { content: [{ text: string }] }).content[0].text;
    const parsed = JSON.parse(text) as { squadProfileIds: string[] };
    expect(parsed.squadProfileIds).toEqual([]);
  });
});
