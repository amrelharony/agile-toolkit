// @vitest-environment node
/**
 * lib/agent/upstream.ts — which model server the agent talks to and what it
 * sends there. The owner route trusts these helpers for its key handling and
 * its body whitelist, so the order of backends, the URL rules, the tool
 * shape-check and the forwarded fields are pinned here.
 */

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  CALLER_NAME,
  FIRST_BYTE_TIMEOUT_MS,
  VISITOR_CALLER_NAME,
  buildUpstreamBody,
  chatCompletionsUrl,
  fetchWithFirstByteTimeout,
  idleTimeoutStream,
  resolveOwnerBackend,
  resolveVisitorBackend,
  sanitizeTools,
  toolCallNames,
  upstreamHeaders,
} from "@/lib/agent/upstream";

// Placeholder values only: these are never real keys.
const ENV_ALL = {
  OPENCLAW_API_KEY: "oc-test",
  GLM_API_KEY: "glm-test",
  ZAI_API_KEY: "zai-test",
};

const fn = (name: string, extra: Record<string, unknown> = {}) => ({
  type: "function",
  function: { name, description: "d", parameters: { type: "object" }, ...extra },
});

describe("resolveOwnerBackend", () => {
  it("prefers OpenClaw, then a bigmodel key, then a Z.AI key", () => {
    expect(resolveOwnerBackend(ENV_ALL)?.provider).toBe("openclaw");
    expect(resolveOwnerBackend({ GLM_API_KEY: "g", ZAI_API_KEY: "z" })?.provider).toBe("glm");
    expect(resolveOwnerBackend({ ZAI_API_KEY: "z" })?.provider).toBe("zai");
    expect(resolveOwnerBackend({})).toBeNull();
  });

  it("treats empty or blank values as unset", () => {
    expect(resolveOwnerBackend({ OPENCLAW_API_KEY: "", GLM_API_KEY: "  " })).toBeNull();
    expect(resolveOwnerBackend({ OPENCLAW_API_KEY: " ", ZAI_API_KEY: "z" })?.provider).toBe("zai");
  });

  it("uses each backend's own key", () => {
    expect(resolveOwnerBackend(ENV_ALL)?.key).toBe("oc-test");
    expect(resolveOwnerBackend({ GLM_API_KEY: "glm-test" })?.key).toBe("glm-test");
    expect(resolveOwnerBackend({ ZAI_API_KEY: "zai-test" })?.key).toBe("zai-test");
  });

  it("defaults: OpenClaw gateway + openclaw, bigmodel + glm-4.5-flash, api.z.ai + glm-5.3-flash", () => {
    expect(resolveOwnerBackend({ OPENCLAW_API_KEY: "k" })).toMatchObject({
      url: "https://chat.amrelharony.com/v1/chat/completions",
      model: "openclaw",
    });
    expect(resolveOwnerBackend({ GLM_API_KEY: "k" })).toMatchObject({
      url: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
      model: "glm-4.5-flash",
    });
    expect(resolveOwnerBackend({ ZAI_API_KEY: "k" })).toMatchObject({
      url: "https://api.z.ai/api/paas/v4/chat/completions",
      model: "glm-5.3-flash",
    });
  });

  it("honours the URL and model overrides", () => {
    expect(
      resolveOwnerBackend({
        OPENCLAW_API_KEY: "k",
        OPENCLAW_URL: "https://gw.example.com/v1/",
        OPENCLAW_MODEL: "openclaw-flash",
      })
    ).toMatchObject({ url: "https://gw.example.com/v1/chat/completions", model: "openclaw-flash" });
    expect(
      resolveOwnerBackend({
        GLM_API_KEY: "k",
        GLM_BASE_URL: "https://open.bigmodel.cn/api/paas/v4",
        GLM_AGENT_MODEL: "glm-4.6",
      })
    ).toMatchObject({
      url: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
      model: "glm-4.6",
    });
    expect(
      resolveOwnerBackend({
        ZAI_API_KEY: "k",
        ZAI_BASE_URL: "https://api.z.ai/api/coding/paas/v4/",
        ZAI_AGENT_MODEL: "glm-5.3",
      })
    ).toMatchObject({
      url: "https://api.z.ai/api/coding/paas/v4/chat/completions",
      model: "glm-5.3",
    });
  });

  it("no longer sends a Z.AI key to bigmodel or a bigmodel key to Z.AI", () => {
    expect(resolveOwnerBackend({ ZAI_API_KEY: "k" })?.url).toMatch(/^https:\/\/api\.z\.ai\//);
    expect(resolveOwnerBackend({ GLM_API_KEY: "k" })?.url).toMatch(
      /^https:\/\/open\.bigmodel\.cn\//
    );
  });
});

describe("chatCompletionsUrl", () => {
  const FALLBACK = "https://fallback.example.com/v4";

  it("appends /chat/completions to a base URL and trims trailing slashes", () => {
    expect(chatCompletionsUrl("https://api.z.ai/api/paas/v4", FALLBACK)).toBe(
      "https://api.z.ai/api/paas/v4/chat/completions"
    );
    expect(chatCompletionsUrl("https://api.z.ai/api/paas/v4///", FALLBACK)).toBe(
      "https://api.z.ai/api/paas/v4/chat/completions"
    );
  });

  it("keeps a full chat-completions URL as it is", () => {
    expect(chatCompletionsUrl("https://gw.example.com/v1/chat/completions/", FALLBACK)).toBe(
      "https://gw.example.com/v1/chat/completions"
    );
  });

  it("refuses anything that isn't https, falling back to the default", () => {
    for (const bad of [
      "http://gw.example.com/v1",
      "ftp://x",
      "gw.example.com/v1",
      "https://",
      "",
      undefined,
    ]) {
      expect(chatCompletionsUrl(bad, FALLBACK)).toBe(
        "https://fallback.example.com/v4/chat/completions"
      );
    }
  });
});

describe("resolveVisitorBackend", () => {
  it("is off unless VISITOR_AI_ENABLED is exactly '1'", () => {
    expect(resolveVisitorBackend({ OPENCLAW_API_KEY: "k" })).toBeNull();
    for (const v of ["0", "true", "yes", "", " 2"]) {
      expect(resolveVisitorBackend({ OPENCLAW_API_KEY: "k", VISITOR_AI_ENABLED: v })).toBeNull();
    }
  });

  it("needs the gateway key, and never uses a raw GLM or Z.AI key", () => {
    expect(resolveVisitorBackend({ VISITOR_AI_ENABLED: "1" })).toBeNull();
    expect(
      resolveVisitorBackend({ VISITOR_AI_ENABLED: "1", GLM_API_KEY: "g", ZAI_API_KEY: "z" })
    ).toBeNull();
  });

  it("goes to OpenClaw on openclaw-flash by default, or VISITOR_AI_MODEL", () => {
    expect(resolveVisitorBackend({ VISITOR_AI_ENABLED: "1", ...ENV_ALL })).toEqual({
      provider: "openclaw",
      url: "https://chat.amrelharony.com/v1/chat/completions",
      key: "oc-test",
      model: "openclaw-flash",
    });
    expect(
      resolveVisitorBackend({
        VISITOR_AI_ENABLED: "1",
        OPENCLAW_API_KEY: "k",
        OPENCLAW_MODEL: "openclaw",
        VISITOR_AI_MODEL: "openclaw-fast",
      })?.model
    ).toBe("openclaw-fast");
  });
});

describe("sanitizeTools", () => {
  it("keeps well-formed function tools and drops everything else", () => {
    const ok = fn("workspace_sprint_create");
    const out = sanitizeTools([
      ok,
      null,
      "x",
      { type: "code_interpreter" },
      { type: "function" },
      { type: "function", function: { name: 42 } },
      fn(""),
      fn("a".repeat(129)),
    ]);
    expect(out).toEqual([ok]);
  });

  it("accepts a 128-character name and honours maxNameLen", () => {
    expect(sanitizeTools([fn("a".repeat(128))])).toHaveLength(1);
    expect(sanitizeTools([fn("abcdef")], { maxNameLen: 5 })).toHaveLength(0);
  });

  it("caps the count at max", () => {
    const many = Array.from({ length: 10 }, (_, i) => fn(`t${i}`));
    expect(sanitizeTools(many, { max: 3 }).map((t) => t.function.name)).toEqual(["t0", "t1", "t2"]);
  });

  it("returns [] for a non-array", () => {
    expect(sanitizeTools(undefined)).toEqual([]);
    expect(sanitizeTools({ type: "function" })).toEqual([]);
  });

  it("keeps the tools in `keep` past the cap, in the order sent", () => {
    const many = Array.from({ length: 10 }, (_, i) => fn(`t${i}`));
    expect(
      sanitizeTools(many, { max: 3, keep: new Set(["t8", "t1"]) }).map((t) => t.function.name)
    ).toEqual(["t0", "t1", "t2", "t3", "t8"]);
  });
});

describe("toolCallNames", () => {
  it("collects the functions the assistant tool_calls call", () => {
    const messages = [
      { role: "system", content: "s" },
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "1", type: "function", function: { name: "a", arguments: "{}" } },
          { id: "2", type: "function", function: { name: "b", arguments: "{}" } },
        ],
      },
      { role: "tool", tool_call_id: "1", content: "{}" },
      // Not an assistant, or malformed: ignored.
      { role: "user", tool_calls: [{ function: { name: "evil" } }] },
      { role: "assistant", tool_calls: [null, { function: { name: 3 } }, {}] },
      null,
    ];
    expect(toolCallNames(messages)).toEqual(new Set(["a", "b"]));
    expect(toolCallNames(undefined)).toEqual(new Set());
  });
});

describe("upstreamHeaders", () => {
  it("sends JSON + the bearer key, and X-Caller only to OpenClaw", () => {
    expect(upstreamHeaders({ provider: "openclaw", key: "k1" })).toEqual({
      "content-type": "application/json",
      authorization: "Bearer k1",
      "X-Caller": "agile-toolkit",
    });
    for (const provider of ["glm", "zai"] as const) {
      const h = upstreamHeaders({ provider, key: "k2" });
      expect(h).toEqual({ "content-type": "application/json", authorization: "Bearer k2" });
    }
  });

  it("names the visitor route as its own caller, so nginx limits it apart from the owner", () => {
    expect(VISITOR_CALLER_NAME).not.toBe(CALLER_NAME);
    expect(upstreamHeaders({ provider: "openclaw", key: "k1" }, VISITOR_CALLER_NAME)).toEqual({
      "content-type": "application/json",
      authorization: "Bearer k1",
      "X-Caller": "agile-toolkit-visitor",
    });
    expect(upstreamHeaders({ provider: "zai", key: "k2" }, VISITOR_CALLER_NAME)).not.toHaveProperty(
      "X-Caller"
    );
  });
});

describe("buildUpstreamBody", () => {
  const OC = { provider: "openclaw" as const, model: "openclaw" };
  const GLM = { provider: "glm" as const, model: "glm-4.5-flash" };
  const ZAI = { provider: "zai" as const, model: "glm-5.3-flash" };
  const messages = [{ role: "user", content: "hi" }];

  it("uses the server's model, always streams and asks for usage", () => {
    const out = buildUpstreamBody({ model: "gpt-evil", stream: false, messages }, OC);
    expect(out).toMatchObject({
      model: "openclaw",
      stream: true,
      stream_options: { include_usage: true },
      messages,
    });
  });

  it("drops fields that aren't whitelisted", () => {
    const out = buildUpstreamBody(
      { messages, stop: ["x"], user: "u", logit_bias: { 1: 2 }, extra_body: {} },
      OC
    );
    expect(Object.keys(out).sort()).toEqual(
      ["max_tokens", "messages", "model", "stream", "stream_options"].sort()
    );
  });

  it("clamps max_tokens to 64..8192 and defaults to 4096", () => {
    expect(buildUpstreamBody({}, OC).max_tokens).toBe(4096);
    expect(buildUpstreamBody({ max_tokens: 99_999 }, OC).max_tokens).toBe(8192);
    expect(buildUpstreamBody({ max_tokens: 10 }, OC).max_tokens).toBe(64);
    expect(buildUpstreamBody({ max_tokens: 1024.9 }, OC).max_tokens).toBe(1024);
    expect(buildUpstreamBody({ max_tokens: Number.NaN }, OC).max_tokens).toBe(4096);
    expect(buildUpstreamBody({ max_tokens: "8000" }, OC).max_tokens).toBe(4096);
  });

  it("clamps temperature to 0..2", () => {
    expect(buildUpstreamBody({ temperature: 0.2 }, OC).temperature).toBe(0.2);
    expect(buildUpstreamBody({ temperature: 5 }, OC).temperature).toBe(2);
    expect(buildUpstreamBody({ temperature: -1 }, OC).temperature).toBe(0);
    expect(buildUpstreamBody({ temperature: "hot" }, OC)).not.toHaveProperty("temperature");
  });

  it("maps any tool_choice to 'auto' when tools are sent", () => {
    for (const tool_choice of [
      undefined,
      "auto",
      "none",
      "required",
      { type: "function", function: { name: "t" } },
    ]) {
      const out = buildUpstreamBody({ tools: [fn("t")], tool_choice }, OC);
      expect(out.tools).toHaveLength(1);
      expect(out.tool_choice).toBe("auto");
    }
  });

  it("leaves tools and tool_choice out when no valid tool is sent", () => {
    for (const tools of [undefined, [], [{ type: "function" }], "x"]) {
      const out = buildUpstreamBody({ tools, tool_choice: "auto" }, OC);
      expect(out).not.toHaveProperty("tools");
      expect(out).not.toHaveProperty("tool_choice");
    }
  });

  it("caps the forwarded tools at maxTools", () => {
    const tools = Array.from({ length: 5 }, (_, i) => fn(`t${i}`));
    expect(buildUpstreamBody({ tools }, OC, { maxTools: 2 }).tools).toHaveLength(2);
  });

  it("never cuts a tool the history calls, whatever the cap", () => {
    const tools = Array.from({ length: 5 }, (_, i) => fn(`t${i}`));
    const history = [
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "c", type: "function", function: { name: "t4", arguments: "{}" } }],
      },
      { role: "tool", tool_call_id: "c", content: "{}" },
    ];
    const out = buildUpstreamBody({ tools, messages: history }, OC, { maxTools: 2 });
    expect(
      (out.tools as Array<{ function: { name: string } }>).map((t) => t.function.name)
    ).toEqual(["t0", "t1", "t4"]);
  });

  it("forwards reasoning_effort only as low, high or max", () => {
    for (const effort of ["low", "high", "max"]) {
      expect(buildUpstreamBody({ reasoning_effort: effort }, OC).reasoning_effort).toBe(effort);
    }
    for (const effort of ["medium", "minimal", "HIGH", "", 3, null, { level: "high" }]) {
      expect(buildUpstreamBody({ reasoning_effort: effort }, OC)).not.toHaveProperty(
        "reasoning_effort"
      );
    }
  });

  it("forwards reasoning_effort to the GLM-5.3 backends only, never to a bigmodel key", () => {
    expect(buildUpstreamBody({ reasoning_effort: "high" }, ZAI).reasoning_effort).toBe("high");
    // Same endpoint and model as the browser's BYOK request, which never sends it.
    expect(buildUpstreamBody({ reasoning_effort: "high" }, GLM)).not.toHaveProperty(
      "reasoning_effort"
    );
  });

  it("forwards thinking only to a direct bigmodel key", () => {
    expect(buildUpstreamBody({ thinking: { type: "enabled" } }, GLM).thinking).toEqual({
      type: "enabled",
    });
    expect(buildUpstreamBody({ thinking: false }, GLM).thinking).toBe(false);
    expect(buildUpstreamBody({ thinking: ["x"] }, GLM)).not.toHaveProperty("thinking");
    expect(buildUpstreamBody({ thinking: "on" }, GLM)).not.toHaveProperty("thinking");
    for (const be of [OC, ZAI]) {
      expect(buildUpstreamBody({ thinking: { type: "disabled" } }, be)).not.toHaveProperty(
        "thinking"
      );
    }
  });
});

describe("fetchWithFirstByteTimeout", () => {
  /** A fetch that only settles when its signal aborts (a gateway that never answers). */
  const hangingFetch = ((_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError"))
      );
    })) as unknown as typeof fetch;

  it("returns the response once headers arrive, and the timer no longer fires", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const res = new Response("ok");
      const fetchImpl = vi.fn(async () => res) as unknown as typeof fetch;
      const controller = new AbortController();
      const out = await fetchWithFirstByteTimeout(
        "https://x.example/chat/completions",
        { method: "POST" },
        { controller, timeoutMs: 1000, fetchImpl }
      );
      expect(out).toEqual({ ok: true, response: res });
      // A leaked timer would abort the (now streaming) request here.
      await vi.advanceTimersByTimeAsync(5_000);
      expect(controller.signal.aborted).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up well inside Vercel Edge's 25 s first-response limit", () => {
    expect(FIRST_BYTE_TIMEOUT_MS).toBeLessThanOrEqual(22_000);
  });

  it("gives up after the timeout and aborts the upstream request", async () => {
    const controller = new AbortController();
    const out = await fetchWithFirstByteTimeout(
      "https://x.example",
      {},
      { controller, timeoutMs: 20, fetchImpl: hangingFetch }
    );
    expect(out).toEqual({ ok: false, reason: "timeout" });
    expect(controller.signal.aborted).toBe(true);
  });

  it("reports a caller abort and a network failure separately", async () => {
    const controller = new AbortController();
    const pending = fetchWithFirstByteTimeout(
      "https://x.example",
      {},
      { controller, timeoutMs: 1000, fetchImpl: hangingFetch }
    );
    controller.abort();
    expect(await pending).toEqual({ ok: false, reason: "aborted" });

    const failing = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(
      await fetchWithFirstByteTimeout(
        "https://x.example",
        {},
        { controller: new AbortController(), timeoutMs: 1000, fetchImpl: failing }
      )
    ).toEqual({ ok: false, reason: "network" });
  });
});

describe("idleTimeoutStream", () => {
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A source the test drives by hand, plus whether the wrapper cancelled it. */
  function manualSource() {
    let ctl!: ReadableStreamDefaultController<Uint8Array>;
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        ctl = c;
      },
      cancel,
    });
    return {
      stream,
      cancel,
      push: (s: string) => ctl.enqueue(enc.encode(s)),
      close: () => ctl.close(),
      fail: (e: Error) => ctl.error(e),
    };
  }

  it("passes a lively stream through whole, however long it runs, while each gap is short", async () => {
    const src = manualSource();
    const onIdle = vi.fn();
    const { stream } = idleTimeoutStream(src.stream, 100, onIdle);
    const text = new Response(stream).text();
    // 6 chunks 80 ms apart: 480 ms in all, nearly 5× the timeout.
    for (const chunk of ["a", "b", "c", "d", "e", "f"]) {
      await vi.advanceTimersByTimeAsync(80);
      src.push(chunk);
    }
    await vi.advanceTimersByTimeAsync(80);
    src.close();
    expect(await text).toBe("abcdef");
    await vi.advanceTimersByTimeAsync(500);
    expect(onIdle).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("errors, cancels the source and calls onIdle when the upstream goes quiet", async () => {
    const src = manualSource();
    const onIdle = vi.fn();
    const reader = idleTimeoutStream(src.stream, 40, onIdle).stream.getReader();
    src.push("first");
    expect(dec.decode((await reader.read()).value)).toBe("first");
    const next = reader.read().then(
      () => "data",
      (e: Error) => e.message
    );
    await vi.advanceTimersByTimeAsync(39);
    expect(onIdle).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await next).toBe("upstream_idle_timeout");
    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(src.cancel).toHaveBeenCalled();
  });

  it("stops the timer when the reader cancels (the browser went away)", async () => {
    const src = manualSource();
    const onIdle = vi.fn();
    const reader = idleTimeoutStream(src.stream, 40, onIdle).stream.getReader();
    src.push("first");
    await reader.read();
    await reader.cancel("gone");
    expect(src.cancel).toHaveBeenCalledWith("gone");
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it("stops the timer and passes the error on when the upstream fails mid-stream", async () => {
    const src = manualSource();
    const onIdle = vi.fn();
    const reader = idleTimeoutStream(src.stream, 40, onIdle).stream.getReader();
    src.push("first");
    await reader.read();
    const next = reader.read().then(
      () => "data",
      (e: Error) => e.message
    );
    src.fail(new Error("connection reset"));
    expect(await next).toBe("connection reset");
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it("stop() turns the timer off but keeps passing chunks through", async () => {
    const src = manualSource();
    const onIdle = vi.fn();
    const { stream, stop } = idleTimeoutStream(src.stream, 20, onIdle);
    stop();
    const text = new Response(stream).text();
    await vi.advanceTimersByTimeAsync(60);
    src.push("late");
    src.close();
    expect(await text).toBe("late");
    expect(onIdle).not.toHaveBeenCalled();
  });
});
