import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { registry } from "@/lib/actions/registry";
import { executeToolUse, isDestructiveAction } from "@/lib/agent/execute-tool";
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
    // The card's words, never the action id or JSON.
    expect(confirm.mock.calls[0][0]).toMatchObject({
      detail: "Value: “hello”",
      destructive: false,
    });
    expect(JSON.stringify(confirm.mock.calls[0][0])).not.toContain("__agentexec");
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

  // The visitor chat's answer can change while a card waits: the visitor opens
  // a live room, then approves. So isAllowed is asked again after the card.
  describe("asked again after a confirmation", () => {
    const handler = vi.fn(async (params: { value: string }) => ({ stored: params.value }));
    const NAME = "__agentexec_slow_confirm";

    beforeEach(() => {
      handler.mockClear();
      registry.register({
        id: "__agentexec.slow_confirm",
        toolId: "__agentexec",
        name: "slow_confirm",
        category: "write",
        description: "A write whose confirmation waits.",
        paramsSchema: z.object({ value: z.string() }),
        handler,
      });
    });

    afterEach(() => {
      registry.unregister("__agentexec.slow_confirm");
    });

    it("does not run a write that stopped being allowed while its confirmation waited", async () => {
      let allowed = true;
      const isAllowed = vi.fn(() => allowed);
      const confirm = vi.fn(async () => {
        allowed = false;
        return true;
      });
      const res = await executeToolUse(block(NAME, { value: "x" }), {
        userId: TEST_USER,
        confirm,
        autoApprove: false,
        forceConfirmWrites: true,
        isAllowed,
      });
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(isAllowed).toHaveBeenCalledTimes(2);
      expect(res).toEqual({
        type: "tool_result",
        tool_use_id: "tu_test",
        content: `Tool not available: ${NAME}`,
        is_error: true,
      });
      expect(handler).not.toHaveBeenCalled();
    });

    it("runs an approved write that is still allowed, having asked twice", async () => {
      const isAllowed = vi.fn(() => true);
      const res = await executeToolUse(block(NAME, { value: "x" }), {
        userId: TEST_USER,
        confirm: vi.fn().mockResolvedValue(true),
        autoApprove: false,
        forceConfirmWrites: true,
        isAllowed,
      });
      expect(isAllowed).toHaveBeenCalledTimes(2);
      expect(isAllowed).toHaveBeenLastCalledWith(NAME);
      expect(res.is_error).toBeUndefined();
      expect(res.content).toContain('"stored":"x"');
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("still reports a denial as a denial, whatever is allowed by then", async () => {
      let allowed = true;
      const isAllowed = vi.fn(() => allowed);
      const confirm = vi.fn(async () => {
        allowed = false;
        return false;
      });
      const res = await executeToolUse(block(NAME, { value: "x" }), {
        userId: TEST_USER,
        confirm,
        autoApprove: false,
        isAllowed,
      });
      expect(res.is_error).toBe(true);
      expect(res.content).toContain("User denied");
      expect(isAllowed).toHaveBeenCalledTimes(1);
      expect(handler).not.toHaveBeenCalled();
    });

    it("asks once when no confirmation was shown", async () => {
      const isAllowed = vi.fn(() => true);
      const confirm = vi.fn().mockResolvedValue(true);
      await executeToolUse(block("__agentexec_read_only"), {
        userId: TEST_USER,
        confirm,
        autoApprove: false,
        forceConfirmWrites: true,
        isAllowed,
      });
      await executeToolUse(block(NAME, { value: "x" }), {
        userId: TEST_USER,
        confirm,
        autoApprove: true,
        isAllowed,
      });
      expect(confirm).not.toHaveBeenCalled();
      expect(isAllowed).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("changes nothing without isAllowed (the owner's chat): an approved write runs", async () => {
      const confirm = vi.fn().mockResolvedValue(true);
      const res = await executeToolUse(block(NAME, { value: "x" }), {
        userId: TEST_USER,
        confirm,
        autoApprove: false,
      });
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(res.is_error).toBeUndefined();
      expect(res.content).toContain('"stored":"x"');
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});

/**
 * The confirm card's words and who is asked. Probes take real catalog ids so
 * tool-label names them; each replaces whatever holds the id and goes after.
 */
describe("executeToolUse — the confirm card (ConfirmPrompt) and the destructive gate", () => {
  const PROBES: Array<Parameters<typeof registry.register>[0]> = [
    {
      id: "tool.retro.add_card",
      toolId: "tool.retro",
      name: "add_card",
      category: "write",
      requiresConfirmation: false,
      description: "probe",
      paramsSchema: z.object({ columnKey: z.string(), text: z.string() }),
      handler: async () => ({ added: true }),
    },
    {
      id: "tool.retro.delete_card",
      toolId: "tool.retro",
      name: "delete_card",
      category: "write",
      requiresConfirmation: false,
      description: "probe",
      paramsSchema: z.object({ cardId: z.string() }),
      handler: async () => ({ deleted: true }),
    },
    {
      id: "tool.risk_register.delete",
      toolId: "tool.risk_register",
      name: "delete",
      category: "write",
      requiresConfirmation: true,
      confirmLabel: "Delete this risk",
      description: "probe",
      paramsSchema: z.object({ id: z.string() }),
      handler: async () => ({ deleted: true }),
    },
    {
      id: "workspace.sprint.create",
      toolId: "workspace.sprint",
      name: "create",
      category: "write",
      description: "probe",
      paramsSchema: z.object({ entity: z.record(z.string(), z.unknown()) }),
      handler: async () => ({ id: "s1" }),
    },
    {
      id: "tool.prioritizer.set_order",
      toolId: "tool.prioritizer",
      name: "set_order",
      category: "write",
      requiresConfirmation: true,
      description: "probe",
      paramsSchema: z.object({ ids: z.array(z.string()) }),
      handler: async () => ({ ranked: 3 }),
    },
    {
      id: "tool.decision_log.supersede",
      toolId: "tool.decision_log",
      name: "supersede",
      category: "write",
      description: "probe",
      paramsSchema: z.object({
        id: z.string(),
        supersededBy: z.string(),
        reason: z.string().optional(),
      }),
      handler: async () => ({ superseded: true }),
    },
    {
      id: "tool.decision_log.decide",
      toolId: "tool.decision_log",
      name: "decide",
      category: "write",
      description: "probe",
      paramsSchema: z.object({
        id: z.string(),
        chosenOption: z.string().optional(),
        parentID: z.string().optional(),
      }),
      handler: async () => ({ decided: true }),
    },
  ];
  const handlers = new Map<string, ReturnType<typeof vi.fn>>();

  beforeEach(() => {
    for (const probe of PROBES) {
      const handler = vi.fn(probe.handler);
      handlers.set(probe.id, handler);
      registry.unregister(probe.id);
      registry.register({ ...probe, handler });
    }
  });
  afterEach(() => {
    for (const probe of PROBES) registry.unregister(probe.id);
  });

  /** The prompt the card got for one call (the visitor's path, so every write asks). */
  async function promptFor(name: string, input: Record<string, unknown>) {
    const confirm = vi.fn().mockResolvedValue(false);
    await executeToolUse(block(name, input), {
      userId: TEST_USER,
      confirm,
      autoApprove: false,
      forceConfirmWrites: true,
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    return confirm.mock.calls[0][0];
  }

  it("names the tool and the verb, asks a question and says the arguments in words", async () => {
    const prompt = await promptFor("tool_retro_add_card", {
      columnKey: "went-well",
      text: "flaky CI",
    });
    expect(prompt).toEqual({
      verb: "Add card",
      title: "Retro Board",
      question: "Add a card to Retro Board?",
      detail: "Column: “went-well” · Text: “flaky CI”",
      destructive: false,
    });
    // No id, key name or JSON reaches the card.
    expect(Object.values(prompt).join(" ")).not.toMatch(/tool[._]retro|columnKey|add_card|[{}]/);
  });

  it("leaves ids out, reads an entity's own fields, shortens long text and counts the rest", async () => {
    const prompt = await promptFor("workspace_sprint_create", {
      entity: {
        id: "s-123",
        name: "Sprint 47",
        goal: "x".repeat(60),
        capacityPoints: 30,
        tags: ["api", "ci"],
      },
    });
    expect(prompt.verb).toBe("Create sprint");
    expect(prompt.title).toBe("Workspace");
    expect(prompt.question).toBe("Create a sprint in your workspace?");
    expect(prompt.detail).toBe(
      `Name: “Sprint 47” · Goal: “${"x".repeat(39)}…” · Capacity points: 30 · 1 more`
    );
    expect(prompt.detail).not.toContain("s-123");
  });

  it("says a list of ids as a count", async () => {
    const prompt = await promptFor("tool_prioritizer_set_order", { ids: ["a", "b", "c"] });
    expect(prompt.detail).toBe("Items: 3");
    expect(prompt.question).toBe("Set the order in Backlog Prioritizer?");
  });

  it("leaves out an id held under a key that doesn't say so", async () => {
    const prompt = await promptFor("tool_decision_log_supersede", {
      id: "a1b2c3d4",
      supersededBy: "V1StGXR8",
      reason: "new vendor",
    });
    expect(prompt.detail).toBe("Reason: “new vendor”");
    expect(prompt.detail).not.toMatch(/a1b2c3d4|V1StGXR8|Superseded/);
  });

  it("leaves out a UUID under any key and an ID-suffixed key, and keeps an option's text", async () => {
    const uuid = "3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b";
    const byId = await promptFor("tool_decision_log_decide", {
      id: "d1",
      chosenOption: uuid,
      parentID: "p-77",
    });
    expect(byId.detail).toBe("");
    const byText = await promptFor("tool_decision_log_decide", {
      id: "d1",
      chosenOption: "Move to Fly.io",
    });
    expect(byText.detail).toBe("Chosen option: “Move to Fly.io”");
  });

  it("asks the action's own confirmLabel, and the card's button says it", async () => {
    const prompt = await promptFor("tool.risk_register.delete", { id: "r1" });
    expect(prompt).toEqual({
      verb: "Delete",
      title: "Risk Register",
      question: "Delete this risk?",
      detail: "",
      destructive: true,
      confirmLabel: "Delete this risk",
    });
  });

  it("asks before a delete even when it declares requiresConfirmation:false", async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    const res = await executeToolUse(block("tool_retro_delete_card", { cardId: "c1" }), {
      userId: TEST_USER,
      confirm,
      autoApprove: false,
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toMatchObject({
      destructive: true,
      question: "Delete this card from Retro Board?",
    });
    expect(res.content).toBe("User denied execution of tool.retro.delete_card.");
    expect(handlers.get("tool.retro.delete_card")).not.toHaveBeenCalled();
  });

  it("asks before a destructive change even under Approve all, and runs it once approved", async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const res = await executeToolUse(block("tool_risk_register_delete", { id: "r1" }), {
      userId: TEST_USER,
      confirm,
      autoApprove: true,
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(res.content).toContain('"deleted":true');
    expect(handlers.get("tool.risk_register.delete")).toHaveBeenCalledTimes(1);
  });

  it("lets Approve all skip a change that isn't destructive", async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    const res = await executeToolUse(block("tool_prioritizer_set_order", { ids: ["a"] }), {
      userId: TEST_USER,
      confirm,
      autoApprove: true,
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(res.content).toContain('"ranked":3');
  });

  it("counts a write as destructive by the first word of its name only", () => {
    for (const name of ["delete", "remove_check_in", "reset", "clear_all", "archive_dimension"]) {
      expect(isDestructiveAction({ name, category: "write" }), name).toBe(true);
    }
    expect(isDestructiveAction({ name: "reset", category: "intent" })).toBe(true);
    for (const name of ["unarchive", "add_card", "deleted_list", "mark_resolved", "set_order"]) {
      expect(isDestructiveAction({ name, category: "write" }), name).toBe(false);
    }
    // A read never asks.
    expect(isDestructiveAction({ name: "delete_preview", category: "read" })).toBe(false);
  });
});
