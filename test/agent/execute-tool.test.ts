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

describe("executeToolUse — result coercion", () => {
  it('coerces a void/undefined handler result to "null" content (valid block)', async () => {
    registry.register({
      id: "__agentexec.returns_void",
      toolId: "__agentexec",
      name: "returns_void",
      category: "read",
      description: "Returns undefined.",
      paramsSchema: z.object({}),
      handler: async () => undefined,
    });
    try {
      const res = await executeToolUse(block("__agentexec.returns_void"), {
        userId: TEST_USER,
        confirm: vi.fn().mockResolvedValue(true),
        autoApprove: true,
      });
      expect(res.is_error).toBeUndefined();
      // Must be the string "null", never an undefined content.
      expect(res.content).toBe("null");
    } finally {
      registry.unregister("__agentexec.returns_void");
    }
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

describe("executeToolUse — forceConfirmWrites (visitor chat)", () => {
  const SILENT_WRITE = "__agentexec.silent_write";
  beforeEach(() => {
    // A write that normally runs without asking.
    registry.register({
      id: SILENT_WRITE,
      toolId: "__agentexec",
      name: "silent_write",
      category: "write",
      requiresConfirmation: false,
      description: "Write stub that doesn't ask.",
      paramsSchema: z.object({}),
      handler: async () => ({ wrote: true }),
    });
  });
  afterEach(() => registry.unregister(SILENT_WRITE));

  it("without it, a write marked requiresConfirmation:false runs unasked", async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const res = await executeToolUse(block(SILENT_WRITE), {
      userId: TEST_USER,
      confirm,
      autoApprove: false,
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(res.content).toContain('"wrote":true');
  });

  it("asks before that write, and a denial stops it", async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    const res = await executeToolUse(block(SILENT_WRITE), {
      userId: TEST_USER,
      confirm,
      autoApprove: false,
      forceConfirmWrites: true,
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(res.is_error).toBe(true);
    expect(res.content).toContain(`User denied execution of ${SILENT_WRITE}`);
  });

  it("still asks when autoApprove is on", async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const res = await executeToolUse(block("__agentexec.do_write", { value: "v" }), {
      userId: TEST_USER,
      confirm,
      autoApprove: true,
      forceConfirmWrites: true,
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(res.content).toContain('"stored":"v"');
  });

  it("never asks for a read", async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const res = await executeToolUse(block("__agentexec.read_only"), {
      userId: TEST_USER,
      confirm,
      autoApprove: false,
      forceConfirmWrites: true,
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(res.content).toContain('"data":"ok"');
  });
});

describe("executeToolUse — isAllowed (only the tools offered this turn)", () => {
  it("refuses a tool not offered before looking it up, validating or asking", async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const handler = vi.fn(async () => ({ ran: true }));
    registry.register({
      id: "__agentexec.not_offered",
      toolId: "__agentexec",
      name: "not_offered",
      category: "write",
      description: "Never offered.",
      paramsSchema: z.object({ n: z.number() }),
      handler,
    });
    try {
      const isAllowed = vi.fn((name: string) => name === "__agentexec_read_only");
      const res = await executeToolUse(block("__agentexec.not_offered", { n: "bad input" }), {
        userId: TEST_USER,
        confirm,
        autoApprove: true,
        isAllowed,
      });
      expect(isAllowed).toHaveBeenCalledWith("__agentexec.not_offered");
      expect(res.is_error).toBe(true);
      expect(res.content).toBe("Tool not available: __agentexec.not_offered");
      expect(confirm).not.toHaveBeenCalled();
      expect(handler).not.toHaveBeenCalled();
    } finally {
      registry.unregister("__agentexec.not_offered");
    }
  });

  it("answers an unknown name the same way, giving nothing away about the registry", async () => {
    const res = await executeToolUse(block("not_a_real_tool"), {
      userId: TEST_USER,
      confirm: vi.fn(),
      autoApprove: false,
      isAllowed: () => false,
    });
    expect(res.content).toBe("Tool not available: not_a_real_tool");
  });

  it("runs a tool that was offered", async () => {
    const res = await executeToolUse(block("__agentexec_read_only"), {
      userId: TEST_USER,
      confirm: vi.fn(),
      autoApprove: false,
      isAllowed: (name) => name === "__agentexec_read_only",
    });
    expect(res.is_error).toBeUndefined();
    expect(res.content).toContain('"data":"ok"');
  });
});
