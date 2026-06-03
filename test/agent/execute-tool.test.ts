import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { registry } from "@/lib/actions/registry";
import { executeToolUse } from "@/lib/agent/execute-tool";
import type { ToolUseBlock } from "@/lib/agent/types";

/**
 * Smoke tests for the agent's tool-use execution path.
 *
 * Disposable test actions live under `__agentexec.*` and are torn down
 * in afterEach so other suites are not polluted.
 */

const TEST_USER = "test-user";
const TEST_IDS = [
  "__agentexec.read_only",
  "__agentexec.do_write",
  "__agentexec.dotted.id_with_underscores",
] as const;

beforeEach(() => {
  registry.register({
    id: "__agentexec.read_only",
    toolId: "__agentexec",
    name: "read_only",
    category: "read",
    description: "Read-only stub.",
    paramsSchema: z.object({}),
    handler: async () => ({ data: "ok" }),
  });

  registry.register({
    id: "__agentexec.do_write",
    toolId: "__agentexec",
    name: "do_write",
    category: "write",
    description: "Write stub.",
    paramsSchema: z.object({ value: z.string() }),
    handler: async (params: { value: string }) => ({ stored: params.value }),
  });

  registry.register({
    id: "__agentexec.dotted.id_with_underscores",
    toolId: "__agentexec.dotted",
    name: "id_with_underscores",
    category: "write",
    description: "Tests Anthropic-format name resolution.",
    paramsSchema: z.object({ n: z.number() }),
    handler: async (params: { n: number }) => ({ value: params.n }),
  });
});

afterEach(() => {
  for (const id of TEST_IDS) registry.unregister(id);
});

function block(name: string, input: Record<string, unknown> = {}): ToolUseBlock {
  return { type: "tool_use", id: "tu_test", name, input };
}

describe("executeToolUse — resolution", () => {
  it("resolves an Anthropic-format name (with underscores) via registry.resolve", async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const res = await executeToolUse(block("__agentexec_dotted_id_with_underscores", { n: 7 }), {
      userId: TEST_USER,
      confirm,
      autoApprove: true,
    });
    expect(res.is_error).toBeUndefined();
    expect(res.content).toContain('"value":7');
  });

  it("rejects unknown names with is_error=true", async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const res = await executeToolUse(block("not_a_real_tool"), {
      userId: TEST_USER,
      confirm,
      autoApprove: true,
    });
    expect(res.is_error).toBe(true);
    expect(res.content).toContain("Unknown tool: not_a_real_tool");
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe("executeToolUse — schema validation", () => {
  it("schema validation failure returns is_error=true with a schema-violation message", async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const res = await executeToolUse(
      block("__agentexec.do_write", { value: 123 }), // wrong type
      { userId: TEST_USER, confirm, autoApprove: true }
    );
    expect(res.is_error).toBe(true);
    expect(res.content).toContain("Invalid input for __agentexec.do_write");
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe("executeToolUse — confirmation gating", () => {
  it("read actions skip the confirm prompt", async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const res = await executeToolUse(block("__agentexec.read_only"), {
      userId: TEST_USER,
      confirm,
      autoApprove: false,
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(res.is_error).toBeUndefined();
    expect(res.content).toContain('"data":"ok"');
  });

  it("write actions call confirm and respect approval", async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const res = await executeToolUse(block("__agentexec.do_write", { value: "hello" }), {
      userId: TEST_USER,
      confirm,
      autoApprove: false,
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toContain("__agentexec.do_write");
    expect(res.is_error).toBeUndefined();
    expect(res.content).toContain('"stored":"hello"');
  });

  it("write actions call confirm and respect denial", async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    const res = await executeToolUse(block("__agentexec.do_write", { value: "hello" }), {
      userId: TEST_USER,
      confirm,
      autoApprove: false,
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(res.is_error).toBe(true);
    expect(res.content).toContain("User denied execution of __agentexec.do_write");
  });

  it("autoApprove bypasses confirm for writes", async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    const res = await executeToolUse(block("__agentexec.do_write", { value: "auto" }), {
      userId: TEST_USER,
      confirm,
      autoApprove: true,
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(res.is_error).toBeUndefined();
    expect(res.content).toContain('"stored":"auto"');
  });
});

describe("executeToolUse — abort", () => {
  it("returns a Cancelled result without running when the signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const confirm = vi.fn().mockResolvedValue(true);
    const res = await executeToolUse(block("__agentexec.read_only"), {
      userId: TEST_USER,
      confirm,
      autoApprove: true,
      signal: ac.signal,
    });
    expect(res.is_error).toBe(true);
    expect(res.content).toContain("Cancelled");
    expect(res.tool_use_id).toBe("tu_test");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("aborting a hung handler resolves fast with an error result (no orphan, no 30s wait)", async () => {
    registry.register({
      id: "__agentexec.hang",
      toolId: "__agentexec",
      name: "hang",
      category: "read",
      description: "Handler that never resolves.",
      paramsSchema: z.object({}),
      handler: () => new Promise(() => {}), // never settles
    });
    try {
      const ac = new AbortController();
      const p = executeToolUse(block("__agentexec.hang"), {
        userId: TEST_USER,
        confirm: vi.fn().mockResolvedValue(true),
        autoApprove: true,
        signal: ac.signal,
      });
      ac.abort(); // fire after the race is armed
      const res = await p;
      expect(res.is_error).toBe(true);
      expect(String(res.content).toLowerCase()).toContain("cancel");
    } finally {
      registry.unregister("__agentexec.hang");
    }
  });
});
