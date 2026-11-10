/**
 * The agent client's per-turn tool set on the real registry (~830 actions,
 * via register-all): what each request actually carries, end to end through
 * pickTurnTools and the dotted-id ↔ wire-name mapping.
 *
 *  - Never the whole registry: at most MAX_TOOLS_PER_TURN tools plus history,
 *    and a request small enough for the gateway.
 *  - A page's actions are offered even when they don't live under
 *    tool.<id>.* (the cadence behind /ceremony-timer, retro boards).
 *  - A tool called earlier in the conversation stays offered on every later
 *    turn, even when nothing else would pick it: dropping it would make the
 *    request invalid (the endpoint rejects a history tool_call missing from
 *    `tools`).
 *  - History tools come first, so the route's cap (MAX_FORWARDED_TOOLS) can
 *    only ever cut the tail of the ranked picks.
 *
 * fetch is stubbed (GET → server mode, each POST takes the next scripted SSE
 * response); persistence and tool execution are mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  executeToolUse: vi.fn(async (tu: { id: string }) => ({
    type: "tool_result" as const,
    tool_use_id: tu.id,
    content: '{"ok":true}',
  })),
}));

vi.mock("@/lib/agent/persist", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent/persist")>()),
  recordChatUsage: async () => {},
  appendMessages: async () => {},
}));
vi.mock("@/lib/agent/execute-tool", () => ({ executeToolUse: h.executeToolUse }));

import "@/lib/actions/register-all";
import { registry, claudeNameFromId } from "@/lib/actions/registry";
import { rankActionIds } from "@/lib/agent/mascot/kb";
import { sendUserMessage } from "@/lib/agent/client";
import { useAgentStore } from "@/lib/agent/store";
import { MAX_TOOLS_PER_TURN, recentUserText } from "@/lib/agent/tool-selection";
import { buildUpstreamBody } from "@/lib/agent/upstream";
import type { ChatMessage } from "@/lib/agent/types";

type Body = {
  tools?: Array<{ function: { name: string } }>;
  messages: Array<{ role: string }>;
};

/** The route's MAX_FORWARDED_TOOLS. */
const ROUTE_TOOL_CAP = 256;

function sse(...events: unknown[]): Response {
  const text = events
    .map((e) => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`)
    .join("");
  return new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
}
const delta = (d: Record<string, unknown>, finish: string | null = null) => ({
  choices: [{ delta: d, finish_reason: finish }],
});
const textTurn = (text: string) => sse(delta({ content: text }), delta({}, "stop"), "[DONE]");
const callTurn = (id: string, name: string, args: string) =>
  sse(
    delta({
      tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: args } }],
    }),
    delta({}, "tool_calls"),
    "[DONE]"
  );

let queue: Response[];
let posts: Body[];

beforeEach(() => {
  queue = [];
  posts = [];
  h.executeToolUse.mockClear();
  useAgentStore.getState().reset();
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

const names = (b: Body) => (b.tools ?? []).map((t) => t.function.name);
const send = (text: string, toolId: string | null) =>
  sendUserMessage(text, { userId: "owner-1", toolId });

describe("the per-turn tool set on the real registry", () => {
  it("is far smaller than the registry, and the request stays small", async () => {
    for (const [text, toolId] of [
      ["add a card about flaky CI", "retro"],
      ["hi", null],
      ["do it", "planning-poker"],
    ] as const) {
      posts = [];
      queue = [textTurn("ok")];
      await send(text, toolId);
      const body = posts[0];
      expect(names(body).length).toBeGreaterThan(0);
      expect(names(body).length).toBeLessThanOrEqual(MAX_TOOLS_PER_TURN);
      // The whole registry is ~590 KB of tool JSON; one turn stays a small slice.
      expect(JSON.stringify(body).length).toBeLessThan(150_000);
      // Every name offered is a real action.
      for (const n of names(body)) expect(registry.resolve(n), n).toBeDefined();
    }
  });

  it("offers a page's actions even when they don't live under tool.<id>", async () => {
    queue = [textTurn("ok")];
    await send("add one", "ceremony-timer");
    expect(names(posts[0])).toContain("tool_ceremony_cadence_set");

    queue = [textTurn("ok")];
    // A path, as an older conversation stored it, resolves to the tool.
    await send("what's on this board?", "/retro");
    expect(names(posts[1])).toEqual(
      expect.arrayContaining(["tool_retro_list_state", "workspace_retro_board_list"])
    );
  });

  it("keeps a tool called in an earlier turn on later turns, when nothing else would offer it", async () => {
    const used = "workspace_sprint_create";
    // Turn 1: ranking surfaces the action and the model calls it.
    queue = [callTurn("call_1", used, '{"name":"Sprint 47"}'), textTurn("Created Sprint 47.")];
    await send("create a sprint called Sprint 47", null);
    expect(names(posts[0])).toContain(used);
    expect(h.executeToolUse).toHaveBeenCalledTimes(1);

    // Turns 2 and 3 share no words with it, so only the history keeps it.
    queue = [textTurn("?")];
    await send("zzqx", null);
    queue = [textTurn("?")];
    await send("qqzz", null);
    const later = recentUserText(useAgentStore.getState().messages);
    expect(rankActionIds(later, MAX_TOOLS_PER_TURN)).not.toContain("workspace.sprint.create");

    const last = posts.at(-1)!;
    expect(names(last)[0]).toBe(used);
    // The history it must match: the assistant tool_call naming it.
    expect(JSON.stringify(last.messages)).toContain(`"name":"${used}"`);
  });

  it("puts history tools first, so the route's cap never cuts one", async () => {
    // A long conversation that already used the registry's last 250 actions —
    // the ones a registry-ordered list would put at its very end.
    const used = registry
      .list()
      .slice(-250)
      .map((a) => claudeNameFromId(a.id));
    const prior: ChatMessage[] = [
      { id: "u0", role: "user", content: [{ type: "text", text: "do everything" }], createdAt: "" },
      {
        id: "a0",
        role: "assistant",
        content: used.map((name, i) => ({ type: "tool_use", id: `c${i}`, name, input: {} })),
        createdAt: "",
      },
      {
        id: "t0",
        role: "tool",
        content: used.map((_, i) => ({ type: "tool_result", tool_use_id: `c${i}`, content: "ok" })),
        createdAt: "",
      },
    ];
    useAgentStore.setState({ messages: prior });

    queue = [textTurn("ok")];
    await send("add a card about flaky CI", "retro");
    const sent = names(posts[0]);
    expect(sent.length).toBeGreaterThan(ROUTE_TOOL_CAP);
    expect(sent.slice(0, used.length)).toEqual(used);

    const forwarded = buildUpstreamBody(
      posts[0] as unknown as Record<string, unknown>,
      { provider: "openclaw", model: "openclaw" },
      { maxTools: ROUTE_TOOL_CAP }
    ).tools as Array<{ function: { name: string } }>;
    const kept = new Set(forwarded.map((t) => t.function.name));
    expect(used.filter((n) => !kept.has(n))).toEqual([]);
  });
});
