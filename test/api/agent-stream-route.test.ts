// @vitest-environment node
/**
 * /api/agent/stream — the owner's agent proxy.
 *
 * requireAuthorizedUser is mocked (its checks live in require-user.test.ts)
 * and fetch is stubbed, so nothing leaves the machine. What matters here: GET
 * reports the backend the resolver picked, POST forwards the whitelisted body
 * to it with the right headers (X-Caller for OpenClaw), streams the answer
 * back untouched, and turns a dead or silent upstream into a clear error
 * instead of a hung turn.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  rate: null as Record<string, unknown> | null,
  rpc: vi.fn(),
}));
vi.mock("@/lib/auth/require-user", () => ({
  requireAuthorizedUser: async () => ({
    user: { id: "owner-1" },
    supabase: { rpc: h.rpc },
  }),
}));

import { GET, POST, runtime } from "@/app/api/agent/stream/route";

const ALLOWED = {
  allowed: true,
  daily_used: 1,
  daily_max: 50,
  weekly_used: 1,
  weekly_max: 200,
  monthly_used: 1,
  monthly_max: 600,
};

/** Point the resolver at one backend; every other key is blanked (placeholder values only). */
function useBackend(env: Record<string, string>) {
  for (const name of [
    "OPENCLAW_API_KEY",
    "OPENCLAW_URL",
    "OPENCLAW_MODEL",
    "GLM_API_KEY",
    "GLM_BASE_URL",
    "GLM_AGENT_MODEL",
    "ZAI_API_KEY",
    "ZAI_BASE_URL",
    "ZAI_AGENT_MODEL",
  ]) {
    vi.stubEnv(name, env[name] ?? "");
  }
}

function post(body: unknown, signal?: AbortSignal): NextRequest {
  return new Request("https://toolkit.test/api/agent/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  }) as unknown as NextRequest;
}

const SSE = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n';
const enc = new TextEncoder();
const HI = { messages: [{ role: "user", content: "hi" }] };

/**
 * An upstream that answers at once and then streams by hand, like fetch: its
 * body errors when the request's signal aborts. `upstreamSignal` is that
 * signal.
 */
function manualUpstream() {
  let ctl!: ReadableStreamDefaultController<Uint8Array>;
  const state: { upstreamSignal?: AbortSignal } = {};
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    state.upstreamSignal = init?.signal ?? undefined;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        ctl = c;
        init?.signal?.addEventListener("abort", () => {
          try {
            c.error(new DOMException("aborted", "AbortError"));
          } catch {
            /* already closed */
          }
        });
      },
    });
    return new Response(body, { status: 200 });
  });
  return {
    state,
    push: (s: string) => ctl.enqueue(enc.encode(s)),
    close: () => ctl.close(),
  };
}

/** The next read's outcome: its text, "done", or the error message. */
function nextRead(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  return reader.read().then(
    (r) => (r.done ? "done" : new TextDecoder().decode(r.value)),
    (e: Error) => e.message
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({ data: ALLOWED, error: null });
  fetchMock = vi.fn(async () => new Response(SSE, { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  useBackend({ OPENCLAW_API_KEY: "oc-test" });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("GET /api/agent/stream", () => {
  it("runs on Edge", () => {
    expect(runtime).toBe("edge");
  });

  it("reports the backend the resolver picked", async () => {
    expect(await (await GET()).json()).toEqual({
      mode: "server",
      model: "openclaw",
      provider: "openclaw",
    });
    useBackend({ ZAI_API_KEY: "zai-test" });
    expect(await (await GET()).json()).toEqual({
      mode: "server",
      model: "glm-5.3-flash",
      provider: "zai",
    });
    useBackend({});
    expect(await (await GET()).json()).toEqual({ mode: "client", model: null, provider: null });
  });
});

describe("POST /api/agent/stream", () => {
  it("forwards the whitelisted body to OpenClaw with X-Caller and streams the answer back", async () => {
    const res = await POST(
      post({
        model: "something-else",
        messages: [{ role: "user", content: "hi" }],
        tools: [{ type: "function", function: { name: "workspace_sprint_list" } }],
        tool_choice: "none",
        reasoning_effort: "high",
        thinking: { type: "disabled" },
        max_tokens: 8192,
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("x-ratelimit-daily")).toBe("1");
    expect(await res.text()).toBe(SSE);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://chat.amrelharony.com/v1/chat/completions");
    expect(init.headers).toEqual({
      "content-type": "application/json",
      authorization: "Bearer oc-test",
      "X-Caller": "agile-toolkit",
    });
    const sent = JSON.parse(String(init.body));
    expect(sent).toMatchObject({
      model: "openclaw",
      stream: true,
      stream_options: { include_usage: true },
      tool_choice: "auto",
      reasoning_effort: "high",
      max_tokens: 8192,
    });
    expect(sent).not.toHaveProperty("thinking");
  });

  it("sends a Z.AI key to api.z.ai, without X-Caller", async () => {
    useBackend({ ZAI_API_KEY: "zai-test" });
    await POST(post({ messages: [{ role: "user", content: "hi" }] }));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.z.ai/api/paas/v4/chat/completions");
    expect(init.headers).not.toHaveProperty("X-Caller");
    expect(JSON.parse(String(init.body)).model).toBe("glm-5.3-flash");
  });

  it("answers mode client without a backend, and calls nothing", async () => {
    useBackend({});
    const res = await POST(post({ messages: [] }));
    expect(await res.json()).toEqual({ mode: "client", provider: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still meters a turn and refuses it at the limit before calling the gateway", async () => {
    h.rpc.mockResolvedValue({ data: { ...ALLOWED, allowed: false }, error: null });
    const res = await POST(post({ messages: [{ role: "user", content: "hi" }] }));
    expect(res.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes an upstream error status through with its detail", async () => {
    fetchMock.mockResolvedValue(new Response("too big", { status: 413 }));
    const res = await POST(post({ messages: [{ role: "user", content: "hi" }] }));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "upstream", status: 413, detail: "too big" });
  });

  it("answers 502 when the gateway can't be reached, with the usage headers", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const res = await POST(post({ messages: [{ role: "user", content: "hi" }] }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("upstream_unreachable");
    // The turn was metered before the call, so the bar must show it.
    expect(res.headers.get("x-ratelimit-daily")).toBe("1");
  });

  it("answers 499 and aborts the upstream call when the browser left before headers", async () => {
    let upstreamSignal: AbortSignal | undefined;
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      upstreamSignal = init?.signal ?? undefined;
      if (upstreamSignal?.aborted) throw new DOMException("aborted", "AbortError");
      return new Response(SSE, { status: 200 });
    });
    const browser = new AbortController();
    browser.abort();
    const res = await POST(post(HI, browser.signal));
    expect(res.status).toBe(499);
    expect(upstreamSignal?.aborted).toBe(true);
  });

  it("aborts the upstream and stops the idle timer when the browser leaves mid-stream", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const up = manualUpstream();
    const browser = new AbortController();
    const res = await POST(post(HI, browser.signal));
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    up.push("data: {}\n\n");
    expect(await nextRead(reader)).toBe("data: {}\n\n");
    const next = nextRead(reader);
    browser.abort();
    expect(up.state.upstreamSignal?.aborted).toBe(true);
    // The stream ends on the abort, never on a later idle timeout.
    expect(await next).not.toBe("upstream_idle_timeout");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("answers 504 when no response headers arrive within 20 seconds", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let aborted = false;
    fetchMock.mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new DOMException("aborted", "AbortError"));
          });
        })
    );
    const pending = POST(post({ messages: [{ role: "user", content: "hi" }] }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(19_000);
    expect(aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    const res = await pending;
    expect(res.status).toBe(504);
    expect((await res.json()).error).toBe("upstream_timeout");
    expect(aborted).toBe(true);
    expect(res.headers.get("x-ratelimit-daily")).toBe("1");
  });

  it("ends the stream when the gateway goes quiet for 30 seconds", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const up = manualUpstream();
    const res = await POST(post(HI));
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    up.push('data: {"choices":[]}\n\n');
    expect(await nextRead(reader)).toContain("choices");
    // One chunk, then silence.
    const outcome = nextRead(reader);
    let settled = false;
    void outcome.then(() => (settled = true));
    // Past the 20 s first-byte timeout (a leaked one would fire here) and
    // nearly the 30 s idle one: still open.
    await vi.advanceTimersByTimeAsync(29_000);
    expect(settled).toBe(false);
    expect(up.state.upstreamSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await outcome).toBe("upstream_idle_timeout");
    expect(up.state.upstreamSignal?.aborted).toBe(true);
  });

  it("keeps a long stream whole while no gap reaches 30 seconds", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const up = manualUpstream();
    const res = await POST(post(HI));
    const text = new Response(res.body).text();
    // Chunks at 20 s, 40 s and 60 s, then the end: a minute in all.
    for (const n of [1, 2, 3]) {
      await vi.advanceTimersByTimeAsync(20_000);
      up.push(`data: {"n":${n}}\n\n`);
    }
    await vi.advanceTimersByTimeAsync(20_000);
    up.close();
    expect(await text).toBe('data: {"n":1}\n\ndata: {"n":2}\n\ndata: {"n":3}\n\n');
    expect(up.state.upstreamSignal?.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
