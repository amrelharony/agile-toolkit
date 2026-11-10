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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const h = vi.hoisted(() => ({
  recordChatUsage: vi.fn<(tokens: number, model: string) => Promise<void>>(async () => {}),
  appendMessages: vi.fn<(conversationId: string, msgs: unknown[]) => Promise<void>>(async () => {}),
  executeToolUse: vi.fn(async (tu: { id: string }) => ({
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

import { registry } from "@/lib/actions/registry";
import { getToolById } from "@/lib/constants/tools";
import { roundLimitNote, sendUserMessage, usageTotal } from "@/lib/agent/client";
import { useAgentStore } from "@/lib/agent/store";
import type { ChatMessage } from "@/lib/agent/types";

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

let queue: Response[];
let posts: Body[];

beforeEach(() => {
  queue = [];
  posts = [];
  h.guideFails = false;
  h.recordChatUsage.mockClear();
  h.appendMessages.mockClear();
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
      return next;
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
    expect(useAgentStore.getState().error).toContain("upstream_idle_timeout");
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

  it("shows the owner the failure's own words, with no console line of the visitor's", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      queue = [brokenStream(delta({ content: "Reading it now." }))];
      await send("read the probe state", null);
      expect(useAgentStore.getState().error).toBe("upstream_idle_timeout");
      // The plain-words note and the console line behind it are a visitor's only.
      const visitorLines = warn.mock.calls.filter((c) => String(c[0]).includes("[visitor-ai]"));
      expect(visitorLines).toEqual([]);
    } finally {
      warn.mockRestore();
    }
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
    expect(useAgentStore.getState().error).toBe("upstream_idle_timeout");
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
    expect(String(wrapUp.messages[0].content)).toContain("You cannot call any more tools");
    // Still ends on a tool result, so the route doesn't meter it as a new turn.
    expect(wrapUp.messages.at(-1)?.role).toBe("tool");
    expect(posts.every((p) => p.tool_choice !== "none")).toBe(true);

    // The stray tool call is gone; the text stays, and no orphan tool_call is left.
    expect(lastAssistant()?.content).toEqual([
      { type: "text", text: "Summary: read the state ten times." },
    ]);
    expect(useAgentStore.getState().error).toBe(
      "Reached tool-use round limit (10). Send a follow-up if more is needed."
    );
  });

  const NOTE_START = "I used all 10 tool rounds for this request";

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
    expect(useAgentStore.getState().error).toContain("Reached tool-use round limit");
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
});
