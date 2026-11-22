/**
 * useToolAi (lib/ai/use-tool-ai.ts): which route a run goes to, and when it
 * goes nowhere.
 *   - The signed-in owner asks the owner route.
 *   - A visitor asks the visitor route, only with visitor AI on in this build
 *     and after agreeing to the card; before that, nothing is sent.
 *   - While a live room is open, a visitor gets no AI at all; the owner still can.
 *   - A visitor's answer updates the chat panel's count.
 *   - Every error comes back in plain words, with the task's fallback ready.
 *   - A lazy ref (lib/ai/task-ref) loads its def on the first run, never on
 *     mount, and its no-AI answer never waits for it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  auth: null as { status: string; user: { id: string } | null; error?: string } | null,
}));

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuthOptional: () => h.auth,
}));

import { TOOL_AI_ERROR_TEXT } from "@/lib/ai/contract";
import { lazyAiTask } from "@/lib/ai/task-ref";
import type { AiTaskDef } from "@/lib/ai/task-types";
import { fallbackOptions, suggestOptionsTask } from "@/lib/ai/tasks/_example";
import { TOOL_AI_UNAVAILABLE_TEXT, useToolAi } from "@/lib/ai/use-tool-ai";
import { useAgentStore } from "@/lib/agent/store";
import { enterLiveVisitorRoom } from "@/lib/realtime/live-visitor-room";
import { VISITOR_HEADERS } from "@/lib/visitor-ai/contract";
import { VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION } from "@/lib/visitor-ai/consent";

const OWNER = { status: "authenticated", user: { id: "owner-1" } };
const QUESTION = "Should we keep the Friday demo?";
const INPUT = { question: QUESTION };

let fetchMock: ReturnType<typeof vi.fn>;

function ok(data: unknown, headers: Record<string, string> = {}, source = "ai") {
  return new Response(JSON.stringify({ ok: true, data, source }), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

function refusal(status: number, error: string, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const QUOTA = {
  [VISITOR_HEADERS.remaining]: "41",
  [VISITOR_HEADERS.limit]: "100",
  [VISITOR_HEADERS.peak]: "0",
  [VISITOR_HEADERS.peakLimit]: "25",
};

function setup() {
  return renderHook(() => useToolAi(suggestOptionsTask));
}

beforeEach(() => {
  h.auth = null;
  fetchMock = vi.fn(async () => ok({ options: ["Yes", "No"] }, QUOTA));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("NEXT_PUBLIC_VISITOR_AI", "1");
  window.localStorage.setItem(VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION);
  useAgentStore.setState({ visitorQuota: null });
});

afterEach(() => {
  window.localStorage.removeItem(VISITOR_AI_CONSENT_KEY);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the owner", () => {
  beforeEach(() => {
    h.auth = OWNER;
  });

  it("asks the owner route with the task id and input, and gets the answer", async () => {
    const { result } = setup();
    expect(result.current).toMatchObject({ available: true, path: "owner", reason: null });
    let out: unknown;
    await act(async () => {
      out = await result.current.run(INPUT);
    });
    expect(out).toEqual({ status: "done", data: { options: ["Yes", "No"] }, source: "ai" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/ai/tool");
    expect(JSON.parse(init.body as string)).toEqual({ task: "ai.suggest_options", input: INPUT });
    expect(result.current).toMatchObject({
      status: "done",
      data: { options: ["Yes", "No"] },
      source: "ai",
    });
    // The owner's answers never touch the visitor's count.
    expect(useAgentStore.getState().visitorQuota).toBeNull();
  });

  it("needs no consent card", async () => {
    window.localStorage.removeItem(VISITOR_AI_CONSENT_KEY);
    const { result } = setup();
    await act(async () => {
      await result.current.run(INPUT);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("can run an owner-only task", async () => {
    const ownerOnlyTask = { ...suggestOptionsTask, ownerOnly: true };
    const { result } = renderHook(() => useToolAi(ownerOnlyTask));
    expect(result.current).toMatchObject({ available: true, path: "owner", reason: null });
    await act(async () => {
      await result.current.run(INPUT);
    });
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe("/api/ai/tool");
  });

  it("can still ask while hosting a live room", async () => {
    const leave = enterLiveVisitorRoom();
    try {
      const { result } = setup();
      expect(result.current.available).toBe(true);
      expect(result.current.path).toBe("owner");
    } finally {
      leave();
    }
  });

  it("reports the fallback as the source when the server used it", async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            data: { options: ["A", "B"] },
            source: "fallback",
            reason: "length",
          }),
          { status: 200 }
        )
    );
    const { result } = setup();
    let out: unknown;
    await act(async () => {
      out = await result.current.run(INPUT);
    });
    expect(out).toMatchObject({ status: "done", source: "fallback", reason: "length" });
    expect(result.current.fallbackReason).toBe("length");
  });
});

describe("a visitor", () => {
  it("asks the visitor route and updates the chat panel's count", async () => {
    const { result } = setup();
    expect(result.current).toMatchObject({ available: true, path: "visitor" });
    await act(async () => {
      await result.current.run(INPUT);
    });
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe("/api/ai/tool/visitor");
    expect(result.current.remaining).toBe(41);
    expect(useAgentStore.getState().visitorQuota).toMatchObject({ remaining: 41, limit: 100 });
  });

  it("sends nothing before agreeing, then runs the waiting input on agree", async () => {
    window.localStorage.removeItem(VISITOR_AI_CONSENT_KEY);
    const { result } = setup();
    let out: unknown;
    await act(async () => {
      out = await result.current.run(INPUT);
    });
    expect(out).toEqual({ status: "needs_consent" });
    expect(result.current.status).toBe("needs_consent");
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      out = await result.current.agree();
    });
    expect(window.localStorage.getItem(VISITOR_AI_CONSENT_KEY)).toBe(VISITOR_AI_CONSENT_VERSION);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ status: "done" });
  });

  it("drops the waiting input on decline, still sending nothing", async () => {
    window.localStorage.removeItem(VISITOR_AI_CONSENT_KEY);
    const { result } = setup();
    await act(async () => {
      await result.current.run(INPUT);
    });
    act(() => result.current.decline());
    expect(result.current.status).toBe("idle");
    await act(async () => {
      await result.current.agree();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks again after an older card's agreement (v1)", async () => {
    window.localStorage.setItem(VISITOR_AI_CONSENT_KEY, "v1");
    const { result } = setup();
    let out: unknown;
    await act(async () => {
      out = await result.current.run(INPUT);
    });
    expect(out).toEqual({ status: "needs_consent" });
  });

  it("gets nothing while visitor AI is off in this build", async () => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_AI", "");
    const { result } = setup();
    expect(result.current).toMatchObject({ available: false, reason: "off", path: null });
    expect(result.current.reasonText).toBe(TOOL_AI_UNAVAILABLE_TEXT.off);
    let out: unknown;
    await act(async () => {
      out = await result.current.run(INPUT);
    });
    expect(out).toEqual({ status: "unavailable", reason: "off" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gets nothing while a live room is open, and says why", async () => {
    const leave = enterLiveVisitorRoom();
    try {
      const { result } = setup();
      expect(result.current).toMatchObject({ available: false, reason: "live_room" });
      expect(result.current.reasonText).toBe(TOOL_AI_UNAVAILABLE_TEXT.live_room);
      await act(async () => {
        await result.current.run(INPUT);
      });
      expect(fetchMock).not.toHaveBeenCalled();
      act(() => leave());
      expect(result.current.available).toBe(true);
    } finally {
      leave();
    }
  });

  it("gets no owner-only task: no consent card and nothing sent", async () => {
    window.localStorage.removeItem(VISITOR_AI_CONSENT_KEY);
    const ownerOnlyTask = { ...suggestOptionsTask, ownerOnly: true };
    const { result } = renderHook(() => useToolAi(ownerOnlyTask));
    expect(result.current).toMatchObject({ available: false, reason: "owner_only", path: null });
    expect(result.current.reasonText).toBe(TOOL_AI_UNAVAILABLE_TEXT.owner_only);
    let out: unknown;
    await act(async () => {
      out = await result.current.run(INPUT);
    });
    expect(out).toEqual({ status: "unavailable", reason: "owner_only" });
    expect(result.current.status).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(VISITOR_AI_CONSENT_KEY)).toBeNull();
  });

  it("waits while sign-in is still settling", () => {
    h.auth = { status: "loading", user: null };
    const { result } = setup();
    expect(result.current).toMatchObject({ available: false, reason: "loading" });
  });
});

describe("errors", () => {
  it("come back in plain words, with the task's fallback ready", async () => {
    fetchMock.mockImplementation(async () => refusal(429, "visitor_limit", QUOTA));
    const { result } = setup();
    let out: unknown;
    await act(async () => {
      out = await result.current.run(INPUT);
    });
    expect(out).toEqual({
      status: "error",
      error: { code: "visitor_limit", message: TOOL_AI_ERROR_TEXT.visitor_limit },
      fallback: { options: fallbackOptions(QUESTION) },
    });
    expect(TOOL_AI_ERROR_TEXT.visitor_limit).toBe(
      "Amr has used today's AI answers. The tool still works without AI."
    );
    expect(result.current.status).toBe("error");
    // The refusal's quota still updates the count.
    expect(result.current.remaining).toBe(41);
  });

  it("treat an answer that doesn't fit the task as a bad answer", async () => {
    fetchMock.mockImplementation(async () => ok({ options: "Yes" }));
    const { result } = setup();
    let out: { status: string; error?: { code: string } } | undefined;
    await act(async () => {
      out = (await result.current.run(INPUT)) as typeof out;
    });
    expect(out?.status).toBe("error");
    expect(out?.error?.code).toBe("bad_answer");
  });

  it("turn a failed request into a network error", async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError("Failed to fetch");
    });
    const { result } = setup();
    let out: { error?: { code: string } } | undefined;
    await act(async () => {
      out = (await result.current.run(INPUT)) as typeof out;
    });
    expect(out?.error?.code).toBe("network");
  });

  it("check the input first: a bad one never leaves the browser", async () => {
    const { result } = setup();
    let out: { status: string; error?: { code: string }; fallback?: unknown } | undefined;
    await act(async () => {
      out = (await result.current.run({ question: "" })) as typeof out;
    });
    expect(out).toMatchObject({ status: "error", error: { code: "bad_input" }, fallback: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cancel leaves nothing behind", async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError"))
          );
        })
    );
    const { result } = setup();
    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = result.current.run(INPUT);
    });
    expect(result.current.status).toBe("running");
    let out: unknown;
    await act(async () => {
      result.current.cancel();
      out = await pending;
    });
    expect(out).toEqual({ status: "cancelled" });
    expect(result.current.status).toBe("idle");
    expect(result.current.error).toBeNull();
  });
});

// ── Lazy refs ──────────────────────────────────────────────────────────────

type Def = AiTaskDef<{ question: string }, { options: string[] }>;

let lazyCount = 0;

/**
 * A ref to a copy of the example task under a fresh id, so its def is not
 * loaded until the ref loads it (a def made with defineAiTask is loaded as
 * soon as its module runs). `load` stands in for the dynamic import.
 */
function lazyRef(load?: (def: Def) => Promise<Def>, { ownerOnly }: { ownerOnly?: true } = {}) {
  const id = `ai.lazy_${++lazyCount}` as const;
  const def: Def = { ...suggestOptionsTask, id, ...(ownerOnly ? { ownerOnly } : {}) };
  const loader = vi.fn(() => (load ? load(def) : Promise.resolve(def)));
  const ref = lazyAiTask(
    {
      id,
      toolId: "ai",
      fallback: suggestOptionsTask.fallback,
      ...(ownerOnly ? { ownerOnly } : {}),
    },
    loader
  );
  return { id, def, ref, loader };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("a lazy ref", () => {
  beforeEach(() => {
    h.auth = OWNER;
  });

  it("loads its def on the first run, not on mount, and once", async () => {
    const { id, ref, loader } = lazyRef();
    const { result } = renderHook(() => useToolAi(ref));
    expect(result.current).toMatchObject({ available: true, path: "owner" });
    expect(loader).not.toHaveBeenCalled();
    expect(ref.peek()).toBeNull();
    let out: unknown;
    await act(async () => {
      out = await result.current.run(INPUT);
    });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ status: "done", data: { options: ["Yes", "No"] }, source: "ai" });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ task: id, input: INPUT });
    expect(ref.peek()).not.toBeNull();
    await act(async () => {
      await result.current.run(INPUT);
    });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("checks the input against the loaded schema before sending", async () => {
    const { ref } = lazyRef();
    const { result } = renderHook(() => useToolAi(ref));
    let out: unknown;
    await act(async () => {
      out = await result.current.run({ question: "" });
    });
    expect(out).toMatchObject({ status: "error", error: { code: "bad_input" }, fallback: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preloads while AI is available, sharing the load with the run", async () => {
    const { ref, loader } = lazyRef();
    const { result } = renderHook(() => useToolAi(ref));
    act(() => result.current.preload());
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    await act(async () => {
      await result.current.run(INPUT);
    });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("never preloads while AI is unavailable", async () => {
    h.auth = null;
    vi.stubEnv("NEXT_PUBLIC_VISITOR_AI", "");
    const { ref, loader } = lazyRef();
    const { result } = renderHook(() => useToolAi(ref));
    expect(result.current.available).toBe(false);
    await act(async () => {
      result.current.preload();
      await Promise.resolve();
    });
    expect(loader).not.toHaveBeenCalled();
  });

  it("says running while the def loads, and cancel gives up the run", async () => {
    const gate = deferred<Def>();
    const { def, ref } = lazyRef(() => gate.promise);
    const { result } = renderHook(() => useToolAi(ref));
    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = result.current.run(INPUT);
    });
    expect(result.current.status).toBe("running");
    let out: unknown;
    await act(async () => {
      result.current.cancel();
      out = await pending;
    });
    expect(out).toEqual({ status: "cancelled" });
    expect(result.current.status).toBe("idle");
    // The load finishing later sends nothing.
    await act(async () => {
      gate.resolve(def);
      await gate.promise;
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });

  it("answers load_failed when the def won't load, with the ref's fallback, and retries", async () => {
    const { def, ref, loader } = lazyRef(() => Promise.reject(new Error("chunk failed")));
    const { result } = renderHook(() => useToolAi(ref));
    let out: unknown;
    await act(async () => {
      out = await result.current.run(INPUT);
    });
    expect(out).toEqual({
      status: "error",
      error: { code: "load_failed", message: TOOL_AI_ERROR_TEXT.load_failed },
      fallback: { options: fallbackOptions(QUESTION) },
    });
    expect(TOOL_AI_ERROR_TEXT.load_failed).toBe(
      "Couldn't load Amr's help. Check your connection and try again. The tool still works without AI."
    );
    expect(result.current.status).toBe("error");
    expect(fetchMock).not.toHaveBeenCalled();
    // A failed load is forgotten: the next run loads again.
    loader.mockImplementation(() => Promise.resolve(def));
    await act(async () => {
      out = await result.current.run(INPUT);
    });
    expect(loader).toHaveBeenCalledTimes(2);
    expect(out).toMatchObject({ status: "done" });
  });

  it("shares one load between two runs at once", async () => {
    const gate = deferred<Def>();
    const { def, ref, loader } = lazyRef(() => gate.promise);
    const a = renderHook(() => useToolAi(ref));
    const b = renderHook(() => useToolAi(ref));
    let first: Promise<unknown> = Promise.resolve();
    let second: Promise<unknown> = Promise.resolve();
    act(() => {
      first = a.result.current.run(INPUT);
      second = b.result.current.run(INPUT);
    });
    let outs: unknown[] = [];
    await act(async () => {
      gate.resolve(def);
      outs = await Promise.all([first, second]);
    });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(outs).toEqual([
      expect.objectContaining({ status: "done" }),
      expect.objectContaining({ status: "done" }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("hides an owner-only ref from a visitor before anything loads", async () => {
    h.auth = null;
    window.localStorage.removeItem(VISITOR_AI_CONSENT_KEY);
    const { ref, loader } = lazyRef(undefined, { ownerOnly: true });
    const { result } = renderHook(() => useToolAi(ref));
    expect(result.current).toMatchObject({ available: false, reason: "owner_only", path: null });
    let out: unknown;
    await act(async () => {
      out = await result.current.run(INPUT);
      result.current.preload();
    });
    expect(out).toEqual({ status: "unavailable", reason: "owner_only" });
    expect(loader).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers without AI at once, before its def loads", () => {
    const { ref, loader } = lazyRef();
    const { result } = renderHook(() => useToolAi(ref));
    expect(result.current.fallback(INPUT)).toEqual({ options: fallbackOptions(QUESTION) });
    expect(loader).not.toHaveBeenCalled();
  });

  it("keeps a visitor's input for the consent card, then sends it with the loaded def", async () => {
    h.auth = null;
    window.localStorage.removeItem(VISITOR_AI_CONSENT_KEY);
    const { id, ref, loader } = lazyRef();
    const { result } = renderHook(() => useToolAi(ref));
    let out: unknown;
    await act(async () => {
      out = await result.current.run(INPUT);
    });
    expect(out).toEqual({ status: "needs_consent" });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      out = await result.current.agree();
    });
    expect(out).toMatchObject({ status: "done" });
    expect(loader).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/ai/tool/visitor");
    expect(JSON.parse(init.body as string)).toEqual({ task: id, input: INPUT });
  });
});
