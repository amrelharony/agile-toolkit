/**
 * The agent client's visitor path (visitor AI): sendUserMessage with
 * profile "visitor", against a scripted visitor route.
 *
 *  - Every request is a POST to VISITOR_AI_PATH with no cookies, carrying only
 *    the conversation (no system message), the turn's tools and the page's
 *    tool id; the route owns the model, the prompt and the limits.
 *  - No GET probe of /api/agent/stream, and nothing touches Supabase: the
 *    owner's persistence is mocked and must never be called.
 *  - The allowance headers are read on every response; a "no more AI for now"
 *    refusal sets visitorFallback, a busy or failing AI service only errors.
 *  - Every change asks first (autoApprove is ignored), only the tools offered
 *    with the request may run, tool results are cut, the history is trimmed,
 *    and a turn stops after VISITOR_LIMITS.maxToolRounds requests.
 *  - A call runs only when the next request can carry it back; the others
 *    leave the history unrun, so they are never offered through it either.
 *  - Every body the browser posts is one the route accepts: each is run
 *    through the server's own parseVisitorBody (see afterEach).
 *
 * fetch is stubbed; the real executeToolUse runs a few probe actions.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const h = vi.hoisted(() => ({
  persist: {
    fetchChatUsage: vi.fn(async () => null),
    listConversations: vi.fn(async () => []),
    createConversation: vi.fn(async () => null),
    loadMessages: vi.fn(async () => []),
    appendMessages: vi.fn(async () => {}),
    recordChatUsage: vi.fn(async () => {}),
    deleteConversation: vi.fn(async () => {}),
    renameConversation: vi.fn(async () => {}),
  },
  getAuthBrowserClient: vi.fn(() => null),
  added: [] as string[],
  wiped: 0,
  bigRead: false,
}));

vi.mock("@/lib/agent/persist", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent/persist")>()),
  ...h.persist,
}));
vi.mock("@/lib/auth/supabase-browser", () => ({
  getAuthBrowserClient: h.getAuthBrowserClient,
}));

import { registry } from "@/lib/actions/registry";
import { resetRegistryKbIndex } from "@/lib/agent/mascot/kb";
import {
  abortInFlight,
  cutToolResult,
  sendUserMessage,
  trimVisitorHistory,
} from "@/lib/agent/client";
import { parseVisitorBody } from "@/lib/visitor-ai/request";
import { parseVisitorQuota } from "@/lib/agent/rate-limit";
import { useAgentStore } from "@/lib/agent/store";
import {
  VISITOR_AI_PATH,
  VISITOR_FALLBACK_CODES,
  VISITOR_HEADERS,
  VISITOR_LIMITS,
  type VisitorErrorCode,
  type VisitorRequestBody,
} from "@/lib/visitor-ai/contract";
import type { ChatMessage } from "@/lib/agent/types";

registry.register({
  id: "tool.zorblax.read_state",
  toolId: "tool.zorblax",
  name: "read_state",
  category: "read",
  description: "Read the zorblax board and its cards.",
  paramsSchema: z.object({}),
  handler: async () => (h.bigRead ? "x".repeat(20_000) : { cards: h.added }),
});
registry.register({
  id: "tool.zorblax.add_card",
  toolId: "tool.zorblax",
  name: "add_card",
  category: "write",
  // Runs unasked for the owner; a visitor is asked anyway.
  requiresConfirmation: false,
  description: "Add a card to the zorblax board.",
  paramsSchema: z.object({ text: z.string() }),
  handler: async ({ text }: { text: string }) => {
    h.added.push(text);
    return { added: text };
  },
});
registry.register({
  id: "tool.flimflam.break_it",
  toolId: "tool.flimflam",
  name: "break_it",
  category: "read",
  description: "Check the flimflam board for breakage.",
  paramsSchema: z.object({}),
  handler: async () => {
    throw new Error("the flimflam board is broken");
  },
});
// A known action, open to visitors, that the zorblax requests below never offer.
registry.register({
  id: "tool.quuxly.wipe_vault",
  toolId: "tool.quuxly",
  name: "wipe_vault",
  category: "read",
  description: "Erase every gizmo in the quuxly vault.",
  paramsSchema: z.object({}),
  handler: async () => {
    h.wiped += 1;
    return { wiped: true };
  },
});
resetRegistryKbIndex();

type Call = { url: string; init?: RequestInit };

const QUOTA_HEADERS = {
  [VISITOR_HEADERS.remaining]: "62",
  [VISITOR_HEADERS.limit]: "100",
  [VISITOR_HEADERS.peak]: "0",
};

function sse(events: unknown[], headers: Record<string, string> = QUOTA_HEADERS): Response {
  const text = events
    .map((e) => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`)
    .join("");
  return new Response(text, {
    status: 200,
    headers: { "content-type": "text/event-stream", ...headers },
  });
}

const delta = (d: Record<string, unknown>, finish: string | null = null) => ({
  choices: [{ delta: d, finish_reason: finish }],
});

function textTurn(text: string, headers?: Record<string, string>): Response {
  return sse(
    [delta({ reasoning_content: "hmm" }), delta({ content: text }), delta({}, "stop"), "[DONE]"],
    headers
  );
}

function toolTurn(id: string, name: string, args: Record<string, unknown> = {}): Response {
  return toolsTurn([{ id, name, args }]);
}

/** One round calling several tools, with optional text before the calls. An id of "" sends none. */
function toolsTurn(
  calls: Array<{ id: string; name: string; args?: Record<string, unknown> }>,
  text?: string
): Response {
  return sse([
    ...(text ? [delta({ content: text })] : []),
    delta({
      tool_calls: calls.map((c, index) => ({
        index,
        ...(c.id ? { id: c.id } : {}),
        type: "function",
        function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
      })),
    }),
    delta({}, "tool_calls"),
    "[DONE]",
  ]);
}

function refusal(status: number, error: VisitorErrorCode, headers: Record<string, string> = {}) {
  return Response.json({ error }, { status, headers });
}

let queue: Response[];
let calls: Call[];
/** Bodies posted to the visitor route that the route's own parser refused. */
let refusedBodies: Array<{ error: string; body: unknown }>;
const posts = (): VisitorRequestBody[] =>
  calls
    .filter((c) => c.init?.method === "POST")
    .map((c) => JSON.parse(String(c.init?.body)) as VisitorRequestBody);

const askVisitor = (text: string, toolId: string | null = null) =>
  sendUserMessage(text, { userId: "visitor", profile: "visitor", toolId });

/** Wait for the visitor's confirmation card. */
const confirmation = () =>
  vi.waitFor(() => {
    const p = useAgentStore.getState().pendingToolUse;
    expect(p).not.toBeNull();
    return p as NonNullable<typeof p>;
  });

beforeEach(() => {
  queue = [];
  calls = [];
  refusedBodies = [];
  h.added = [];
  h.wiped = 0;
  h.bigRead = false;
  Object.values(h.persist).forEach((fn) => fn.mockClear());
  h.getAuthBrowserClient.mockClear();
  useAgentStore.getState().reset();
  useAgentStore.setState({ visitorQuota: null, chatProfile: "owner", autoApprove: false });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === VISITOR_AI_PATH) {
        const body: unknown = JSON.parse(String(init?.body));
        const parsed = parseVisitorBody(body);
        if (!parsed.ok) refusedBodies.push({ error: parsed.error, body });
      }
      const next = queue.shift();
      if (!next) throw new Error(`unexpected request to ${url}`);
      return next;
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  // What the browser sends, the route takes: never a 400 of the client's own making.
  expect(refusedBodies).toEqual([]);
});

describe("the visitor's requests", () => {
  it("posts to the visitor route with no cookies, no system message and only the allowed fields", async () => {
    queue.push(textTurn("Start with what went well. See [Retro](/retro)."));
    await askVisitor("How do I run a retro?", "retro");

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(VISITOR_AI_PATH);
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.credentials).toBe("omit");
    const body = posts()[0];
    expect(Object.keys(body).sort()).toEqual(["context", "messages"]);
    expect(body.messages).toEqual([{ role: "user", content: "How do I run a retro?" }]);
    expect(body.context).toEqual({ toolId: "retro" });

    const s = useAgentStore.getState();
    expect(s.chatProfile).toBe("visitor");
    expect(s.streaming).toBe(false);
    expect(s.error).toBeNull();
    const reply = s.messages.at(-1);
    expect(reply?.role).toBe("assistant");
    expect(reply?.content).toEqual([
      { type: "text", text: "Start with what went well. See [Retro](/retro)." },
    ]);
  });

  it("never writes a visitor's chat to a conversation, even when handed one", async () => {
    queue.push(toolTurn("c1", "tool_zorblax_read_state"), textTurn("Your board is empty."));
    await sendUserMessage("read my zorblax board", {
      userId: "visitor",
      profile: "visitor",
      conversationId: "c1",
    });
    expect(posts()).toHaveLength(2);
    expect(h.persist.appendMessages).not.toHaveBeenCalled();
    expect(h.persist.createConversation).not.toHaveBeenCalled();
  });

  it("never probes the owner's route and never touches Supabase or the owner's persistence", async () => {
    queue.push(toolTurn("c1", "tool_zorblax_read_state"), textTurn("Your board is empty."));
    await askVisitor("read my zorblax board");

    expect(calls.map((c) => c.url)).toEqual([VISITOR_AI_PATH, VISITOR_AI_PATH]);
    expect(calls.every((c) => c.init?.method === "POST")).toBe(true);
    expect(calls.some((c) => c.url.includes("/api/agent/stream"))).toBe(false);
    for (const [name, fn] of Object.entries(h.persist)) {
      expect(fn, name).not.toHaveBeenCalled();
    }
    expect(h.getAuthBrowserClient).not.toHaveBeenCalled();
  });

  it("offers the turn's tools and names the page's tool, never a VIP one", async () => {
    queue.push(textTurn("ok"));
    await askVisitor("add a zorblax card saying hi");
    const body = posts()[0];
    expect(body.tools?.map((t) => t.function.name).sort()).toEqual([
      "tool_zorblax_add_card",
      "tool_zorblax_read_state",
    ]);
    expect(body.tools?.length).toBeLessThanOrEqual(VISITOR_LIMITS.maxTools);
    expect(body.context).toEqual({});
  });

  it("cuts a long message to VISITOR_LIMITS.userChars", async () => {
    queue.push(textTurn("ok"));
    await askVisitor("a".repeat(VISITOR_LIMITS.userChars + 500));
    expect(posts()[0].messages[0]).toEqual({
      role: "user",
      content: "a".repeat(VISITOR_LIMITS.userChars),
    });
  });
});

describe("the visitor's allowance and refusals", () => {
  it("reads the allowance, busy hours included, from every response", async () => {
    const ends = "2026-11-09T10:00:00.000Z";
    queue.push(
      textTurn("hi", {
        [VISITOR_HEADERS.remaining]: "61",
        [VISITOR_HEADERS.limit]: "100",
        [VISITOR_HEADERS.peak]: "1",
        [VISITOR_HEADERS.peakRemaining]: "20",
        [VISITOR_HEADERS.peakLimit]: "25",
        [VISITOR_HEADERS.peakEnds]: ends,
      })
    );
    await askVisitor("What is WSJF?");
    expect(useAgentStore.getState().visitorQuota).toEqual({
      remaining: 61,
      limit: 100,
      peak: true,
      peakRemaining: 20,
      peakLimit: 25,
      peakEndsAt: ends,
      receivedAt: expect.any(Number),
    });
  });

  it.each(Array.from(VISITOR_FALLBACK_CODES))(
    "falls back to the offline guide on %s",
    async (code) => {
      queue.push(
        refusal(code === "disabled" || code === "meter_unavailable" ? 503 : 429, code, {
          [VISITOR_HEADERS.remaining]: "0",
          [VISITOR_HEADERS.limit]: "100",
          [VISITOR_HEADERS.peak]: "0",
        })
      );
      await askVisitor("What is WSJF?");
      const s = useAgentStore.getState();
      expect(s.visitorFallback).toBe(code);
      expect(s.error).toBeTruthy();
      expect(s.streaming).toBe(false);
      expect(s.messages.map((m) => m.role)).toEqual(["user"]);
      expect(calls).toHaveLength(1);
    }
  );

  it("reads the allowance on a refusal too", async () => {
    queue.push(
      refusal(429, "visitor_limit", {
        [VISITOR_HEADERS.remaining]: "0",
        [VISITOR_HEADERS.limit]: "100",
        [VISITOR_HEADERS.peak]: "0",
      })
    );
    await askVisitor("What is WSJF?");
    expect(useAgentStore.getState().visitorQuota).toMatchObject({ remaining: 0, limit: 100 });
  });

  it.each([
    [503, "upstream_busy"],
    [502, "upstream_error"],
    [504, "timeout"],
    [429, "slow_down"],
    [400, "bad_request"],
  ] as const)("only shows an error on %i %s", async (status, code) => {
    queue.push(refusal(status, code));
    await askVisitor("What is WSJF?");
    const s = useAgentStore.getState();
    expect(s.visitorFallback).toBeNull();
    expect(s.error).toBeTruthy();
    expect(s.streaming).toBe(false);
  });

  it("shows an error for a refusal without a code", async () => {
    queue.push(new Response("gateway down", { status: 502 }));
    await askVisitor("What is WSJF?");
    expect(useAgentStore.getState().visitorFallback).toBeNull();
    expect(useAgentStore.getState().error).toMatch(/error/i);
  });
});

describe("a round with no usable reply", () => {
  it("says so when the whole budget went on reasoning", async () => {
    queue.push(
      sse([delta({ reasoning_content: "hmm ".repeat(50) }), delta({}, "length"), "[DONE]"])
    );
    await askVisitor("What is WSJF?");
    const s = useAgentStore.getState();
    expect(s.messages.map((m) => m.role)).toEqual(["user"]);
    expect(s.error).toMatch(/ran out of room/);
    expect(s.streaming).toBe(false);
  });

  it("says so when a tool call was cut off half-way", async () => {
    queue.push(
      sse([
        delta({
          tool_calls: [
            {
              index: 0,
              id: "c1",
              type: "function",
              function: { name: "tool_zorblax_add_card", arguments: '{"text":"fla' },
            },
          ],
        }),
        delta({}, "length"),
        "[DONE]",
      ])
    );
    await askVisitor("add a zorblax card saying flaky CI");
    expect(h.added).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(useAgentStore.getState().messages.map((m) => m.role)).toEqual(["user"]);
    expect(useAgentStore.getState().error).toMatch(/ran out of room/);
  });

  it("keeps a reply cut off by length, and says it was cut", async () => {
    queue.push(sse([delta({ content: "Start with what" }), delta({}, "length"), "[DONE]"]));
    await askVisitor("How do I run a retro?");
    const s = useAgentStore.getState();
    expect(s.messages.at(-1)?.content).toEqual([{ type: "text", text: "Start with what" }]);
    expect(s.error).toMatch(/cut short/);
  });

  it("says nothing extra after a complete reply", async () => {
    queue.push(textTurn("All good."));
    await askVisitor("How do I run a retro?");
    expect(useAgentStore.getState().error).toBeNull();
  });
});

describe("the visitor's tool calls", () => {
  it("asks before every change, even one that never asks and with autoApprove on", async () => {
    useAgentStore.setState({ autoApprove: true });
    queue.push(
      toolTurn("c1", "tool_zorblax_add_card", { text: "flaky CI" }),
      textTurn("Added it.")
    );
    const turn = askVisitor("add a zorblax card saying flaky CI");

    await vi.waitFor(() => expect(useAgentStore.getState().pendingToolUse).not.toBeNull());
    expect(h.added).toEqual([]);
    expect(calls).toHaveLength(1);
    useAgentStore.getState().pendingToolUse?.resolve(true);
    await turn;

    expect(h.added).toEqual(["flaky CI"]);
    const second = posts()[1];
    expect(second.messages.at(-1)).toEqual({
      role: "tool",
      tool_call_id: "c1",
      content: JSON.stringify({ added: "flaky CI" }),
    });
  });

  it("tells the model when the visitor says no", async () => {
    queue.push(
      toolTurn("c1", "tool_zorblax_add_card", { text: "flaky CI" }),
      textTurn("Okay, I left it.")
    );
    const turn = askVisitor("add a zorblax card saying flaky CI");
    await vi.waitFor(() => expect(useAgentStore.getState().pendingToolUse).not.toBeNull());
    useAgentStore.getState().pendingToolUse?.resolve(false);
    await turn;

    expect(h.added).toEqual([]);
    expect(posts()[1].messages.at(-1)).toMatchObject({
      role: "tool",
      content: expect.stringContaining("User denied"),
    });
  });

  it("never runs a tool that wasn't offered: the call leaves the chat and the turn stops", async () => {
    queue.push(toolTurn("c1", "tool_canvas_add_sticky", { boardId: "b", text: "hi" }));
    await askVisitor("add a zorblax card saying hi");

    expect(calls).toHaveLength(1);
    const s = useAgentStore.getState();
    // Nothing ran, and nothing of the call is left: no result, no empty bubble.
    expect(s.messages.map((m) => m.role)).toEqual(["user"]);
    expect(s.pendingToolUse).toBeNull();
    expect(s.error).toMatch(/can't do here/);
  });

  it("never offers a refused action later through the history", async () => {
    // The model calls an offered read and, alongside it, a known action it wasn't offered.
    queue.push(
      toolsTurn([
        { id: "c1", name: "tool_zorblax_read_state" },
        { id: "c2", name: "tool_quuxly_wipe_vault" },
      ]),
      textTurn("Your board is empty.")
    );
    await askVisitor("read my zorblax board");
    expect(posts()[0].tools?.map((t) => t.function.name)).not.toContain("tool_quuxly_wipe_vault");

    expect(h.wiped).toBe(0);
    const second = posts()[1];
    // The read ran and goes back with its result; the refused call is gone for good.
    expect(second.tools?.map((t) => t.function.name)).not.toContain("tool_quuxly_wipe_vault");
    expect(JSON.stringify(second.messages)).not.toContain("quuxly");
    expect(second.messages.slice(1)).toEqual([
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "c1",
            type: "function",
            function: { name: "tool_zorblax_read_state", arguments: "{}" },
          },
        ],
      },
      { role: "tool", tool_call_id: "c1", content: JSON.stringify({ cards: [] }) },
    ]);
    // ...and on the visitor's next message too.
    queue.push(textTurn("Sure."));
    await askVisitor("and what does my zorblax board say now?");
    expect(posts()[2].tools?.map((t) => t.function.name)).not.toContain("tool_quuxly_wipe_vault");
  });

  it("never runs a call whose arguments are over VISITOR_LIMITS.argumentsChars, and sends nothing more", async () => {
    const text = "x".repeat(VISITOR_LIMITS.argumentsChars + 10);
    queue.push(toolTurn("c1", "tool_zorblax_add_card", { text }));
    await askVisitor("add a zorblax card with my notes");

    // No confirmation asked, nothing added, and no follow-up that would end on
    // the visitor's message (and so count as a new one).
    expect(h.added).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(useAgentStore.getState().messages.map((m) => m.role)).toEqual(["user"]);
    expect(useAgentStore.getState().error).toBeTruthy();

    // The visitor's next message goes out cleanly.
    queue.push(textTurn("Shorter, then?"));
    await askVisitor("ok, just add 'hi'");
    expect(posts()[1].messages.map((m) => m.role)).toEqual(["user", "user"]);
  });

  it("keeps the reply's text when its only call can't run, and the next request still ends on the visitor", async () => {
    const text = "x".repeat(VISITOR_LIMITS.argumentsChars + 10);
    queue.push(
      toolsTurn([{ id: "c1", name: "tool_zorblax_add_card", args: { text } }], "Adding it now.")
    );
    await askVisitor("add a zorblax card with my notes");
    expect(h.added).toEqual([]);
    expect(calls).toHaveLength(1);
    const reply = useAgentStore.getState().messages.at(-1);
    expect(reply?.content).toEqual([{ type: "text", text: "Adding it now." }]);

    queue.push(textTurn("ok"));
    await askVisitor("thanks");
    expect(posts()[1].messages).toEqual([
      { role: "user", content: "add a zorblax card with my notes" },
      { role: "assistant", content: "Adding it now." },
      { role: "user", content: "thanks" },
    ]);
  });

  it(`runs only the first VISITOR_LIMITS.toolCallsPerMessage calls of a round, and sends back exactly those`, async () => {
    const max = VISITOR_LIMITS.toolCallsPerMessage;
    queue.push(
      toolsTurn(
        Array.from({ length: max + 2 }, (_, i) => ({
          id: `c${i}`,
          name: "tool_zorblax_read_state",
        }))
      ),
      textTurn("Read it.")
    );
    await askVisitor("read my zorblax board");

    const round = useAgentStore.getState().messages[1];
    expect(round.content.filter((c) => c.type === "tool_use")).toHaveLength(max);
    const second = posts()[1].messages;
    const assistant = second[1] as { tool_calls?: Array<{ id: string }> };
    expect(assistant.tool_calls?.map((c) => c.id)).toEqual(
      Array.from({ length: max }, (_, i) => `c${i}`)
    );
    expect(second.filter((m) => m.role === "tool")).toHaveLength(max);
  });

  it("matches each result to its own round when the gateway sends no call ids", async () => {
    // Both rounds' calls come back as tc_0.
    queue.push(
      toolsTurn([{ id: "", name: "tool_zorblax_read_state" }]),
      toolsTurn([{ id: "", name: "tool_zorblax_read_state" }]),
      textTurn("Done.")
    );
    await askVisitor("read my zorblax board");
    expect(posts()).toHaveLength(3);
    const ids = posts()[2].messages.flatMap((m) =>
      m.role === "tool"
        ? [m.tool_call_id]
        : m.role === "assistant"
          ? (m.tool_calls ?? []).map((c) => c.id)
          : []
    );
    expect(ids).toEqual(["tc_0", "tc_0", "tc_0", "tc_0"]);
  });

  it("never attaches a left-out call's result to another message with the same id", async () => {
    // An older chat: tc_0 ran, then a later tc_0 went to a tool that is no
    // longer offered. Its result must not follow the first tc_0's message.
    const at = "2026-11-09T08:00:00Z";
    useAgentStore.setState({
      messages: [
        {
          id: "u1",
          role: "user",
          content: [{ type: "text", text: "read my zorblax board" }],
          createdAt: at,
        },
        {
          id: "a1",
          role: "assistant",
          content: [{ type: "tool_use", id: "tc_0", name: "tool_zorblax_read_state", input: {} }],
          createdAt: at,
        },
        {
          id: "r1",
          role: "tool",
          content: [{ type: "tool_result", tool_use_id: "tc_0", content: "{}" }],
          createdAt: at,
        },
        {
          id: "a2",
          role: "assistant",
          content: [{ type: "tool_use", id: "tc_0", name: "tool_canvas_add_sticky", input: {} }],
          createdAt: at,
        },
        {
          id: "r2",
          role: "tool",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tc_0",
              content: "Tool not available",
              is_error: true,
            },
          ],
          createdAt: at,
        },
        {
          id: "a3",
          role: "assistant",
          content: [{ type: "text", text: "Your board is empty." }],
          createdAt: at,
        },
      ],
    });
    queue.push(textTurn("ok"));
    await askVisitor("thanks");
    expect(posts()[0].messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
      "user",
    ]);
  });

  it("stops when the same action keeps failing", async () => {
    for (let i = 0; i < VISITOR_LIMITS.maxToolRounds; i++) {
      queue.push(toolTurn(`c${i}`, "tool_flimflam_break_it"));
    }
    await askVisitor("check my flimflam board for breakage");
    expect(calls.length).toBeLessThan(VISITOR_LIMITS.maxToolRounds);
    expect(useAgentStore.getState().error).toMatch(/kept failing/);
  });

  it("stops before sending a turn grown past the route's limits", async () => {
    const eight = (round: number) =>
      toolsTurn(
        Array.from({ length: VISITOR_LIMITS.toolCallsPerMessage }, (_, i) => ({
          id: `r${round}c${i}`,
          name: "tool_zorblax_read_state",
        }))
      );
    // Each round is 1 + 8 wire messages: after two, the turn is over 16.
    queue.push(eight(0), eight(1), textTurn("never sent"));
    await askVisitor("read my zorblax board");
    expect(calls).toHaveLength(2);
    expect(useAgentStore.getState().error).toMatch(/too many steps/);
  });

  it("falls back to the guide on a limit in the middle of a tool round", async () => {
    queue.push(
      toolTurn("c1", "tool_zorblax_read_state"),
      refusal(429, "site_busy", {
        [VISITOR_HEADERS.remaining]: "40",
        [VISITOR_HEADERS.limit]: "100",
        [VISITOR_HEADERS.peak]: "0",
      })
    );
    await askVisitor("read my zorblax board");
    const s = useAgentStore.getState();
    expect(calls).toHaveLength(2);
    expect(s.visitorFallback).toBe("site_busy");
    expect(s.streaming).toBe(false);
    // The round that ran is still whole: its call and its result.
    expect(s.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool"]);
  });

  it("stopping while a change waits for its confirmation answers the call and sends nothing more", async () => {
    queue.push(toolTurn("c1", "tool_zorblax_add_card", { text: "flaky CI" }));
    const turn = askVisitor("add a zorblax card saying flaky CI");
    await confirmation();
    abortInFlight();
    await turn;

    const s = useAgentStore.getState();
    expect(h.added).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(s.streaming).toBe(false);
    // The call has its result, so the chat can carry on from here.
    expect(s.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool"]);
    queue.push(textTurn("ok"));
    await askVisitor("never mind");
    expect(posts()[1].messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "user"]);
  });

  it("Clear chat while a change waits for its confirmation leaves the cleared chat empty", async () => {
    queue.push(toolTurn("c1", "tool_zorblax_add_card", { text: "flaky CI" }));
    const turn = askVisitor("add a zorblax card saying flaky CI");
    await confirmation();
    // What the panel's Clear chat does.
    abortInFlight();
    useAgentStore.getState().reset();
    await turn;

    const s = useAgentStore.getState();
    expect(h.added).toEqual([]);
    expect(s.messages).toEqual([]);
    expect(s.error).toBeNull();
    expect(s.pendingToolUse).toBeNull();
  });

  it("a reset alone (the visitor turned out to be the owner) leaves no stray result either", async () => {
    queue.push(toolTurn("c1", "tool_zorblax_add_card", { text: "flaky CI" }));
    const turn = askVisitor("add a zorblax card saying flaky CI");
    await confirmation();
    useAgentStore.getState().reset();
    abortInFlight();
    await turn;
    expect(useAgentStore.getState().messages).toEqual([]);
  });

  it("leaves a refused call out of the next request", async () => {
    queue.push(toolTurn("c1", "tool_canvas_add_sticky", {}), textTurn("Sure."));
    await askVisitor("add a zorblax card saying hi");
    await askVisitor("What is WSJF?");
    const body = posts()[1];
    expect(body.messages.map((m) => m.role)).toEqual(["user", "user"]);
    expect(body.tools).toBeUndefined();
  });

  it("cuts a long tool result to VISITOR_LIMITS.toolResultChars", async () => {
    h.bigRead = true;
    queue.push(toolTurn("c1", "tool_zorblax_read_state"), textTurn("That's a lot."));
    await askVisitor("read my zorblax board");

    const tool = posts()[1].messages.at(-1);
    expect(tool?.role).toBe("tool");
    const content = (tool as { content: string }).content;
    expect(content.length).toBeLessThanOrEqual(VISITOR_LIMITS.toolResultChars);
    expect(content).toContain("[cut:");
    // The handler's string, JSON-encoded as every result is.
    expect(content.startsWith(`"${"x".repeat(100)}`)).toBe(true);
  });

  it(`stops after ${VISITOR_LIMITS.maxToolRounds} requests and says what it did`, async () => {
    for (let i = 0; i < VISITOR_LIMITS.maxToolRounds + 2; i++) {
      queue.push(toolTurn(`c${i}`, "tool_zorblax_read_state"));
    }
    await askVisitor("read my zorblax board");

    expect(calls).toHaveLength(VISITOR_LIMITS.maxToolRounds);
    const last = useAgentStore.getState().messages.at(-1);
    expect(last?.role).toBe("assistant");
    expect(JSON.stringify(last?.content)).toContain(
      `I used all ${VISITOR_LIMITS.maxToolRounds} tool rounds`
    );
  });
});

describe("the visitor's history", () => {
  const user = (i: number): ChatMessage => ({
    id: `u${i}`,
    role: "user",
    content: [{ type: "text", text: `question ${i}` }],
    createdAt: "2026-11-09T08:00:00Z",
  });
  const reply = (i: number, text = `answer ${i}`): ChatMessage => ({
    id: `a${i}`,
    role: "assistant",
    content: [{ type: "text", text }],
    createdAt: "2026-11-09T08:00:01Z",
  });
  const call = (i: number, n = 1): ChatMessage => ({
    id: `c${i}`,
    role: "assistant",
    content: Array.from({ length: n }, (_, k) => ({
      type: "tool_use" as const,
      id: `call_${i}_${k}`,
      name: "tool_zorblax_read_state",
      input: {},
    })),
    createdAt: "2026-11-09T08:00:01Z",
  });
  const results = (i: number, n = 1, size = 10): ChatMessage => ({
    id: `r${i}`,
    role: "tool",
    content: Array.from({ length: n }, (_, k) => ({
      type: "tool_result" as const,
      tool_use_id: `call_${i}_${k}`,
      content: "y".repeat(size),
    })),
    createdAt: "2026-11-09T08:00:02Z",
  });

  it("sends at most historyMessages, starting at a user message", async () => {
    const earlier = Array.from({ length: 15 }, (_, i) => [user(i), reply(i)]).flat();
    useAgentStore.setState({ messages: earlier });
    queue.push(textTurn("ok"));
    await askVisitor("What is WSJF?");

    const sent = posts()[0].messages;
    expect(sent.length).toBeLessThanOrEqual(VISITOR_LIMITS.historyMessages);
    expect(sent[0].role).toBe("user");
    expect(sent.at(-1)).toEqual({ role: "user", content: "What is WSJF?" });
  });

  it("never separates a tool call from its result", () => {
    // Turn 1 is 6 wire messages (3 results fan out), turn 2 is 11: 17 in all.
    const history = [
      user(1),
      call(1, 3),
      results(1, 3),
      reply(1),
      user(2),
      call(2, 8),
      results(2, 8),
      reply(2),
    ];
    const trimmed = trimVisitorHistory(history, 16);
    expect(trimmed.map((m) => m.id)).toEqual(["u2", "c2", "r2", "a2"]);
    expect(trimVisitorHistory(history, 20)).toEqual(history);
  });

  it("keeps within the character budget too", () => {
    const history = [user(1), call(1), results(1, 1, 5000), reply(1), user(2), reply(2)];
    expect(trimVisitorHistory(history, 16, 4000).map((m) => m.id)).toEqual(["u2", "a2"]);
  });

  it("returns the latest turn whole when even it is over the limit", () => {
    const history = [user(1), reply(1), user(2), call(2, 10), results(2, 10)];
    expect(trimVisitorHistory(history, 5).map((m) => m.id)).toEqual(["u2", "c2", "r2"]);
  });

  it("cuts a long reply before sending it back", async () => {
    useAgentStore.setState({ messages: [user(1), reply(1, "z".repeat(20_000))] });
    queue.push(textTurn("ok"));
    await askVisitor("And then?");
    const back = posts()[0].messages[1] as { content: string };
    expect(back.content.length).toBeLessThanOrEqual(VISITOR_LIMITS.assistantChars);
  });
});

describe("cutToolResult", () => {
  it("leaves short text alone and cuts long text to the limit, marker included", () => {
    expect(cutToolResult("short")).toBe("short");
    const cut = cutToolResult("q".repeat(10_000), 500);
    expect(cut).toHaveLength(500);
    expect(cut).toMatch(/\[cut: the full text was 10000 characters\]$/);
  });
});

describe("parseVisitorQuota", () => {
  const headers = (h: Record<string, string>) => new Headers(h);

  it("is null without the daily pair", () => {
    expect(parseVisitorQuota(headers({}))).toBeNull();
    expect(parseVisitorQuota(headers({ [VISITOR_HEADERS.remaining]: "3" }))).toBeNull();
    expect(
      parseVisitorQuota(
        headers({ [VISITOR_HEADERS.remaining]: "x", [VISITOR_HEADERS.limit]: "100" })
      )
    ).toBeNull();
  });

  it("outside busy hours keeps only the window's limit, and stamps when the answer came", () => {
    expect(
      parseVisitorQuota(
        headers({
          [VISITOR_HEADERS.remaining]: "5",
          [VISITOR_HEADERS.limit]: "100",
          [VISITOR_HEADERS.peak]: "0",
          [VISITOR_HEADERS.peakRemaining]: "3",
          [VISITOR_HEADERS.peakLimit]: "15",
          [VISITOR_HEADERS.peakEnds]: "2026-11-09T10:00:00Z",
        }),
        1_700_000_000_000
      )
    ).toEqual({
      remaining: 5,
      limit: 100,
      peak: false,
      peakRemaining: null,
      peakLimit: 15,
      peakEndsAt: null,
      receivedAt: 1_700_000_000_000,
    });
  });
});

describe("the owner's path", () => {
  it("is unchanged: it probes and posts to /api/agent/stream and marks the chat the owner's", async () => {
    queue.push(
      Response.json({ mode: "server", model: "openclaw" }),
      sse([delta({ content: "hi" }), delta({}, "stop"), "[DONE]"], {})
    );
    await sendUserMessage("hello", { userId: "owner-1" });
    expect(calls.map((c) => [c.url, c.init?.method ?? "GET"])).toEqual([
      ["/api/agent/stream", "GET"],
      ["/api/agent/stream", "POST"],
    ]);
    const body = JSON.parse(String(calls[1].init?.body)) as { messages: Array<{ role: string }> };
    expect(body.messages[0].role).toBe("system");
    expect(useAgentStore.getState().chatProfile).toBe("owner");
  });
});
