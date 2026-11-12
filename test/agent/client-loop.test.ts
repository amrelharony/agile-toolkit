/**
 * The agent's tool-use loop against a scripted server stream: what each round
 * asks the backend for (reasoning effort, token room, the turn's tools, the
 * site grounding), how optional usage is metered, what a failed stream leaves
 * in the transcript, and the round-limit wrap-up.
 *
 * The wrap-up keeps the tools with tool_choice "auto" — a deliberate change
 * from the plan's "send no tools": the history names this turn's tool_calls,
 * the endpoint rejects a body whose history names a tool absent from `tools`
 * (BUG-H5), and rewriting the history as plain text would meter the wrap-up
 * as a new turn. Any tool call it makes is dropped, and when it writes no
 * text a local note stands in.
 *
 * fetch is stubbed: GET is the route's mode probe, each POST takes the next
 * scripted SSE response. Persistence and tool execution are mocked; the
 * registry gets one probe action so the open tool has actions to offer (the
 * real registry's tool sets are pinned in client-tools.test.ts).
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { z } from "zod";

const h = vi.hoisted(() => ({
  recordChatUsage: vi.fn<(tokens: number, model: string) => Promise<void>>(async () => {}),
  appendMessages: vi.fn<(conversationId: string, msgs: unknown[]) => Promise<void>>(async () => {}),
  deleteMessagesBetween: vi.fn<
    (conversationId: string, afterIso: string, throughIso: string) => Promise<void>
  >(async () => {}),
  executeToolUse: vi.fn<
    (
      tu: { id: string; input?: Record<string, unknown> },
      opts?: { confirm: (summary: string) => Promise<boolean> }
    ) => Promise<{ type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }>
  >(async (tu) => ({
    type: "tool_result" as const,
    tool_use_id: tu.id,
    content: '{"ok":true}',
  })),
  guideFails: false,
}));

vi.mock("@/lib/agent/persist", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent/persist")>()),
  recordChatUsage: h.recordChatUsage,
  appendMessages: h.appendMessages,
  deleteMessagesBetween: h.deleteMessagesBetween,
}));
vi.mock("@/lib/agent/execute-tool", () => ({ executeToolUse: h.executeToolUse }));
vi.mock("@/lib/tools/guides", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tools/guides")>();
  return {
    ...actual,
    getGuide: (id: string) =>
      h.guideFails ? Promise.reject(new Error("guide chunk failed to load")) : actual.getGuide(id),
  };
});

import { renderHook } from "@testing-library/react";
import { registry } from "@/lib/actions/registry";
import { getToolById } from "@/lib/constants/tools";
import {
  NOTICE_TEXT,
  canRetryLastTurn,
  endNoteFor,
  goOn,
  ownerRefusalNotice,
  retryLastTurn,
  roundLimitNote,
  roundLimitNotice,
  sendUserMessage,
  usageTotal,
  WRAP_UP_INSTRUCTION,
} from "@/lib/agent/client";
import { useAgentStore } from "@/lib/agent/store";
import type { ChatMessage, ConversationMeta, ToolUseBlock } from "@/lib/agent/types";

const PROBE_TOOL = "tool_loop_probe_read_state";
registry.register({
  id: "tool.loop_probe.read_state",
  toolId: "tool.loop_probe",
  name: "read_state",
  category: "read",
  description: "Read the loop probe's state.",
  paramsSchema: z.object({}),
  handler: async () => ({}),
});

type Body = {
  model?: string;
  max_tokens?: number;
  reasoning_effort?: string;
  tool_choice?: unknown;
  tools?: Array<{ function: { name: string } }>;
  messages: Array<{ role: string; content: string | null }>;
};

/** An SSE response from OpenAI-style chunk objects ("[DONE]" passes through). */
function sse(...events: unknown[]): Response {
  const text = events
    .map((e) => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`)
    .join("");
  return new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const delta = (d: Record<string, unknown>, finish: string | null = null) => ({
  choices: [{ delta: d, finish_reason: finish }],
});

/** A plain text answer; `usage` rides on a trailing empty-choices chunk when given. */
function textTurn(text: string, usage?: Record<string, number>): Response {
  return sse(
    delta({ reasoning_content: "thinking it over" }),
    delta({ content: text }),
    delta({}, "stop"),
    ...(usage ? [{ choices: [], usage }] : []),
    "[DONE]"
  );
}

/** A round that calls the probe tool. */
function toolTurn(id: string, extra: unknown[] = []): Response {
  return sse(
    delta({
      tool_calls: [
        { index: 0, id, type: "function", function: { name: PROBE_TOOL, arguments: "" } },
      ],
    }),
    delta({ tool_calls: [{ index: 0, function: { arguments: "{}" } }] }),
    delta({}, "tool_calls"),
    ...extra,
    "[DONE]"
  );
}

/** Each POST takes the next response, or builds it from the request (to see its signal). */
let queue: Array<Response | ((init: RequestInit) => Response)>;
let posts: Body[];

beforeEach(() => {
  queue = [];
  posts = [];
  h.guideFails = false;
  h.recordChatUsage.mockClear();
  h.appendMessages.mockClear();
  h.deleteMessagesBetween.mockClear();
  h.executeToolUse.mockClear();
  useAgentStore.getState().reset();
  useAgentStore.setState({ lastTurnTokens: null });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init || init.method === "GET") {
        return Response.json({ mode: "server", model: "openclaw", provider: "openclaw" });
      }
      posts.push(JSON.parse(String(init.body)) as Body);
      const next = queue.shift();
      if (!next) throw new Error("unexpected POST");
      return typeof next === "function" ? next(init) : next;
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const send = (text: string, toolId: string | null = "loop-probe") =>
  sendUserMessage(text, { userId: "owner-1", toolId });

const lastAssistant = () =>
  useAgentStore
    .getState()
    .messages.filter((m) => m.role === "assistant")
    .at(-1);

describe("owner turns", () => {
  it("ask for high reasoning with room for it, on the server's model", async () => {
    queue = [textTurn("Hello")];
    await send("show the loop probe state");
    expect(posts).toHaveLength(1);
    expect(posts[0].model).toBe("openclaw");
    expect(posts[0].reasoning_effort).toBe("high");
    expect(posts[0].max_tokens).toBe(8192);
    expect(posts[0].messages[0].role).toBe("system");
  });

  it("offer the open tool's actions with tool_choice auto, never the whole registry", async () => {
    queue = [textTurn("Hello")];
    await send("hi");
    const names = posts[0].tools!.map((t) => t.function.name);
    expect(names).toContain(PROBE_TOOL);
    expect(names.length).toBeLessThanOrEqual(64);
    expect(posts[0].tool_choice).toBe("auto");
  });

  // Only reachable with a registry this bare: the real one always offers the
  // intent.* helpers (see client-tools.test.ts).
  it("send neither tools nor tool_choice when no action is offered at all", async () => {
    queue = [textTurn("Hello")];
    await send("hello there", null);
    expect(posts[0]).not.toHaveProperty("tools");
    expect(posts[0]).not.toHaveProperty("tool_choice");
  });

  it("show only the answer text, not the reasoning", async () => {
    queue = [textTurn("Hello")];
    await send("hi");
    expect(lastAssistant()?.content).toEqual([{ type: "text", text: "Hello" }]);
  });

  it("put the open tool's guide and related tools in the system prompt", async () => {
    queue = [textTurn("Here is how")];
    await send("how do I run a retrospective", "retro");
    const system = String(posts[0].messages[0].content);
    expect(system).toContain(`Current tool: ${getToolById("retro")!.name} (/retro)`);
    expect(system).toContain("How to run it:");
    expect(system).toMatch(/- \[[^\]]+\]\(\/[a-z0-9-]+\): /);
  });

  it("resolve a tool id given as a path, as older conversations stored it", async () => {
    queue = [textTurn("Here is how")];
    await send("how do I run a retrospective", "/retro");
    expect(String(posts[0].messages[0].content)).toContain(
      `Current tool: ${getToolById("retro")!.name} (/retro)`
    );
  });

  it("still go out when the tool's guide fails to load, with the tool but no guide", async () => {
    h.guideFails = true;
    queue = [textTurn("Here is how")];
    await send("how do I run a retrospective", "retro");
    expect(posts).toHaveLength(1);
    const system = String(posts[0].messages[0].content);
    expect(system).toContain(`Current tool: ${getToolById("retro")!.name} (/retro)`);
    expect(system).not.toContain("How to run it:");
    expect(useAgentStore.getState().error).toBeNull();
  });
});

/**
 * A response whose body delivers `events` one read at a time and then fails,
 * as a dropped connection does. (Erroring up front would discard the queued
 * events unread.) A string ("[DONE]") goes out as it is.
 */
function brokenStream(...events: unknown[]): Response {
  const enc = new TextEncoder();
  const pending = [...events];
  const body = new ReadableStream<Uint8Array>(
    {
      pull(c) {
        const e = pending.shift();
        if (e === undefined) c.error(new Error("upstream_idle_timeout"));
        else c.enqueue(enc.encode(`data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`));
      },
    },
    { highWaterMark: 0 }
  );
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** A complete probe tool call, without its finish chunk. */
const probeCall = (id: string) =>
  delta({
    tool_calls: [
      { index: 0, id, type: "function", function: { name: PROBE_TOOL, arguments: "{}" } },
    ],
  });

/** Every assistant tool_call in a request body has a tool message answering it. */
function everyToolCallAnswered(body: Body): boolean {
  const answered = new Set(
    body.messages
      .filter((m) => m.role === "tool")
      .map((m) => (m as unknown as { tool_call_id: string }).tool_call_id)
  );
  return body.messages.every((m) => {
    const calls = (m as unknown as { tool_calls?: Array<{ id: string }> }).tool_calls ?? [];
    return calls.every((c) => answered.has(c.id));
  });
}

describe("a round that doesn't finish", () => {
  /** The failure's own words go to the console, never to the chat. */
  let warn: MockInstance<typeof console.warn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it("drops a tool call whose stream failed before its finish, so the next turn is valid", async () => {
    queue = [brokenStream(probeCall("call_cut"))];
    // The call did stream in whole before the failure.
    const seen: string[] = [];
    const unsub = useAgentStore.subscribe((s) => {
      for (const c of s.messages.at(-1)?.content ?? []) if (c.type === "tool_use") seen.push(c.id);
    });
    await send("read the probe state", null);
    unsub();
    expect(seen).toContain("call_cut");
    expect(useAgentStore.getState().error).toBe(NOTICE_TEXT.streamFailed);
    expect(h.executeToolUse).not.toHaveBeenCalled();
    // Nothing to show was left: no empty bubble, no orphan tool_use.
    expect(useAgentStore.getState().messages.map((m) => m.role)).toEqual(["user"]);

    queue = [textTurn("Hello")];
    await send("try again", null);
    expect(everyToolCallAnswered(posts[1])).toBe(true);
    expect(posts[1].messages.filter((m) => m.role === "assistant")).toHaveLength(0);
  });

  it("keeps the text of a failed stream, without its tool call", async () => {
    queue = [brokenStream(delta({ content: "Reading it now." }), probeCall("call_cut"))];
    await send("read the probe state", null);
    expect(lastAssistant()?.content).toEqual([{ type: "text", text: "Reading it now." }]);
  });

  it("tells the owner in plain words, with the failure's own words in an [agent] console line", async () => {
    queue = [brokenStream(delta({ content: "Reading it now." }))];
    await send("read the probe state", null);
    const s = useAgentStore.getState();
    expect(s.notice).toEqual({
      tone: "error",
      kind: "stream_failed",
      text: "Amr couldn't finish answering. Try again, and check your connection if it keeps happening.",
    });
    expect(s.error).toBe(NOTICE_TEXT.streamFailed);
    // What did arrive stays.
    expect(textOf(lastAssistant())).toBe("Reading it now.");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("[agent] the answer stopped:", "upstream_idle_timeout");
  });

  // The connection can go down right after the stream's own [DONE]: the round
  // was whole already, so it ends as it would have on a clean close.
  it("takes a reply as complete when the connection breaks after [DONE]", async () => {
    queue = [brokenStream(delta({ content: "Hello" }), delta({}, "stop"), "[DONE]")];
    await send("hi", null);
    expect(lastAssistant()?.content).toEqual([{ type: "text", text: "Hello" }]);
    expect(useAgentStore.getState().error).toBeNull();
  });

  it("still runs a finished round's tool when the connection breaks after [DONE]", async () => {
    queue = [
      brokenStream(probeCall("call_done"), delta({}, "tool_calls"), "[DONE]"),
      textTurn("The probe is empty."),
    ];
    await send("read the probe state", null);
    expect(h.executeToolUse).toHaveBeenCalledTimes(1);
    expect(posts).toHaveLength(2);
    expect(everyToolCallAnswered(posts[1])).toBe(true);
    expect(lastAssistant()?.content).toEqual([{ type: "text", text: "The probe is empty." }]);
    expect(useAgentStore.getState().error).toBeNull();
  });

  it("still fails a round whose connection breaks after its finish but before [DONE]", async () => {
    queue = [brokenStream(probeCall("call_cut"), delta({}, "tool_calls"))];
    await send("read the probe state", null);
    expect(h.executeToolUse).not.toHaveBeenCalled();
    expect(useAgentStore.getState().error).toBe(NOTICE_TEXT.streamFailed);
    expect(useAgentStore.getState().messages.map((m) => m.role)).toEqual(["user"]);
  });

  it("drops a tool call when the stream ends without finish_reason tool_calls", async () => {
    for (const ending of [[], [delta({}, "stop")]]) {
      useAgentStore.getState().reset();
      queue = [sse(delta({ content: "On it." }), probeCall("call_x"), ...ending, "[DONE]")];
      await send("read the probe state", null);
      expect(h.executeToolUse).not.toHaveBeenCalled();
      expect(lastAssistant()?.content).toEqual([{ type: "text", text: "On it." }]);
    }
  });

  it("leaves no empty bubble when a round streams only reasoning", async () => {
    queue = [sse(delta({ reasoning_content: "hmm" }), delta({}, "length"), "[DONE]")];
    await send("hi", null);
    expect(useAgentStore.getState().messages.map((m) => m.role)).toEqual(["user"]);
  });
});

describe("usage metering", () => {
  it("records the turn's tokens against the server's model", async () => {
    queue = [textTurn("Hello", { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42 })];
    await send("hi");
    expect(h.recordChatUsage).toHaveBeenCalledWith(42, "openclaw");
    expect(useAgentStore.getState().lastTurnTokens).toBe(42);
  });

  it("is optional: no usage chunk records nothing and breaks nothing", async () => {
    queue = [textTurn("Hello")];
    await send("hi");
    expect(h.recordChatUsage).not.toHaveBeenCalled();
    expect(useAgentStore.getState().lastTurnTokens).toBeNull();
    expect(useAgentStore.getState().error).toBeNull();
  });

  it("reads usage from whichever chunk carries it, and adds prompt + completion when the total is missing", async () => {
    queue = [
      sse(
        delta({ content: "Hi" }),
        {
          choices: [{ delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 7, completion_tokens: 3 },
        },
        "[DONE]"
      ),
    ];
    await send("hi");
    expect(h.recordChatUsage).toHaveBeenCalledWith(10, "openclaw");
  });

  it("ignores `usage: null` on ordinary chunks", async () => {
    queue = [
      sse(
        { choices: [{ delta: { content: "Hi" }, finish_reason: null }], usage: null },
        { choices: [{ delta: {}, finish_reason: "stop" }], usage: null },
        "[DONE]"
      ),
    ];
    await send("hi");
    expect(h.recordChatUsage).not.toHaveBeenCalled();
  });

  it("takes the last count when a proxy repeats a running total within one round", async () => {
    queue = [
      sse(
        {
          choices: [{ delta: { content: "Hi" }, finish_reason: null }],
          usage: { total_tokens: 10 },
        },
        { choices: [{ delta: {}, finish_reason: "stop" }], usage: { total_tokens: 25 } },
        "[DONE]"
      ),
    ];
    await send("hi");
    expect(h.recordChatUsage).toHaveBeenCalledTimes(1);
    expect(h.recordChatUsage).toHaveBeenCalledWith(25, "openclaw");
  });

  it("records nothing for a zero count", async () => {
    queue = [textTurn("Hello", { total_tokens: 0 })];
    await send("hi");
    expect(h.recordChatUsage).not.toHaveBeenCalled();
    expect(useAgentStore.getState().lastTurnTokens).toBeNull();
  });

  it("sums the rounds of one turn", async () => {
    queue = [
      toolTurn("call_1", [{ choices: [], usage: { total_tokens: 100 } }]),
      textTurn("Done", { total_tokens: 50 }),
    ];
    await send("read the probe state");
    expect(h.recordChatUsage).toHaveBeenLastCalledWith(150, "openclaw");
    expect(useAgentStore.getState().lastTurnTokens).toBe(150);
  });
});

describe("usageTotal", () => {
  it("prefers total_tokens, else adds prompt + completion", () => {
    expect(usageTotal({ total_tokens: 42, prompt_tokens: 1 })).toBe(42);
    expect(usageTotal({ prompt_tokens: 4 })).toBe(4);
    expect(usageTotal({ completion_tokens: 3 })).toBe(3);
    expect(usageTotal({ prompt_tokens: 4, completion_tokens: 3 })).toBe(7);
    expect(usageTotal({ total_tokens: 0 })).toBe(0);
  });

  it("ignores counts that aren't finite, non-negative numbers", () => {
    expect(usageTotal({ total_tokens: -1 })).toBeNull();
    expect(usageTotal({ total_tokens: "5" })).toBeNull();
    expect(usageTotal({ total_tokens: Number.NaN })).toBeNull();
    expect(usageTotal({ total_tokens: Number.POSITIVE_INFINITY })).toBeNull();
    // A bad total falls back to the parts.
    expect(usageTotal({ total_tokens: -1, prompt_tokens: 2, completion_tokens: 2 })).toBe(4);
    expect(usageTotal({ prompt_tokens: "4", completion_tokens: null })).toBeNull();
  });

  it("returns null for anything that isn't a usage object", () => {
    for (const u of [undefined, null, {}, 5, "usage", []]) expect(usageTotal(u)).toBeNull();
  });
});

/** Ten tool rounds that each call the probe, then `wrapUp` as the eleventh response. */
function tenRoundsThen(wrapUp: Response): void {
  for (let i = 0; i < 10; i++) queue.push(toolTurn(`call_${i}`));
  queue.push(wrapUp);
}

describe("round-limit wrap-up", () => {
  it("asks for a short, low-effort summary", async () => {
    tenRoundsThen(textTurn("Summary: read the state ten times."));
    await send("keep reading the probe state");
    expect(posts).toHaveLength(11);
    expect(posts[10].max_tokens).toBe(4096);
    expect(posts[10].reasoning_effort).toBe("low");
    // The tool rounds keep their high effort and full room.
    expect(posts[9].reasoning_effort).toBe("high");
    expect(posts[9].max_tokens).toBe(8192);
  });

  it("keeps the tools with tool_choice auto, says to stop, and drops any tool call", async () => {
    for (let i = 0; i < 10; i++) queue.push(toolTurn(`call_${i}`));
    // The model ignores the instruction and calls a tool again, after its text.
    queue.push(
      sse(
        delta({ content: "Summary: read the state ten times." }),
        delta({
          tool_calls: [
            {
              index: 0,
              id: "call_x",
              type: "function",
              function: { name: PROBE_TOOL, arguments: "{}" },
            },
          ],
        }),
        delta({}, "tool_calls"),
        "[DONE]"
      )
    );
    await send("keep reading the probe state");

    expect(posts).toHaveLength(11);
    expect(h.executeToolUse).toHaveBeenCalledTimes(10);

    const wrapUp = posts[10];
    expect(wrapUp.tool_choice).toBe("auto");
    expect(wrapUp.tools!.map((t) => t.function.name)).toContain(PROBE_TOOL);
    const wrapUpSystem = String(wrapUp.messages[0].content);
    expect(wrapUpSystem).toContain("You cannot call any more tools");
    // Its answer is the reply, so the instruction has no dashes for the model to copy.
    expect(wrapUpSystem.endsWith(`\n\n${WRAP_UP_INSTRUCTION}`)).toBe(true);
    expect(WRAP_UP_INSTRUCTION).not.toMatch(/[–—]/);
    // Still ends on a tool result, so the route doesn't meter it as a new turn.
    expect(wrapUp.messages.at(-1)?.role).toBe("tool");
    expect(posts.every((p) => p.tool_choice !== "none")).toBe(true);

    // The stray tool call is gone; the text stays, and no orphan tool_call is left.
    expect(lastAssistant()?.content).toEqual([
      { type: "text", text: "Summary: read the state ten times." },
    ]);
    // A gentle note, in the third person: never an error, so Amr doesn't frown.
    expect(useAgentStore.getState().notice).toEqual({
      tone: "note",
      kind: "round_limit",
      text: "Amr reached his limit of 10 tool rounds for one request. Send a follow-up and he'll carry on.",
    });
    expect(useAgentStore.getState().error).toBeNull();
  });

  const NOTE_START = "Amr used all 10 tool rounds for this request before he could sum up.";

  it("shows and saves a local note when the wrap-up answers with only a tool call", async () => {
    tenRoundsThen(
      sse(
        delta({ reasoning_content: "one more read" }),
        probeCall("call_x"),
        delta({}, "tool_calls"),
        "[DONE]"
      )
    );
    await sendUserMessage("keep reading the probe state", {
      userId: "owner-1",
      toolId: "loop-probe",
      conversationId: "conv-1",
    });

    const last = lastAssistant()!;
    expect(last.content).toHaveLength(1);
    const note = (last.content[0] as { text: string }).text;
    expect(note.startsWith(NOTE_START)).toBe(true);
    expect(note).toContain("10 tool calls; none failed");
    // No empty bubble anywhere, and the note is what gets saved.
    for (const m of useAgentStore.getState().messages) expect(m.content.length).toBeGreaterThan(0);
    const saved = h.appendMessages.mock.calls.at(-1)![1] as ChatMessage[];
    expect(saved).toEqual([last]);
    expect(note.endsWith("Send a follow-up and he'll carry on.")).toBe(true);
    expect(useAgentStore.getState().notice).toEqual(roundLimitNotice());
  });

  it("shows the note when the wrap-up's reasoning uses up its tokens", async () => {
    tenRoundsThen(sse(delta({ reasoning_content: "thinking…" }), delta({}, "length"), "[DONE]"));
    await send("keep reading the probe state");
    const text = (lastAssistant()!.content[0] as { text: string }).text;
    expect(text.startsWith(NOTE_START)).toBe(true);
  });

  it("shows the note when the wrap-up request itself fails", async () => {
    tenRoundsThen(new Response("bad gateway", { status: 502 }));
    await send("keep reading the probe state");
    const text = (lastAssistant()!.content[0] as { text: string }).text;
    expect(text.startsWith(NOTE_START)).toBe(true);
    // The note answers after the last tool result.
    expect(useAgentStore.getState().messages.at(-1)?.role).toBe("assistant");
    // The turn ends on the round limit, not on the wrap-up's own refusal.
    expect(useAgentStore.getState().notice?.kind).toBe("round_limit");
  });

  it("names the actions that failed", async () => {
    h.executeToolUse.mockImplementation(async (tu: { id: string }) => ({
      type: "tool_result" as const,
      tool_use_id: tu.id,
      content: "boom",
      ...(tu.id === "call_3" ? { is_error: true } : {}),
    }));
    try {
      tenRoundsThen(sse(delta({}, "stop"), "[DONE]"));
      await send("keep reading the probe state");
      const text = (lastAssistant()!.content[0] as { text: string }).text;
      expect(text).toContain("10 tool calls; 1 failed (`tool.loop_probe.read_state`)");
    } finally {
      h.executeToolUse.mockReset();
      h.executeToolUse.mockImplementation(async (tu: { id: string }) => ({
        type: "tool_result" as const,
        tool_use_id: tu.id,
        content: '{"ok":true}',
      }));
    }
  });
});

describe("roundLimitNote", () => {
  const at = (id: string, role: ChatMessage["role"], content: ChatMessage["content"]) =>
    ({ id, role, content, createdAt: "" }) as ChatMessage;

  it("counts only this turn's tool results, since the last user message", () => {
    const msgs = [
      at("u0", "user", [{ type: "text", text: "earlier" }]),
      at("a0", "assistant", [{ type: "tool_use", id: "old", name: PROBE_TOOL, input: {} }]),
      at("t0", "tool", [{ type: "tool_result", tool_use_id: "old", content: "x", is_error: true }]),
      at("u1", "user", [{ type: "text", text: "now" }]),
      at("a1", "assistant", [{ type: "tool_use", id: "c1", name: PROBE_TOOL, input: {} }]),
      at("t1", "tool", [{ type: "tool_result", tool_use_id: "c1", content: "ok" }]),
    ];
    expect(roundLimitNote(msgs)).toContain("This turn ran 1 tool call; none failed.");
  });

  it("names a failure from its own round's call when a later round reuses the id", () => {
    const msgs = [
      at("u1", "user", [{ type: "text", text: "now" }]),
      at("a1", "assistant", [{ type: "tool_use", id: "tc_0", name: PROBE_TOOL, input: {} }]),
      at("t1", "tool", [
        { type: "tool_result", tool_use_id: "tc_0", content: "x", is_error: true },
      ]),
      at("a2", "assistant", [{ type: "tool_use", id: "tc_0", name: "tool_gone_away", input: {} }]),
      at("t2", "tool", [{ type: "tool_result", tool_use_id: "tc_0", content: "ok" }]),
    ];
    expect(roundLimitNote(msgs)).toContain("2 tool calls; 1 failed (`tool.loop_probe.read_state`)");
  });
});

/**
 * A streamed response the test feeds by hand. Like a real one, its body fails
 * with an AbortError once its request is aborted.
 */
function manualStream() {
  const enc = new TextEncoder();
  let ctl!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      ctl = c;
    },
  });
  const quietly = (fn: () => void) => {
    try {
      fn();
    } catch {
      /* the reader already let go of the stream */
    }
  };
  return {
    respond(init: RequestInit): Response {
      init.signal?.addEventListener(
        "abort",
        () => quietly(() => ctl.error(Object.assign(new Error("aborted"), { name: "AbortError" }))),
        { once: true }
      );
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    },
    /** Events as one network chunk ("[DONE]" passes through). */
    send(...events: unknown[]) {
      const text = events
        .map((e) => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`)
        .join("");
      quietly(() => ctl.enqueue(enc.encode(text)));
    },
    end() {
      quietly(() => ctl.close());
    },
  };
}

const textOf = (m: ChatMessage | undefined) =>
  (m?.content ?? []).map((c) => (c.type === "text" ? c.text : "")).join("");

const at = (id: string, role: ChatMessage["role"], content: ChatMessage["content"]) =>
  ({ id, role, content, createdAt: "" }) as ChatMessage;

const meta = (id: string): ConversationMeta => ({
  id,
  title: id,
  toolId: null,
  createdAt: "",
  updatedAt: "",
  lastMessageAt: "",
});

/** Every message saved to `conversationId`, in order. */
const savedTo = (conversationId: string) =>
  h.appendMessages.mock.calls
    .filter((c) => c[0] === conversationId)
    .flatMap((c) => c[1] as ChatMessage[]);

/** Let the stream's pending read and everything after it run. */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

const sendIn = (conversationId: string, text: string, toolId: string | null = null) =>
  sendUserMessage(text, { userId: "owner-1", toolId, conversationId });

const otherThread = () => [
  at("o1", "user", [{ type: "text", text: "what is WSJF?" }]),
  at("o2", "assistant", [{ type: "text", text: "Weighted shortest job first." }]),
];

describe("a turn stays in its own thread", () => {
  it("New chat mid-answer stops the turn and writes nothing into the fresh chat", async () => {
    const body = manualStream();
    queue = [(init) => body.respond(init)];
    const turn = sendIn("conv-1", "tell me about retros");
    body.send(delta({ content: "Retros are" }));
    await vi.waitFor(() => expect(textOf(lastAssistant())).toBe("Retros are"));
    // The turn's abort is with the store while it runs.
    expect(useAgentStore.getState().abortHook).toBeTypeOf("function");

    useAgentStore.getState().reset();
    body.send(delta({ content: " a team's look back." }), delta({}, "stop"), "[DONE]");
    await turn;

    const s = useAgentStore.getState();
    expect(s.messages).toEqual([]);
    expect(s.streaming).toBe(false);
    expect(s.streamingMessageId).toBeNull();
    expect(s.notice).toBeNull();
    expect(s.abortHook).toBeNull();
    expect(posts).toHaveLength(1);
    // Only the question was saved: the cut reply reaches no conversation.
    expect(savedTo("conv-1").map((m) => m.role)).toEqual(["user"]);

    // The fresh chat answers at once, with nothing of the old turn in it.
    queue = [textTurn("Hello")];
    await send("hi", null);
    expect(useAgentStore.getState().messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(posts[1].messages.slice(1)).toEqual([{ role: "user", content: "hi" }]);
  });

  it("opening another thread mid-answer leaves that thread's last reply as it was", async () => {
    const body = manualStream();
    queue = [(init) => body.respond(init)];
    const turn = sendIn("conv-1", "tell me about retros");
    body.send(delta({ content: "Retros are" }));
    await vi.waitFor(() => expect(textOf(lastAssistant())).toBe("Retros are"));

    const other = otherThread();
    useAgentStore.getState().setActiveConversation(meta("conv-2"), other);
    body.send(delta({ content: " a team's look back." }), delta({}, "stop"), "[DONE]");
    await turn;

    const s = useAgentStore.getState();
    expect(s.activeConversationId).toBe("conv-2");
    expect(s.messages).toEqual(otherThread());
    expect(s.streaming).toBe(false);
    expect(s.notice).toBeNull();
    expect(savedTo("conv-1").map((m) => m.role)).toEqual(["user"]);
    expect(savedTo("conv-2")).toEqual([]);
  });

  it("opening another thread while a change waits denies it, keeps its saved thread whole and shows nothing in the other", async () => {
    h.executeToolUse.mockImplementationOnce(async (tu, opts) => {
      const ok = await opts!.confirm("Read the loop probe's state?");
      return {
        type: "tool_result",
        tool_use_id: tu.id,
        content: ok ? '{"ok":true}' : "The user declined.",
        ...(ok ? {} : { is_error: true }),
      };
    });
    queue = [toolTurn("call_1")];
    const turn = sendIn("conv-1", "read the probe state", "loop-probe");
    await vi.waitFor(() => expect(useAgentStore.getState().pendingToolUse).not.toBeNull());

    useAgentStore.getState().setActiveConversation(meta("conv-2"), otherThread());
    await turn;

    const s = useAgentStore.getState();
    expect(s.messages).toEqual(otherThread());
    expect(s.pendingToolUse).toBeNull();
    expect(s.streaming).toBe(false);
    expect(s.notice).toBeNull();
    // No next round went out from the other thread.
    expect(posts).toHaveLength(1);
    // The turn's own thread was saved with the call and its (denied) result.
    const saved = savedTo("conv-1");
    expect(saved.map((m) => m.role)).toEqual(["user", "assistant", "tool"]);
    expect(saved[2].content).toEqual([
      expect.objectContaining({ tool_use_id: "call_1", is_error: true }),
    ]);
    expect(savedTo("conv-2")).toEqual([]);
  });

  it("Stop through the store ends the answer where it is, with no error and no note", async () => {
    const body = manualStream();
    queue = [(init) => body.respond(init)];
    const turn = sendIn("conv-1", "tell me about retros");
    body.send(delta({ content: "Retros are" }));
    await vi.waitFor(() => expect(textOf(lastAssistant())).toBe("Retros are"));

    useAgentStore.getState().abortTurn("stop");
    await turn;

    const s = useAgentStore.getState();
    expect(s.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(textOf(lastAssistant())).toBe("Retros are");
    expect(s.streaming).toBe(false);
    expect(s.notice).toBeNull();
    expect(s.abortHook).toBeNull();
    expect(posts).toHaveLength(1);
  });
});

describe("a turn outlives the panel", () => {
  it("closing the panel mid-answer, and its views unmounting, lets the reply finish in the store", async () => {
    const body = manualStream();
    queue = [(init) => body.respond(init)];
    useAgentStore.getState().openSheet();
    // Stands in for the panel's views, which read the chat from the store.
    const view = renderHook(() => useAgentStore((s) => s.messages));
    const turn = sendIn("conv-1", "tell me about retros");
    body.send(delta({ content: "Retros are" }));
    await vi.waitFor(() => expect(textOf(view.result.current.at(-1))).toBe("Retros are"));

    useAgentStore.getState().closeSheet();
    view.unmount();
    body.send(delta({ content: " a team's look back." }), delta({}, "stop"), "[DONE]");
    body.end();
    await turn;

    const s = useAgentStore.getState();
    expect(s.open).toBe(false);
    expect(textOf(lastAssistant())).toBe("Retros are a team's look back.");
    expect(s.streaming).toBe(false);
    expect(s.notice).toBeNull();
    expect(savedTo("conv-1").map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(textOf(savedTo("conv-1")[1])).toBe("Retros are a team's look back.");
  });
});

describe("the owner's history on the wire", () => {
  it("sends every tool call with its result and every result with its call, leaving orphans out", async () => {
    const call = (id: string): ToolUseBlock => ({
      type: "tool_use",
      id,
      name: PROBE_TOOL,
      input: {},
    });
    useAgentStore.setState({
      messages: [
        at("u0", "user", [{ type: "text", text: "first" }]),
        // A call that never got its result (a turn stopped between the two).
        at("a0", "assistant", [{ type: "text", text: "Checking." }, call("lost_call")]),
        at("u1", "user", [{ type: "text", text: "second" }]),
        at("a1", "assistant", [call("call_ok"), call("no_result")]),
        at("t1", "tool", [
          { type: "tool_result", tool_use_id: "call_ok", content: "ok" },
          // Results that answer nothing this message called, or answer it twice.
          { type: "tool_result", tool_use_id: "stray", content: "?" },
          { type: "tool_result", tool_use_id: "call_ok", content: "again" },
        ]),
        at("a2", "assistant", [{ type: "text", text: "Done." }]),
        // A result whose call is an earlier message's, not the one before it.
        at("t2", "tool", [{ type: "tool_result", tool_use_id: "call_ok", content: "late" }]),
        // A message whose only call has no result wires to nothing at all.
        at("a3", "assistant", [call("only_orphan")]),
      ],
    });
    queue = [textTurn("Hello")];
    await send("third", null);

    expect(posts[0].messages.slice(1)).toEqual([
      { role: "user", content: "first" },
      { role: "assistant", content: "Checking." },
      { role: "user", content: "second" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "call_ok", type: "function", function: { name: PROBE_TOOL, arguments: "{}" } },
        ],
      },
      { role: "tool", tool_call_id: "call_ok", content: "ok" },
      { role: "assistant", content: "Done." },
      { role: "user", content: "third" },
    ]);
    expect(everyToolCallAnswered(posts[0])).toBe(true);
  });
});

describe("streamed writes", () => {
  /** Frames asked for and not yet run, by id. */
  let frames: Map<number, FrameRequestCallback>;
  let raf: ReturnType<typeof vi.fn<(cb: FrameRequestCallback) => number>>;
  let caf: ReturnType<typeof vi.fn<(id: number) => void>>;

  beforeEach(() => {
    frames = new Map();
    let next = 0;
    raf = vi.fn((cb: FrameRequestCallback) => {
      frames.set(++next, cb);
      return next;
    });
    caf = vi.fn((id: number) => {
      frames.delete(id);
    });
    vi.stubGlobal("requestAnimationFrame", raf);
    vi.stubGlobal("cancelAnimationFrame", caf);
  });

  const runFrames = () => {
    const due = Array.from(frames.values());
    frames.clear();
    for (const cb of due) cb(performance.now());
  };

  /** The streamed reply's text at each store write that changed its content. */
  function recordWrites(): { writes: string[]; stop: () => void } {
    const writes: string[] = [];
    const stop = useAgentStore.subscribe((s, prev) => {
      const now = s.messages.find((m) => m.role === "assistant");
      const before = now && prev.messages.find((m) => m.id === now.id);
      if (now && before && now.content !== before.content) writes.push(textOf(now));
    });
    return { writes, stop };
  }

  it("writes the reply at most once per animation frame, and its final state at once at the end", async () => {
    const body = manualStream();
    queue = [(init) => body.respond(init)];
    const { writes, stop } = recordWrites();
    const turn = send("hi", null);
    await vi.waitFor(() => expect(lastAssistant()).toBeDefined());
    expect(useAgentStore.getState().streamingMessageId).toBe(lastAssistant()!.id);

    body.send(delta({ content: "One" }), delta({ content: " two" }), delta({ content: " three" }));
    await tick();
    expect(raf).toHaveBeenCalledTimes(1);
    expect(writes).toEqual([]);
    // More text before the frame comes rides on the same frame.
    body.send(delta({ content: " four" }));
    await tick();
    expect(raf).toHaveBeenCalledTimes(1);
    runFrames();
    expect(writes).toEqual(["One two three four"]);

    body.send(delta({ content: " five" }));
    await tick();
    expect(raf).toHaveBeenCalledTimes(2);
    // The stream ends before that frame: its last state is written at once,
    // and the frame is called off, so nothing writes after the reply settles.
    body.send(delta({}, "stop"), "[DONE]");
    body.end();
    await turn;
    stop();

    expect(writes).toEqual(["One two three four", "One two three four five"]);
    expect(caf).toHaveBeenCalled();
    expect(frames.size).toBe(0);
    expect(useAgentStore.getState().streamingMessageId).toBeNull();
  });

  it("asks for no write for reasoning, or for arguments still streaming in", async () => {
    const body = manualStream();
    queue = [(init) => body.respond(init)];
    const turn = send("hi", null);
    await vi.waitFor(() => expect(lastAssistant()).toBeDefined());

    body.send(delta({ reasoning_content: "hmm" }));
    await tick();
    expect(raf).not.toHaveBeenCalled();
    // A new call shows up (with the marker), once.
    body.send(
      delta({
        tool_calls: [
          {
            index: 0,
            id: "call_a",
            type: "function",
            function: { name: PROBE_TOOL, arguments: "" },
          },
        ],
      })
    );
    await tick();
    expect(raf).toHaveBeenCalledTimes(1);
    runFrames();
    body.send(
      delta({ reasoning_content: "more" }),
      delta({ tool_calls: [{ index: 0, function: { arguments: '{"a"' } }] }),
      delta({ tool_calls: [{ index: 0, function: { arguments: ":1}" } }] })
    );
    await tick();
    expect(raf).toHaveBeenCalledTimes(1);
    body.send(delta({}, "stop"), "[DONE]");
    body.end();
    await turn;
  });

  it("waits 50 ms instead of a frame while the tab is hidden", async () => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    try {
      const body = manualStream();
      queue = [(init) => body.respond(init)];
      const turn = send("hi", null);
      body.send(delta({ content: "Hello" }));
      // No frame comes in a hidden tab (and none runs here): a timer writes.
      await vi.waitFor(() => expect(textOf(lastAssistant())).toBe("Hello"));
      expect(raf).not.toHaveBeenCalled();
      body.send(delta({}, "stop"), "[DONE]");
      body.end();
      await turn;
    } finally {
      Reflect.deleteProperty(document, "hidden");
    }
    expect(document.hidden).toBe(false);
  });
});

describe("a tool call's arguments", () => {
  const toolUses = () =>
    (lastAssistant()?.content ?? []).filter((c): c is ToolUseBlock => c.type === "tool_use");

  it("show a cheap marker while they stream, and are parsed once the call's block closes", async () => {
    const body = manualStream();
    queue = [(init) => body.respond(init), textTurn("Done.")];
    const inputs: unknown[] = [];
    const stop = useAgentStore.subscribe((s) => {
      for (const m of s.messages) {
        for (const c of m.content) if (c.type === "tool_use") inputs.push(c.input);
      }
    });
    const turn = send("read the probe state twice", null);

    body.send(
      delta({
        tool_calls: [
          {
            index: 0,
            id: "call_a",
            type: "function",
            function: { name: PROBE_TOOL, arguments: '{"te' },
          },
        ],
      })
    );
    await vi.waitFor(() => expect(toolUses().map((c) => c.input)).toEqual([{ _partial: true }]));
    body.send(delta({ tool_calls: [{ index: 0, function: { arguments: 'xt":"hi"}' } }] }));
    // The next call starting closes the first one.
    body.send(
      delta({
        tool_calls: [
          {
            index: 1,
            id: "call_b",
            type: "function",
            function: { name: PROBE_TOOL, arguments: "{" },
          },
        ],
      })
    );
    await vi.waitFor(() =>
      expect(toolUses().map((c) => c.input)).toEqual([{ text: "hi" }, { _partial: true }])
    );
    body.send(
      delta({ tool_calls: [{ index: 1, function: { arguments: "}" } }] }),
      delta({}, "tool_calls"),
      "[DONE]"
    );
    body.end();
    await turn;
    stop();

    expect(h.executeToolUse.mock.calls.map((c) => c[0].input)).toEqual([{ text: "hi" }, {}]);
    // The store never held the arguments as they streamed in, only the marker.
    for (const input of inputs) {
      const partial = (input as Record<string, unknown>)._partial;
      expect(partial === undefined || partial === true).toBe(true);
    }
    expect(everyToolCallAnswered(posts[1])).toBe(true);
  });

  it("that never parse keep the marker, so the call never runs", async () => {
    queue = [
      sse(
        delta({
          tool_calls: [
            {
              index: 0,
              id: "call_bad",
              type: "function",
              function: { name: PROBE_TOOL, arguments: '{"text": "cut' },
            },
          ],
        }),
        delta({}, "tool_calls"),
        "[DONE]"
      ),
    ];
    await send("read the probe state", null);
    expect(h.executeToolUse).not.toHaveBeenCalled();
    expect(useAgentStore.getState().messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(toolUses().map((c) => c.input)).toEqual([{ _partial: true }]);
    // Nothing ran and nothing came back: the turn says so rather than end silently.
    expect(useAgentStore.getState().notice).toEqual({
      tone: "note",
      kind: "no_answer",
      text: NOTICE_TEXT.noAnswer,
    });
    expect(useAgentStore.getState().error).toBeNull();
  });

  it("that never parse after some text say the answer may have been cut off", async () => {
    queue = [
      sse(
        delta({ content: "Let me check the probe" }),
        delta({
          tool_calls: [
            {
              index: 0,
              id: "call_bad",
              type: "function",
              function: { name: PROBE_TOOL, arguments: '{"text": "cut' },
            },
          ],
        }),
        delta({}, "tool_calls"),
        "[DONE]"
      ),
    ];
    await send("read the probe state", null);
    expect(h.executeToolUse).not.toHaveBeenCalled();
    expect(useAgentStore.getState().notice).toEqual({
      tone: "note",
      kind: "cut_off",
      text: NOTICE_TEXT.mayBeCut,
    });
    expect(useAgentStore.getState().error).toBeNull();
  });
});

describe("the owner's end notes", () => {
  it("says an answer cut by its length was cut short: a note, not an error", async () => {
    queue = [sse(delta({ content: "Retros are" }), delta({}, "length"), "[DONE]")];
    await send("tell me about retros", null);
    const s = useAgentStore.getState();
    expect(textOf(lastAssistant())).toBe("Retros are");
    expect(s.notice).toEqual({ tone: "note", kind: "cut_off", text: NOTICE_TEXT.cutShort });
    // Amr frowns only at errors: a note leaves the store's error clear.
    expect(s.error).toBeNull();
  });

  it("says so when the whole budget went on reasoning, instead of ending on nothing", async () => {
    queue = [sse(delta({ reasoning_content: "hmm" }), delta({}, "length"), "[DONE]")];
    await send("tell me about retros", null);
    const s = useAgentStore.getState();
    expect(s.messages.map((m) => m.role)).toEqual(["user"]);
    expect(s.notice).toEqual({ tone: "note", kind: "no_answer", text: NOTICE_TEXT.noRoom });
  });

  it("says he didn't manage an answer when the round ends with nothing to show", async () => {
    // A "stop" that still carried a call: the call goes, and nothing is left.
    queue = [sse(probeCall("call_x"), delta({}, "stop"), "[DONE]")];
    await send("read the probe state", null);
    const s = useAgentStore.getState();
    expect(s.messages.map((m) => m.role)).toEqual(["user"]);
    expect(s.notice).toEqual({ tone: "note", kind: "no_answer", text: NOTICE_TEXT.noAnswer });
    expect(h.executeToolUse).not.toHaveBeenCalled();
  });

  it.each([
    ["the stream just ends, with neither a finish nor [DONE]", [delta({ content: "Retros are" })]],
    [
      "the model's side stops it early",
      [delta({ content: "Retros are" }), delta({}, "content_filter"), "[DONE]"],
    ],
  ])("says an answer may be cut off when %s", async (_what, events) => {
    queue = [sse(...events)];
    await send("tell me about retros", null);
    expect(textOf(lastAssistant())).toBe("Retros are");
    expect(useAgentStore.getState().notice).toEqual({
      tone: "note",
      kind: "cut_off",
      text: NOTICE_TEXT.mayBeCut,
    });
  });

  it("says nothing after a finished answer", async () => {
    queue = [textTurn("Retros are a team's look back.")];
    await send("tell me about retros", null);
    expect(useAgentStore.getState().notice).toBeNull();
  });

  it("keeps the visitor route's time-limit words for visitors", () => {
    const timeLimit = { hasText: true, finishReason: "time_limit", cut: false };
    expect(endNoteFor({ ...timeLimit, visitor: true })?.text).toBe(NOTICE_TEXT.timeCut);
    expect(endNoteFor({ ...timeLimit, visitor: false })).toBeNull();
    expect(endNoteFor({ ...timeLimit, hasText: false, visitor: false })?.text).toBe(
      NOTICE_TEXT.noAnswer
    );
  });

  it("calls an action that kept failing a note, and stops", async () => {
    const failing = async (tu: { id: string }) => ({
      type: "tool_result" as const,
      tool_use_id: tu.id,
      content: "Invalid input for tool.loop_probe.read_state: bad",
      is_error: true,
    });
    h.executeToolUse.mockImplementationOnce(failing).mockImplementationOnce(failing);
    queue = [toolTurn("call_1"), toolTurn("call_2")];
    await send("read the probe state");
    const s = useAgentStore.getState();
    expect(posts).toHaveLength(2);
    expect(s.notice).toEqual({
      tone: "note",
      kind: "repeated_failure",
      text: "An action kept failing the same way, so Amr stopped. Try asking another way.",
    });
    expect(s.error).toBeNull();
  });
});

describe("a refusal of the owner's request", () => {
  let warn: MockInstance<typeof console.warn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  const RATE_HEADERS = { "x-ratelimit-daily": "50", "x-ratelimit-daily-max": "50" };
  const SERVICE_ERROR = "Amr's AI service hit an error. Try again in a moment.";

  it.each([
    [413, { error: "payload_too_large" }, "too_large", NOTICE_TEXT.tooLarge],
    [401, { error: "unauthorized" }, "signed_out", NOTICE_TEXT.signedOut],
    [403, { error: "forbidden" }, "signed_out", NOTICE_TEXT.signedOut],
    [429, { error: "rate_limited" }, "usage_limit", NOTICE_TEXT.usageLimit],
    [
      429,
      { error: "upstream" },
      "upstream_busy",
      "Amr's AI service is busy. Try again in a minute.",
    ],
    [401, { error: "upstream" }, "request_failed", NOTICE_TEXT.requestFailed],
    [500, { error: "upstream" }, "upstream_error", SERVICE_ERROR],
    [502, { error: "upstream_unreachable" }, "upstream_error", SERVICE_ERROR],
    [
      504,
      { error: "upstream_timeout" },
      "timeout",
      "Amr's AI service took too long to answer. Try again in a moment.",
    ],
    [400, { error: "invalid_body" }, "request_failed", NOTICE_TEXT.requestFailed],
  ] as const)(
    "turns a %i (%o) into plain words, with the detail for the console only",
    async (status, body, kind, text) => {
      queue = [Response.json(body, { status, headers: RATE_HEADERS })];
      await send("tell me about retros", null);
      const s = useAgentStore.getState();
      expect(s.notice).toEqual({ tone: "error", kind, text });
      expect(s.error).toBe(text);
      // No status code, no JSON, no "agent" or "assistant" in what the owner reads.
      expect(text).not.toMatch(/\d|\{|\bagent\b|\bassistant\b/i);
      expect(s.messages.map((m) => m.role)).toEqual(["user"]);
      expect(s.streaming).toBe(false);
      expect(warn).toHaveBeenCalledWith(
        `[agent] the request was refused (${status}):`,
        JSON.stringify(body)
      );
    }
  );

  it("marks the usage bar limited only for the route's own 429", async () => {
    queue = [Response.json({ error: "rate_limited" }, { status: 429, headers: RATE_HEADERS })];
    await send("tell me about retros", null);
    expect(useAgentStore.getState().rateLimit?.limited).toBe(true);

    queue = [Response.json({ error: "upstream" }, { status: 429, headers: RATE_HEADERS })];
    await send("tell me about retros", null);
    expect(useAgentStore.getState().rateLimit?.limited).toBe(false);
  });

  it("says nothing of a refusal that lands after Stop", async () => {
    let release: ((r: Response) => void) | null = null;
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      if (!init || init.method === "GET")
        return Response.json({ mode: "server", model: "openclaw" });
      return new Promise<Response>((r) => (release = r));
    });
    const turn = send("tell me about retros", null);
    await vi.waitFor(() => expect(release).not.toBeNull());
    useAgentStore.getState().abortTurn("stop");
    release!(Response.json({ error: "upstream" }, { status: 502 }));
    await turn;
    expect(useAgentStore.getState().notice).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("names a key of the owner's own, not the sign-in, when GLM turns it down", () => {
    expect(ownerRefusalNotice(401, true)).toMatchObject({ tone: "error", kind: "key_refused" });
    expect(ownerRefusalNotice(403, true).text).toBe(NOTICE_TEXT.keyRefused);
    expect(ownerRefusalNotice(429, true).kind).toBe("upstream_busy");
    expect(ownerRefusalNotice(413, true).kind).toBe("too_large");
  });
});

describe("Try again", () => {
  const WRITE_PROBE = "tool_loop_probe_write_state";
  beforeEach(() => {
    if (!registry.resolve(WRITE_PROBE)) {
      registry.register({
        id: "tool.loop_probe.write_state",
        toolId: "tool.loop_probe",
        name: "write_state",
        category: "write",
        description: "Change the loop probe's state.",
        paramsSchema: z.object({}),
        handler: async () => ({}),
      });
    }
  });

  const opts = { userId: "owner-1", toolId: null, conversationId: "conv-1" };
  const question = (id = "u1") => at(id, "user", [{ type: "text", text: "change the probe" }]);
  const callTo = (name: string, id = "c1") =>
    at(`a_${id}`, "assistant", [{ type: "tool_use", id, name, input: {} }]);
  const resultOf = (content: string, is_error?: boolean, id = "c1") =>
    at(`t_${id}`, "tool", [
      { type: "tool_result", tool_use_id: id, content, ...(is_error ? { is_error } : {}) },
    ]);

  it("runs the question again after a refusal, without a second copy of it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      queue = [new Response("bad gateway", { status: 502 })];
      await sendIn("conv-1", "read the probe state");
      expect(useAgentStore.getState().notice?.kind).toBe("upstream_error");
      expect(canRetryLastTurn(useAgentStore.getState().messages)).toBe(true);

      queue = [textTurn("The probe is empty.")];
      expect(await retryLastTurn(opts)).toBe(true);
      const s = useAgentStore.getState();
      expect(posts).toHaveLength(2);
      expect(posts[1].messages.slice(1)).toEqual([
        { role: "user", content: "read the probe state" },
      ]);
      expect(s.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
      expect(s.notice).toBeNull();
      // The question was saved once; the new answer joins it.
      expect(savedTo("conv-1").map((m) => m.role)).toEqual(["user", "assistant"]);
      expect(h.deleteMessagesBetween).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("drops what a read-only turn left, here and in the saved thread, and asks again", async () => {
    queue = [
      toolTurn("call_1"),
      sse(delta({ content: "The probe" }), delta({}, "length"), "[DONE]"),
    ];
    await sendIn("conv-1", "read the probe state", "loop-probe");
    const before = useAgentStore.getState().messages;
    expect(before.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"]);
    expect(useAgentStore.getState().notice?.kind).toBe("cut_off");

    queue = [textTurn("The probe is empty.")];
    expect(await retryLastTurn({ ...opts, toolId: "loop-probe" })).toBe(true);
    const s = useAgentStore.getState();
    expect(s.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(s.messages[0]).toBe(before[0]);
    expect(textOf(s.messages[1])).toBe("The probe is empty.");
    expect(posts[2].messages.slice(1)).toEqual([{ role: "user", content: "read the probe state" }]);
    // Everything after the question, up to the last of it, goes from the saved thread.
    const latest = Math.max(...before.slice(1).map((m) => Date.parse(m.createdAt)));
    expect(h.deleteMessagesBetween).toHaveBeenCalledWith(
      "conv-1",
      new Date(Date.parse(before[0].createdAt)).toISOString(),
      new Date(latest).toISOString()
    );
  });

  it("is refused once the turn ran a change, and sends nothing", async () => {
    const msgs = [question(), callTo(WRITE_PROBE), resultOf('{"ok":true}')];
    useAgentStore.setState({ messages: msgs });
    expect(canRetryLastTurn(msgs)).toBe(false);
    expect(await retryLastTurn(opts)).toBe(false);
    expect(posts).toHaveLength(0);
    expect(useAgentStore.getState().messages).toBe(msgs);
  });

  it("counts a change that failed inside its handler as run, and one denied or never valid as not", () => {
    const after = (content: string, is_error?: boolean) => [
      question(),
      callTo(WRITE_PROBE),
      resultOf(content, is_error),
    ];
    expect(canRetryLastTurn(after("Handler error: half way", true))).toBe(false);
    expect(
      canRetryLastTurn(after("User denied execution of tool.loop_probe.write_state.", true))
    ).toBe(true);
    expect(
      canRetryLastTurn(after("Invalid input for tool.loop_probe.write_state: bad", true))
    ).toBe(true);
    // Reads may run again; an action the registry doesn't know may not.
    expect(canRetryLastTurn([question(), callTo(PROBE_TOOL), resultOf("{}")])).toBe(true);
    expect(canRetryLastTurn([question(), callTo("tool_gone_away"), resultOf("{}")])).toBe(false);
    // Only the last turn counts, and there has to be one.
    expect(
      canRetryLastTurn([question("u0"), callTo(WRITE_PROBE), resultOf("{}"), question("u1")])
    ).toBe(true);
    expect(canRetryLastTurn([])).toBe(false);
  });

  it("reads each result against the calls just before it when an id comes back", () => {
    // A gateway that sends no ids gets `tc_0` every round.
    const round = (n: number, name: string, content: string) => [
      at(`a${n}`, "assistant", [{ type: "tool_use", id: "tc_0", name, input: {} }]),
      at(`t${n}`, "tool", [{ type: "tool_result", tool_use_id: "tc_0", content }]),
    ];
    // A change that ran stays a change when a later round's read takes its id.
    expect(
      canRetryLastTurn([
        question(),
        ...round(1, WRITE_PROBE, '{"ok":true}'),
        ...round(2, PROBE_TOOL, "{}"),
      ])
    ).toBe(false);
    expect(
      canRetryLastTurn([
        question(),
        ...round(1, PROBE_TOOL, "{}"),
        ...round(2, WRITE_PROBE, '{"ok":true}'),
      ])
    ).toBe(false);
    expect(
      canRetryLastTurn([question(), ...round(1, PROBE_TOOL, "{}"), ...round(2, PROBE_TOOL, "{}")])
    ).toBe(true);
  });

  it("does nothing while a turn is running", async () => {
    const body = manualStream();
    queue = [(init) => body.respond(init)];
    const turn = send("tell me about retros", null);
    await vi.waitFor(() => expect(lastAssistant()).toBeDefined());
    expect(await retryLastTurn(opts)).toBe(false);
    expect(await goOn(opts)).toBe(false);
    body.send(delta({ content: "Retros are" }), delta({}, "stop"), "[DONE]");
    body.end();
    await turn;
    expect(posts).toHaveLength(1);
    expect(useAgentStore.getState().messages.filter((m) => m.role === "user")).toHaveLength(1);
  });
});

describe("Go on", () => {
  it("sends a real user message, once, after an answer cut short", async () => {
    queue = [sse(delta({ content: "Retros are" }), delta({}, "length"), "[DONE]")];
    await sendIn("conv-1", "tell me about retros");
    expect(useAgentStore.getState().notice?.kind).toBe("cut_off");

    queue = [textTurn("a team's look back.")];
    expect(await goOn({ userId: "owner-1", toolId: null, conversationId: "conv-1" })).toBe(true);
    const s = useAgentStore.getState();
    expect(s.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(textOf(s.messages[2])).toBe("Go on");
    expect(posts[1].messages.slice(1)).toEqual([
      { role: "user", content: "tell me about retros" },
      { role: "assistant", content: "Retros are" },
      { role: "user", content: "Go on" },
    ]);
    expect(s.notice).toBeNull();
    expect(savedTo("conv-1").map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
  });
});
