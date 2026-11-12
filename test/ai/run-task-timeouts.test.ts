// @vitest-environment node
/**
 * The ways a tool AI answer can stop early, through the runner itself
 * (runAiTask, lib/ai/run-task.server.ts) and the owner's Run with AI stream
 * (runPromptStream, lib/ai/prompt-run.server.ts):
 *   - no response headers in time: the error "timeout" (the routes answer 504);
 *   - a stream that breaks, stalls or runs into the deadline after half an
 *     answer: the task's fallback with reason "timeout", and never a repair
 *     call (a second call would cost a use for an answer already cut);
 *   - the deadline aborts the gateway call itself;
 *   - Run with AI ends with {"error": "time_limit"} or {"error": "cut"} before
 *     [DONE], and a reader that stops reading aborts the gateway call.
 * fetch is a local stub; nothing leaves the machine.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { IDLE_TIMEOUT_MS } from "@/lib/agent/upstream";
import { runPromptStream } from "@/lib/ai/prompt-run.server";
import { runAiTask } from "@/lib/ai/run-task.server";
import { fallbackOptions, suggestOptionsTask } from "@/lib/ai/tasks/_example";
import { suggestOptionsPrompt } from "@/lib/ai/tasks/_example.server";

const QUESTION = "Should we keep the Friday demo?";
const BACKEND = {
  provider: "openclaw" as const,
  url: "https://gateway.test/v1/chat/completions",
  key: "placeholder-not-a-key",
  model: "openclaw-flash",
};
const enc = new TextEncoder();

function chunk(content: string): Uint8Array {
  return enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
}

/**
 * A gateway answer that sends `first` and then, once that was read, hangs
 * (never another byte) or breaks (the connection resets).
 */
function partial(first: string, then: "hang" | "error") {
  let pulls = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      pulls += 1;
      if (pulls === 1) c.enqueue(chunk(first));
      else if (then === "error") c.error(new Error("connection reset"));
      else return new Promise<void>(() => {});
    },
  });
}

/** A fetch stub that answers with `body`, recording each call's signal. */
function gateway(body: () => ReadableStream<Uint8Array>) {
  const signals: AbortSignal[] = [];
  const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
    if (init.signal) signals.push(init.signal);
    return new Response(body(), { status: 200 });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls: fetchImpl, signals };
}

/** A fetch stub that never answers until it is aborted. */
function silentGateway() {
  const signals: AbortSignal[] = [];
  const fetchImpl = vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        if (init.signal) signals.push(init.signal);
        init.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError"))
        );
      })
  );
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls: fetchImpl, signals };
}

const HALF_ANSWER = '{"options":["Monday","Tue';

function run(fetchImpl: typeof fetch, over: Partial<Parameters<typeof runAiTask>[0]> = {}) {
  return runAiTask({
    task: suggestOptionsTask,
    prompt: suggestOptionsPrompt,
    input: { question: QUESTION },
    backend: BACKEND,
    caller: "agile-toolkit",
    deadlineMs: 240_000,
    fetchImpl,
    ...over,
  });
}

const FALLBACK_TIMEOUT = {
  ok: true,
  data: { options: fallbackOptions(QUESTION) },
  source: "fallback",
  reason: "timeout",
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("runAiTask", () => {
  it("answers the error 'timeout' when no response headers come in time", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const g = silentGateway();
    const result = await run(g.fetchImpl, { firstByteTimeoutMs: 20 });
    expect(result).toMatchObject({ ok: false, error: "timeout" });
    expect(g.calls).toHaveBeenCalledTimes(1);
    expect(g.signals[0].aborted).toBe(true);
  });

  it("answers the fallback, without a repair, when the stream breaks after half an answer", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const g = gateway(() => partial(HALF_ANSWER, "error"));
    const result = await run(g.fetchImpl);
    expect(result).toMatchObject(FALLBACK_TIMEOUT);
    expect(g.calls).toHaveBeenCalledTimes(1);
  });

  it("aborts the gateway call at the deadline and answers the fallback, without a repair", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const g = gateway(() => partial(HALF_ANSWER, "hang"));
    const result = await run(g.fetchImpl, { deadlineMs: 80 });
    expect(result).toMatchObject(FALLBACK_TIMEOUT);
    expect(g.calls).toHaveBeenCalledTimes(1);
    expect(g.signals[0].aborted).toBe(true);
  });

  it("answers the fallback when the stream stalls, without a repair", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const g = gateway(() => partial(HALF_ANSWER, "hang"));
    const pending = run(g.fetchImpl);
    for (let i = 0; i < 50 && g.calls.mock.calls.length === 0; i++) {
      await new Promise((r) => setImmediate(r));
    }
    expect(g.calls).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS + 10);
    expect(await pending).toMatchObject(FALLBACK_TIMEOUT);
    expect(g.calls).toHaveBeenCalledTimes(1);
    expect(g.signals[0].aborted).toBe(true);
  });
});

describe("runPromptStream (Run with AI)", () => {
  async function events(stream: ReadableStream<Uint8Array>): Promise<string[]> {
    const text = await new Response(stream).text();
    return text
      .split("\n\n")
      .filter(Boolean)
      .map((e) => e.replace(/^data: /, ""));
  }

  function start(
    fetchImpl: typeof fetch,
    over: Partial<Parameters<typeof runPromptStream>[0]> = {}
  ) {
    return runPromptStream({
      input: { prompt: "Summarise this retro.", toolName: "Retro" },
      backend: { ...BACKEND, model: "openclaw" },
      caller: "agile-toolkit",
      deadlineMs: 240_000,
      fetchImpl,
      ...over,
    });
  }

  it("ends with time_limit when the deadline cuts the answer, and aborts the gateway call", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const g = gateway(() => partial("Three themes", "hang"));
    const onDone = vi.fn();
    const run = await start(g.fetchImpl, { deadlineMs: 80, onDone });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(await events(run.stream)).toEqual([
      JSON.stringify({ text: "Three themes" }),
      JSON.stringify({ error: "time_limit" }),
      "[DONE]",
    ]);
    expect(g.signals[0].aborted).toBe(true);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("ends with cut when the gateway's stream breaks", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const g = gateway(() => partial("Three themes", "error"));
    const run = await start(g.fetchImpl);
    if (!run.ok) throw new Error("expected a stream");
    expect(await events(run.stream)).toEqual([
      JSON.stringify({ text: "Three themes" }),
      JSON.stringify({ error: "cut" }),
      "[DONE]",
    ]);
  });

  it("finishes onDone's work before [DONE] and the close", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const g = gateway(
      () =>
        new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(chunk("Done."));
            c.enqueue(
              enc.encode(
                `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 2 } })}\n\n`
              )
            );
            c.close();
          },
        })
    );
    let written = false;
    const run = await start(g.fetchImpl, {
      onDone: async (usage) => {
        await new Promise((r) => setTimeout(r, 30));
        written = usage?.tokensIn === 5 && usage?.tokensOut === 2;
      },
    });
    if (!run.ok) throw new Error("expected a stream");
    const all = await events(run.stream);
    expect(all.at(-1)).toBe("[DONE]");
    expect(written).toBe(true);
  });

  it("stops paying for tokens: a reader that cancels aborts the gateway call", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const g = gateway(() => partial("Three themes", "hang"));
    const run = await start(g.fetchImpl);
    if (!run.ok) throw new Error("expected a stream");
    const reader = run.stream.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("Three themes");
    expect(g.signals[0].aborted).toBe(false);
    await reader.cancel();
    expect(g.signals[0].aborted).toBe(true);
  });
});
