/**
 * End-to-end capability enforcement at the MCP route.
 *
 * A token's access_level is enforced per `tools/call`: a read-only token
 * cannot invoke write/intent actions, a write token cannot invoke intents.
 * Denied calls get a -32003 error in place and are never dispatched.
 *
 * verifyBearer is mocked so we control the token's access_level without a
 * database; disposable read/write/intent actions are registered so the
 * route's denial logic (and allowed dispatch) can be exercised without
 * touching Supabase.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@/lib/mcp/pat", () => ({ verifyBearer: vi.fn() }));

import { POST } from "@/app/api/mcp/route";
import { verifyBearer } from "@/lib/mcp/pat";
import { registry } from "@/lib/actions/registry";
import { __resetRateLimit } from "@/lib/mcp/rate-limit";
import type { AccessLevel } from "@/lib/mcp/capability";

const mockVerify = vi.mocked(verifyBearer);

const READ_ID = "__captest.read_thing";
const WRITE_ID = "__captest.write_thing";
const INTENT_ID = "intent.__captest_compose";
const TEST_IDS = [READ_ID, WRITE_ID, INTENT_ID] as const;

function auth(accessLevel: AccessLevel, tokenId: string) {
  mockVerify.mockResolvedValue({ userId: "u1", tokenId, squadProfileIds: [], accessLevel });
}

function post(body: unknown) {
  return POST(
    new Request("http://x/api/mcp", {
      method: "POST",
      headers: { authorization: "Bearer pat_test", "content-type": "application/json" },
      body: JSON.stringify(body),
    }) as never
  );
}

const call = (id: number, name: string) => ({
  jsonrpc: "2.0" as const,
  id,
  method: "tools/call",
  params: { name, arguments: {} },
});

beforeEach(() => {
  __resetRateLimit();
  registry.register({
    id: READ_ID,
    toolId: "__captest",
    name: "read_thing",
    category: "read",
    description: "read",
    paramsSchema: z.object({}),
    handler: async () => ({ ok: true }),
  });
  registry.register({
    id: WRITE_ID,
    toolId: "__captest",
    name: "write_thing",
    category: "write",
    description: "write",
    paramsSchema: z.object({}),
    handler: async () => ({ wrote: true }),
  });
  registry.register({
    id: INTENT_ID,
    toolId: "intent",
    name: "compose",
    category: "intent",
    description: "intent",
    paramsSchema: z.object({}),
    handler: async () => ({ done: true }),
  });
});

afterEach(() => {
  for (const id of TEST_IDS) registry.unregister(id);
  mockVerify.mockReset();
});

describe("MCP route — access_level enforcement", () => {
  it("read-only token: reads allowed, writes denied with -32003", async () => {
    auth("read", "tok-read");

    const ok = await (await post(call(1, READ_ID))).json();
    expect(ok.error).toBeUndefined();
    expect(ok.result.content[0].text).toContain('"ok":true');

    const denied = await (await post(call(2, WRITE_ID))).json();
    expect(denied.error.code).toBe(-32003);
    expect(denied.error.message).toMatch(/read-only/);
  });

  it("write token: writes allowed, intents denied", async () => {
    auth("write", "tok-write");

    const ok = await (await post(call(3, WRITE_ID))).json();
    expect(ok.error).toBeUndefined();
    expect(ok.result.content[0].text).toContain('"wrote":true');

    const denied = await (await post(call(4, INTENT_ID))).json();
    expect(denied.error.code).toBe(-32003);
    expect(denied.error.message).toMatch(/intent/);
  });

  it("full token: intents (and everything else) allowed", async () => {
    auth("full", "tok-full");
    const ok = await (await post(call(5, INTENT_ID))).json();
    expect(ok.error).toBeUndefined();
    expect(ok.result.content[0].text).toContain('"done":true');
  });

  it("denies per-call within a batch while allowing the rest", async () => {
    auth("read", "tok-batch");
    const res = await post([call(6, READ_ID), call(7, WRITE_ID)]);
    const arr = (await res.json()) as Array<{ id: number; error?: { code: number } }>;
    expect(Array.isArray(arr)).toBe(true);
    const byId = Object.fromEntries(arr.map((r) => [r.id, r]));
    expect(byId[6].error).toBeUndefined();
    expect(byId[7].error?.code).toBe(-32003);
  });
});
