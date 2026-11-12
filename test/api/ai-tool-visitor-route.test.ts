// @vitest-environment node
/**
 * POST /api/ai/tool/visitor: a tool's Ask Amr for signed-out visitors.
 *
 * The service-role client is a one-line fake whose rpc is the visitor meter
 * (the same one Amr's chat uses), and fetch is stubbed, so nothing leaves the
 * machine (placeholder env values only). What matters here: the kill switch,
 * the same-site check, the burst brake, the size and task checks refuse
 * before anything is metered; an owner-only task never runs for a visitor;
 * the meter fails closed and each limit is its own code with the quota
 * headers; and a repair call is metered as a call only, never a new turn.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { z } from "zod";
import { TOOL_AI_VISITOR_MAX_BODY_BYTES } from "@/lib/ai/contract";
import { TOOL_AI_FIRST_BYTE_TIMEOUT_MS } from "@/lib/ai/run-task.server";
import { fallbackOptions } from "@/lib/ai/tasks/_example";
import { VISITOR_HEADERS } from "@/lib/visitor-ai/contract";
import { cairoDay, visitorKey } from "@/lib/visitor-ai/visitor-key";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  hasClient: true,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/squads/server", () => ({
  getSquadAdminClient: () => (h.hasClient ? { rpc: h.rpc } : null),
}));

// Two tasks only this test registers: one owner-only, one asking for the full
// model at high effort (a visitor still gets VISITOR_AI_MODEL, at most the
// config row's effort).
vi.mock("@/lib/ai/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/registry")>();
  const base = {
    toolId: "test",
    maxTokens: 4096,
    input: z.object({ text: z.string().max(100) }),
    output: z.object({ items: z.array(z.string().max(40)).max(5) }),
    fallback: () => ({ items: ["fallback"] }),
    sample: { text: "hello" },
  };
  const extra: Record<string, unknown> = {
    "test.owner_only": {
      ...base,
      id: "test.owner_only",
      tier: "flash",
      effort: "low",
      ownerOnly: true,
    },
    "test.deep": { ...base, id: "test.deep", tier: "full", effort: "high" },
  };
  return { ...actual, getAiTask: (id: string) => extra[id] ?? actual.getAiTask(id) };
});
vi.mock("@/lib/ai/registry.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/registry.server")>();
  const prompt = { system: "List things.", user: (i: { text: string }) => `Text: ${i.text}` };
  return {
    ...actual,
    getAiPrompt: (id: string) =>
      id === "test.owner_only" || id === "test.deep" ? prompt : actual.getAiPrompt(id),
  };
});

import * as route from "@/app/api/ai/tool/visitor/route";

const { POST } = route;
const HOST = "agile.test";
const SECRET = "test-secret-not-a-real-one-0123";
const TASK = "ai.suggest_options";
const QUESTION = "Should we pair on the release notes?";
const ASK = { task: TASK, input: { question: QUESTION } };

function meterReply(over: Record<string, unknown> = {}) {
  return {
    allowed: true,
    reason: null,
    turns_used: 38,
    turns_max: 100,
    peak: false,
    peak_turns_used: 0,
    peak_turns_max: 25,
    peak_ends_at: null,
    reasoning_effort: "high",
    ...over,
  };
}

function sse(content: string, finish = "stop") {
  return (
    `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n` +
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] })}\n\n` +
    "data: [DONE]\n\n"
  );
}

let ip = 0;
/** A fresh address per request, so the burst brake stays out of the way. */
function nextIp() {
  ip += 1;
  return `10.2.${Math.floor(ip / 250)}.${ip % 250}`;
}

function post(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`https://${HOST}/api/ai/tool/visitor`, {
    method: "POST",
    headers: {
      host: HOST,
      origin: `https://${HOST}`,
      "content-type": "application/json",
      "x-real-ip": nextIp(),
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

function forwarded(n = 0): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls[n] as [string, RequestInit];
  return JSON.parse(init.body as string);
}

async function expectRefusal(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(await res.json()).toEqual({ error: code });
}

beforeEach(() => {
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({ data: meterReply(), error: null });
  h.hasClient = true;
  fetchMock = vi.fn(async () => new Response(sse('{"options":["Yes","No","Not sure"]}')));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("VISITOR_AI_ENABLED", "1");
  vi.stubEnv("OPENCLAW_API_KEY", "oc-test");
  vi.stubEnv("OPENCLAW_URL", "");
  vi.stubEnv("VISITOR_AI_MODEL", "visitor-model-test");
  vi.stubEnv("VISITOR_AI_HASH_SECRET", SECRET);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("route config", () => {
  it("runs on Node for up to 300 s, never cached, POST only", () => {
    expect(route.runtime).toBe("nodejs");
    expect(route.maxDuration).toBe(300);
    expect(route.dynamic).toBe("force-dynamic");
    expect("GET" in route).toBe(false);
  });
});

describe("refused before the meter", () => {
  it("answers 503 disabled while the kill switch is off, touching nothing", async () => {
    for (const [name, value] of [
      ["VISITOR_AI_ENABLED", ""],
      ["VISITOR_AI_ENABLED", "true"],
      ["OPENCLAW_API_KEY", ""],
    ]) {
      vi.stubEnv(name, value);
      await expectRefusal(await POST(post(ASK)), 503, "disabled");
      vi.stubEnv("VISITOR_AI_ENABLED", "1");
      vi.stubEnv("OPENCLAW_API_KEY", "oc-test");
    }
    expect(h.rpc).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 403 to another site, or to a request without an Origin", async () => {
    await expectRefusal(await POST(post(ASK, { origin: "https://evil.test" })), 403, "forbidden");
    const noOrigin = new NextRequest(`https://${HOST}/api/ai/tool/visitor`, {
      method: "POST",
      headers: { host: HOST, "content-type": "application/json", "x-real-ip": nextIp() },
      body: JSON.stringify(ASK),
    });
    await expectRefusal(await POST(noOrigin), 403, "forbidden");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("brakes a burst: the 31st request in a minute from one address is 429 slow_down", async () => {
    const address = "10.9.9.9";
    for (let i = 0; i < 30; i++) {
      expect((await POST(post(ASK, { "x-real-ip": address }))).status).toBe(200);
    }
    const res = await POST(post(ASK, { "x-real-ip": address }));
    await expectRefusal(res, 429, "slow_down");
    expect(res.headers.get("retry-after")).toBe("60");
    expect(h.rpc).toHaveBeenCalledTimes(30);
  });

  it("caps the body at 64 KiB", async () => {
    const big = { task: TASK, input: { question: "x".repeat(TOOL_AI_VISITOR_MAX_BODY_BYTES) } };
    await expectRefusal(await POST(post(big)), 413, "too_large");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("refuses unreadable JSON, an unknown task and a bad input, none of them metered", async () => {
    await expectRefusal(await POST(post("{nope")), 400, "bad_request");
    await expectRefusal(await POST(post({ task: 7 })), 400, "bad_request");
    await expectRefusal(await POST(post({ task: "nope.never", input: {} })), 400, "unknown_task");
    await expectRefusal(
      await POST(post({ task: TASK, input: { question: "" } })),
      400,
      "bad_input"
    );
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("never runs an owner-only task, nor the owner's prompt.run, for a visitor", async () => {
    await expectRefusal(
      await POST(post({ task: "test.owner_only", input: { text: "hi" } })),
      400,
      "owner_only"
    );
    await expectRefusal(
      await POST(post({ task: "prompt.run", input: { prompt: "Summarise" } })),
      400,
      "owner_only"
    );
    expect(h.rpc).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses with 503 meter_unavailable without the secret", async () => {
    vi.stubEnv("VISITOR_AI_HASH_SECRET", "");
    await expectRefusal(await POST(post(ASK)), 503, "meter_unavailable");
    expect(h.rpc).not.toHaveBeenCalled();
  });
});

describe("the meter", () => {
  it("counts each use as a new turn, under the visitor's daily code", async () => {
    const address = "10.7.7.7";
    await POST(post(ASK, { "x-real-ip": address }));
    expect(h.rpc).toHaveBeenCalledWith("visitor_ai_meter", {
      p_visitor: visitorKey(address, cairoDay(), SECRET),
      p_new_turn: true,
    });
  });

  it("fails closed: no client, an error or a wrong shape is 503 meter_unavailable", async () => {
    h.hasClient = false;
    await expectRefusal(await POST(post(ASK)), 503, "meter_unavailable");
    h.hasClient = true;
    h.rpc.mockResolvedValue({ data: null, error: { message: "down" } });
    await expectRefusal(await POST(post(ASK)), 503, "meter_unavailable");
    h.rpc.mockResolvedValue({ data: { allowed: "maybe" }, error: null });
    await expectRefusal(await POST(post(ASK)), 503, "meter_unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers each limit with its own code and the quota headers, sending nothing", async () => {
    const cases: Array<[string, number]> = [
      ["visitor_limit", 429],
      ["visitor_peak_limit", 429],
      ["site_limit", 429],
      ["site_peak_limit", 429],
      ["site_busy", 429],
      ["disabled", 503],
    ];
    for (const [reason, status] of cases) {
      h.rpc.mockResolvedValue({
        data: meterReply({ allowed: false, reason, turns_used: 100 }),
        error: null,
      });
      const res = await POST(post(ASK));
      expect(res.status, reason).toBe(status);
      expect(await res.json()).toEqual({ error: reason });
      expect(res.headers.get(VISITOR_HEADERS.remaining), reason).toBe("0");
      expect(res.headers.get(VISITOR_HEADERS.limit), reason).toBe("100");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the answer", () => {
  it("comes back with the quota headers, the model and caller the visitors' own", async () => {
    const res = await POST(post(ASK));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      data: { options: ["Yes", "No", "Not sure"] },
      source: "ai",
    });
    expect(res.headers.get(VISITOR_HEADERS.remaining)).toBe("62");
    expect(res.headers.get(VISITOR_HEADERS.limit)).toBe("100");
    expect(res.headers.get(VISITOR_HEADERS.peak)).toBe("0");
    expect(forwarded().model).toBe("visitor-model-test");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["X-Caller"]).toBe("agile-toolkit-visitor");
  });

  it("never gives a visitor the full model, and the config row caps the effort", async () => {
    h.rpc.mockResolvedValue({ data: meterReply({ reasoning_effort: "low" }), error: null });
    fetchMock.mockImplementation(async () => new Response(sse('{"items":["a"]}')));
    const res = await POST(post({ task: "test.deep", input: { text: "hi" } }));
    expect(res.status).toBe(200);
    expect(forwarded()).toMatchObject({ model: "visitor-model-test", reasoning_effort: "low" });
  });

  it("meters the repair call as a call only (newTurn false)", async () => {
    fetchMock
      .mockImplementationOnce(async () => new Response(sse("Yes or no, really")))
      .mockImplementationOnce(async () => new Response(sse('{"options":["Yes","No"]}')));
    // The repair's own meter answer (a call more, the same turn count here
    // made different on purpose) is the one the headers carry.
    h.rpc
      .mockResolvedValueOnce({ data: meterReply(), error: null })
      .mockResolvedValueOnce({ data: meterReply({ turns_used: 39 }), error: null });
    const res = await POST(post(ASK));
    expect(await res.json()).toMatchObject({ data: { options: ["Yes", "No"] }, source: "ai" });
    expect(
      h.rpc.mock.calls.map(([, args]) => (args as { p_new_turn: boolean }).p_new_turn)
    ).toEqual([true, false]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.headers.get(VISITOR_HEADERS.remaining)).toBe("61");
  });

  it("answers with the fallback, without a second call, when the meter refuses the repair", async () => {
    fetchMock.mockImplementation(async () => new Response(sse("not json")));
    h.rpc.mockResolvedValueOnce({ data: meterReply(), error: null }).mockResolvedValueOnce({
      data: meterReply({ allowed: false, reason: "site_busy", turns_used: 39 }),
      error: null,
    });
    const res = await POST(post(ASK));
    expect(await res.json()).toEqual({
      ok: true,
      data: { options: fallbackOptions(QUESTION) },
      source: "fallback",
      reason: "bad_answer",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The headers come from the latest meter answer, the refused repair's.
    expect(res.headers.get(VISITOR_HEADERS.remaining)).toBe("61");
  });

  it("answers 504 timeout, with the quota headers, when the gateway sends no headers in time", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      let seen: AbortSignal | undefined;
      fetchMock.mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            seen = init.signal ?? undefined;
            seen?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError"))
            );
          })
      );
      const pending = POST(post(ASK));
      for (let i = 0; i < 200 && !seen; i++) await new Promise((r) => setImmediate(r));
      expect(seen?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(TOOL_AI_FIRST_BYTE_TIMEOUT_MS);
      const res = await pending;
      await expectRefusal(res, 504, "timeout");
      expect(res.headers.get(VISITOR_HEADERS.remaining)).toBe("62");
      expect(seen?.aborted).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("turns a gateway failure into a status, with the quota headers", async () => {
    fetchMock.mockImplementation(async () => new Response("busy", { status: 429 }));
    const res = await POST(post(ASK));
    await expectRefusal(res, 503, "upstream_busy");
    expect(res.headers.get(VISITOR_HEADERS.remaining)).toBe("62");
  });

  it("logs no question, answer, address or code", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const address = "10.8.8.8";
    await POST(post(ASK, { "x-real-ip": address }));
    const lines = [...info.mock.calls, ...warn.mock.calls].map((args) => args.join(" ")).join("\n");
    expect(lines).not.toContain("release notes");
    expect(lines).not.toContain(address);
    expect(lines).not.toContain(visitorKey(address, cairoDay(), SECRET)!);
    expect(lines).not.toContain("Not sure");
  });
});
