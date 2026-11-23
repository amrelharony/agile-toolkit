import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { registry } from "@/lib/actions/registry";
import "@/lib/actions/register-all";
import { executeToolUse } from "@/lib/agent/execute-tool";
import {
  FAILURE_FLAGS,
  REFUSAL_FLAGS,
  STEP_WORDS,
  classifyResult,
  pairToolResults,
  plainSummary,
  resultSummary,
  stepState,
  stepSummary,
} from "@/lib/agent/tool-result-text";
import type { ChatMessage, ToolResultBlock, ToolUseBlock } from "@/lib/agent/types";

/**
 * What a tool call came to, in words: classifyResult reads execute-tool's
 * result strings (run for real below, so a reworded string fails here), and
 * the step helpers pair calls with results and say where each one stands.
 */

const err = (content: string): ToolResultBlock => ({
  type: "tool_result",
  tool_use_id: "t1",
  content,
  is_error: true,
});
const ok = (content: string): ToolResultBlock => ({
  type: "tool_result",
  tool_use_id: "t1",
  content,
});

describe("classifyResult", () => {
  it("maps each of execute-tool's strings to one plain state", () => {
    expect(classifyResult(err("Cancelled."))).toBe("stopped");
    expect(classifyResult(err("Handler error: cancelled"))).toBe("stopped");
    expect(classifyResult(err("Handler error: Handler timeout after 30000ms"))).toBe("timeout");
    expect(classifyResult(err("User denied execution of tool.retro.add_card."))).toBe("denied");
    expect(classifyResult(err("Unknown tool: tool_retro_add_cards"))).toBe("unavailable");
    expect(classifyResult(err("Tool not available: tool_canvas_add_sticky"))).toBe("unavailable");
    expect(classifyResult(err("Invalid input for tool.retro.add_card: text required"))).toBe(
      "failed"
    );
    expect(classifyResult(err("Handler error: Retro not found"))).toBe("failed");
    expect(classifyResult(err("Input too large (2000000 bytes > 1048576)."))).toBe("failed");
    expect(classifyResult(err("Input is not JSON-serialisable."))).toBe("failed");
    expect(classifyResult(err("Something else went wrong"))).toBe("failed");
  });

  it("reads the strings even when a reload lost is_error", () => {
    expect(classifyResult(ok("User denied execution of workspace.sprint.delete."))).toBe("denied");
    expect(classifyResult(ok("Cancelled."))).toBe("stopped");
  });

  it("calls a handler's JSON done unless it says nothing changed", () => {
    expect(classifyResult(ok('{"id":"c1"}'))).toBe("done");
    expect(classifyResult(ok("null"))).toBe("done");
    expect(classifyResult(ok('{"items":[]}'))).toBe("done");
    expect(classifyResult(ok('{"added":true,"id":"a1"}'))).toBe("done");
    expect(classifyResult(ok('{"added":false,"reason":"no_retro"}'))).toBe("failed");
    expect(classifyResult(ok('{"updated":false}'))).toBe("failed");
    expect(classifyResult(ok('{"error":"no_retro"}'))).toBe("failed");
    // A read that finds nothing, or a change already in place, did its job.
    expect(classifyResult(ok('{"found":false}'))).toBe("done");
    expect(classifyResult(ok('{"changed":false}'))).toBe("done");
  });

  it("reads the newer tools' refusals as failed, never as a finished change", () => {
    // Card Decks, SM Notebook, Team Mixer, Product Goal and Backlog Health.
    expect(classifyResult(ok('{"dealt":false,"reason":"x"}'))).toBe("failed");
    expect(classifyResult(ok('{"shuffled":false,"reason":"x"}'))).toBe("failed");
    expect(classifyResult(ok('{"tagged":false,"reason":"not_found"}'))).toBe("failed");
    expect(classifyResult(ok('{"mixed":false,"reason":"x"}'))).toBe("failed");
    expect(classifyResult(ok('{"closed":false}'))).toBe("failed");
    expect(classifyResult(ok('{"split":false,"reason":"x"}'))).toBe("failed");
    // Decision Log, Planning Poker, RACI and Working Agreement.
    expect(classifyResult(ok('{"decided":false,"reason":"not_found"}'))).toBe("failed");
    expect(classifyResult(ok('{"cancelled":false}'))).toBe("failed");
    expect(classifyResult(ok('{"voted":false,"reason":"revealed"}'))).toBe("failed");
    expect(classifyResult(ok('{"renamed":false,"reason":"duplicate"}'))).toBe("failed");
    expect(classifyResult(ok('{"published":false,"reason":"no_rules"}'))).toBe("failed");
  });

  it("reads revealed, committed and done as a refusal only with a reason", () => {
    expect(classifyResult(ok('{"revealed":false,"reason":"no_active_round"}'))).toBe("failed");
    expect(classifyResult(ok('{"committed":false,"reason":"not_revealed"}'))).toBe("failed");
    expect(classifyResult(ok('{"done":false,"reason":"not_found"}'))).toBe("failed");
    // A round not yet revealed, a dry-run plan, a reopened training, an open task.
    expect(classifyResult(ok('{"active":false,"revealed":false,"voteCount":0}'))).toBe("done");
    expect(classifyResult(ok('{"selected":[],"committed":false}'))).toBe("done");
    expect(classifyResult(ok('{"done":false,"reopened":true}'))).toBe("done");
    expect(classifyResult(ok('{"id":"t1","text":"Map","done":false}'))).toBe("done");
  });

  it("knows every false flag a registered action's description names", () => {
    // Flags whose false is no failure: a read that finds or picks nothing, a
    // change already in place, a favourite taken off.
    const NOT_FAILURE = ["changed", "exists", "favorited", "found", "picked"];
    const known = new Set<string>([...FAILURE_FLAGS, ...REFUSAL_FLAGS, ...NOT_FAILURE]);
    const unknown: string[] = [];
    for (const action of registry.list()) {
      const flag = /\{\s*([A-Za-z_]+)\s*:\s*false\b/g;
      for (
        let match = flag.exec(action.description);
        match;
        match = flag.exec(action.description)
      ) {
        if (!known.has(match[1])) unknown.push(`${action.id}: ${match[1]}`);
      }
    }
    expect(registry.list().length).toBeGreaterThan(800);
    expect(unknown).toEqual([]);
    expect(
      FAILURE_FLAGS.filter((flag) => (REFUSAL_FLAGS as readonly string[]).includes(flag))
    ).toEqual([]);
  });

  it("reads content given as text blocks", () => {
    const blocks: ToolResultBlock = {
      type: "tool_result",
      tool_use_id: "t1",
      content: [
        { type: "text", text: "User denied " },
        { type: "text", text: "execution of x." },
      ],
      is_error: true,
    };
    expect(classifyResult(blocks)).toBe("denied");
  });
});

describe("classifyResult on execute-tool's own results", () => {
  const IDS = ["__resulttext.write", "__resulttext.boom", "__resulttext.hang"] as const;
  const opts = { userId: "u1", confirm: vi.fn(async () => true), autoApprove: true };
  const call = (name: string, input: Record<string, unknown> = {}): ToolUseBlock => ({
    type: "tool_use",
    id: "tu1",
    name,
    input,
  });

  beforeEach(() => {
    registry.register({
      id: "__resulttext.write",
      toolId: "__resulttext",
      name: "write",
      category: "write",
      description: "Write stub.",
      paramsSchema: z.object({ text: z.string() }),
      handler: async (p: { text: string }) => ({ added: true, id: "c1", text: p.text }),
    });
    registry.register({
      id: "__resulttext.boom",
      toolId: "__resulttext",
      name: "boom",
      category: "read",
      description: "Throws.",
      paramsSchema: z.object({}),
      handler: async () => {
        throw new Error("boom");
      },
    });
    registry.register({
      id: "__resulttext.hang",
      toolId: "__resulttext",
      name: "hang",
      category: "read",
      description: "Never settles.",
      paramsSchema: z.object({}),
      handler: () => new Promise<never>(() => {}),
    });
  });

  afterEach(() => {
    for (const id of IDS) registry.unregister(id);
    vi.useRealTimers();
  });

  it("done, with the result's own name for what it made", async () => {
    const res = await executeToolUse(call("__resulttext_write", { text: "flaky CI" }), opts);
    expect(classifyResult(res)).toBe("done");
    expect(resultSummary(res)).toBe("flaky CI");
  });

  it("denied when the card is turned down", async () => {
    const res = await executeToolUse(call("__resulttext_write", { text: "x" }), {
      ...opts,
      autoApprove: false,
      confirm: vi.fn(async () => false),
    });
    expect(classifyResult(res)).toBe("denied");
  });

  it("unavailable for an unknown name or one not offered", async () => {
    expect(classifyResult(await executeToolUse(call("tool_nope_add"), opts))).toBe("unavailable");
    const offered = await executeToolUse(call("__resulttext_write", { text: "x" }), {
      ...opts,
      isAllowed: () => false,
    });
    expect(classifyResult(offered)).toBe("unavailable");
  });

  it("failed for bad input or a handler that throws", async () => {
    expect(
      classifyResult(await executeToolUse(call("__resulttext_write", { text: 1 }), opts))
    ).toBe("failed");
    expect(classifyResult(await executeToolUse(call("__resulttext_boom"), opts))).toBe("failed");
  });

  it("stopped when the turn is stopped, before or during the handler", async () => {
    const before = new AbortController();
    before.abort();
    const early = await executeToolUse(call("__resulttext_boom"), {
      ...opts,
      signal: before.signal,
    });
    expect(classifyResult(early)).toBe("stopped");

    const during = new AbortController();
    const pending = executeToolUse(call("__resulttext_hang"), { ...opts, signal: during.signal });
    await Promise.resolve();
    during.abort();
    expect(classifyResult(await pending)).toBe("stopped");
  });

  it("timeout when the handler runs past its 30 s", async () => {
    vi.useFakeTimers();
    const pending = executeToolUse(call("__resulttext_hang"), opts);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(classifyResult(await pending)).toBe("timeout");
  });
});

describe("plainSummary and stepSummary", () => {
  it("takes the first plain name field, from an object or JSON text", () => {
    expect(plainSummary({ title: "Sprint 47", name: "ignored" })).toBe("Sprint 47");
    expect(plainSummary({ name: "Dana" })).toBe("Dana");
    expect(plainSummary('{"text":"flaky   CI\\n"}')).toBe("flaky CI");
    expect(plainSummary({ label: "Ready" })).toBe("Ready");
  });

  it("says nothing without a plain string to show", () => {
    expect(plainSummary({ id: "c1", count: 3 })).toBeNull();
    expect(plainSummary({ title: 5 })).toBeNull();
    expect(plainSummary({ title: "   " })).toBeNull();
    expect(plainSummary(["title"])).toBeNull();
    expect(plainSummary("not json")).toBeNull();
    expect(plainSummary(null)).toBeNull();
  });

  it("cuts a long name at a word", () => {
    const long = "Make the flaky integration suite green before the release branch is cut";
    const cut = plainSummary({ text: long });
    expect(cut).toMatch(/…$/);
    expect(cut!.length).toBeLessThanOrEqual(60);
    expect(long.startsWith(cut!.slice(0, -1))).toBe(true);
  });

  it("uses the result's name when done, else the call's arguments", () => {
    const input = { text: "flaky CI" };
    expect(stepSummary({ input }, ok('{"id":"c1"}'))).toBe("flaky CI");
    expect(stepSummary({ input }, ok('{"title":"Card flaky CI"}'))).toBe("Card flaky CI");
    expect(stepSummary({ input }, err("User denied execution of x."))).toBe("flaky CI");
    expect(stepSummary({ input }, undefined)).toBe("flaky CI");
  });

  it("never reads a half-streamed or cut-down argument list", () => {
    expect(stepSummary({ input: { _partial: true } }, undefined)).toBeNull();
    expect(stepSummary({ input: { _truncated: '{"text":"x"' } }, undefined)).toBeNull();
  });

  it("parses a result's JSON once, however often its row is drawn", () => {
    // Each row is redrawn on every streamed flush and keystroke.
    const block = ok('{"added":true,"title":"flaky CI"}');
    const parse = vi.spyOn(JSON, "parse");
    try {
      for (let i = 0; i < 3; i++) {
        expect(stepState({ id: "t1", input: {} }, block, {})).toBe("done");
        expect(classifyResult(block)).toBe("done");
        expect(stepSummary({ input: {} }, block)).toBe("flaky CI");
        expect(resultSummary(block)).toBe("flaky CI");
      }
      expect(parse).toHaveBeenCalledTimes(1);
      // A new block (a changed result) is read afresh.
      expect(classifyResult(ok('{"added":false}'))).toBe("failed");
      expect(parse).toHaveBeenCalledTimes(2);
    } finally {
      parse.mockRestore();
    }
  });
});

describe("pairToolResults", () => {
  const assistant = (id: string, ...calls: string[]): ChatMessage => ({
    id,
    role: "assistant",
    content: calls.map((c) => ({
      type: "tool_use",
      id: c,
      name: "tool_retro_list_state",
      input: {},
    })),
    createdAt: "2026-11-12T09:00:00Z",
  });
  const tool = (id: string, ...results: Array<[string, string]>): ChatMessage => ({
    id,
    role: "tool",
    content: results.map(([callId, content]) => ({
      type: "tool_result",
      tool_use_id: callId,
      content,
    })),
    createdAt: "2026-11-12T09:00:01Z",
  });

  it("pairs each result with its own round's call, even when ids repeat", () => {
    const pairs = pairToolResults([
      assistant("a1", "tc_0"),
      tool("t1", ["tc_0", '{"round":1}']),
      assistant("a2", "tc_0"),
      tool("t2", ["tc_0", '{"round":2}']),
    ]);
    expect(pairs.resultOf("a1", "tc_0")?.content).toBe('{"round":1}');
    expect(pairs.resultOf("a2", "tc_0")?.content).toBe('{"round":2}');
    expect(pairs.answersACall("t1", 0)).toBe(true);
    expect(pairs.answersACall("t2", 0)).toBe(true);
    expect(pairs.latestAssistantId).toBe("a2");
  });

  it("leaves a result with no call in the chat unanswered, so it still shows", () => {
    const pairs = pairToolResults([
      assistant("a1", "c1"),
      tool("t1", ["c1", "{}"], ["c9", "Cancelled."]),
    ]);
    expect(pairs.answersACall("t1", 0)).toBe(true);
    expect(pairs.answersACall("t1", 1)).toBe(false);
    expect(pairs.resultOf("a1", "c9")).toBeUndefined();
  });

  it("never pairs a result with an earlier round's call", () => {
    const pairs = pairToolResults([
      assistant("a1", "c1"),
      assistant("a2", "c2"),
      tool("t1", ["c1", "{}"]),
    ]);
    expect(pairs.resultOf("a1", "c1")).toBeUndefined();
    expect(pairs.answersACall("t1", 0)).toBe(false);
  });
});

describe("stepState", () => {
  const call = (input: Record<string, unknown> = { text: "x" }) => ({ id: "c1", input });

  it("lets a result decide", () => {
    expect(stepState(call(), ok("{}"), { live: true, pendingId: "c1" })).toBe("done");
    expect(stepState(call(), err("Cancelled."), {})).toBe("stopped");
  });

  it("waits while the call's card shows", () => {
    expect(stepState(call(), undefined, { pendingId: "c1", live: true })).toBe("waiting");
    expect(stepState(call(), undefined, { pendingId: "other", live: true })).toBe("working");
  });

  it("is getting ready while the arguments stream, then working", () => {
    expect(stepState(call({ _partial: true }), undefined, { live: true })).toBe("preparing");
    expect(stepState(call(), undefined, { live: true })).toBe("working");
  });

  it("after the turn: arguments that never parsed didn't work, anything else is unknown", () => {
    expect(stepState(call({ _partial: true }), undefined, {})).toBe("failed");
    expect(stepState(call(), undefined, {})).toBeNull();
  });

  it("has words for every state, none in the first person", () => {
    for (const words of Object.values(STEP_WORDS)) {
      expect(words).not.toMatch(/\b(I|me|my|I'm)\b/);
      expect(words).not.toMatch(/[{}_]/);
    }
  });
});
