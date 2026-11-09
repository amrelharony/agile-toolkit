/**
 * The agent client in BYOK mode: the route's probe says `{mode:"client"}`, so
 * the browser calls open.bigmodel.cn itself with the user's own GLM key from
 * AI Settings.
 *
 * Kept in its own file because the client caches a successful mode probe for
 * the page session, so a file can only ever see one mode. What is pinned:
 * requests go to the bigmodel endpoint on the configured model, never carry
 * `reasoning_effort` (a GLM-5.3 field for the server's backends), and usage is
 * recorded against that model — for owner turns, the round-limit wrap-up and
 * generateTitle alike.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  recordChatUsage: vi.fn<(tokens: number, model: string) => Promise<void>>(async () => {}),
  executeToolUse: vi.fn(async (tu: { id: string }) => ({
    type: "tool_result" as const,
    tool_use_id: tu.id,
    content: '{"ok":true}',
  })),
}));

vi.mock("@/lib/agent/persist", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent/persist")>()),
  recordChatUsage: h.recordChatUsage,
  appendMessages: async () => {},
}));
vi.mock("@/lib/agent/execute-tool", () => ({ executeToolUse: h.executeToolUse }));
// A placeholder key only: never a real one.
vi.mock("@/lib/stores/llm-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stores/llm-store")>()),
  getActiveConfig: () => ({ provider: "glm", apiKey: "test-key", model: "glm-4.6" }),
}));

import { generateTitle, sendUserMessage } from "@/lib/agent/client";
import { useAgentStore } from "@/lib/agent/store";

const BIGMODEL = "https://open.bigmodel.cn/api/paas/v4/chat/completions";

type Post = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

function sse(...events: unknown[]): Response {
  const text = events
    .map((e) => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`)
    .join("");
  return new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
}
const delta = (d: Record<string, unknown>, finish: string | null = null) => ({
  choices: [{ delta: d, finish_reason: finish }],
});

let queue: Response[];
let posts: Post[];

beforeEach(() => {
  queue = [];
  posts = [];
  h.recordChatUsage.mockClear();
  useAgentStore.getState().reset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (!init || init.method === "GET") return Response.json({ mode: "client", provider: null });
      posts.push({
        url,
        headers: init.headers as Record<string, string>,
        body: JSON.parse(String(init.body)) as Record<string, unknown>,
      });
      const next = queue.shift();
      if (!next) throw new Error("unexpected POST");
      return next;
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BYOK owner turns", () => {
  it("go to bigmodel on the configured model, without reasoning_effort", async () => {
    queue = [
      sse(delta({ content: "Hi" }), delta({}, "stop"), {
        choices: [],
        usage: { total_tokens: 33 },
      }),
    ];
    await sendUserMessage("hi", { userId: "owner-1", toolId: null });

    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe(BIGMODEL);
    expect(posts[0].headers.authorization).toMatch(/^Bearer /);
    expect(posts[0].headers).not.toHaveProperty("x-agent-new-turn");
    expect(posts[0].body.model).toBe("glm-4.6");
    expect(posts[0].body).not.toHaveProperty("reasoning_effort");
    expect(posts[0].body.max_tokens).toBe(8192);
    expect(h.recordChatUsage).toHaveBeenCalledWith(33, "glm-4.6");
  });

  it("leave reasoning_effort out of the round-limit wrap-up too", async () => {
    const call = (id: string) =>
      sse(
        delta({
          tool_calls: [
            {
              index: 0,
              id,
              type: "function",
              function: { name: "intent_plan_sprint", arguments: "{}" },
            },
          ],
        }),
        delta({}, "tool_calls"),
        "[DONE]"
      );
    for (let i = 0; i < 10; i++) queue.push(call(`c${i}`));
    queue.push(sse(delta({ content: "Summary." }), delta({}, "stop"), "[DONE]"));
    await sendUserMessage("plan it", { userId: "owner-1", toolId: null });

    expect(posts).toHaveLength(11);
    for (const p of posts) {
      expect(p.url).toBe(BIGMODEL);
      expect(p.body).not.toHaveProperty("reasoning_effort");
      expect(p.body.model).toBe("glm-4.6");
    }
    expect(posts[10].body.max_tokens).toBe(4096);
  });
});

describe("BYOK generateTitle", () => {
  it("goes to bigmodel on the configured model, without reasoning_effort", async () => {
    queue = [sse(delta({ content: "Sprint Planning Help" }), delta({}, "stop"), "[DONE]")];
    expect(await generateTitle("help me plan a sprint", "Sure")).toBe("Sprint Planning Help");
    expect(posts[0].url).toBe(BIGMODEL);
    expect(posts[0].body.model).toBe("glm-4.6");
    expect(posts[0].body).not.toHaveProperty("reasoning_effort");
    expect(posts[0].body.max_tokens).toBe(1024);
  });
});
