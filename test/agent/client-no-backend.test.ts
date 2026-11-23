/**
 * An owner's turn with nothing to send to: the agent route's mode probe fails,
 * or says the server has no AI key, and AI Settings holds no GLM key of the
 * owner's own. The chat says why in plain words (the setup detail goes to the
 * console), and nothing is sent.
 *
 * Kept in its own file because the client caches a successful probe for the
 * page session: the failing probes run first, the "client" one last.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

vi.mock("@/lib/agent/persist", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent/persist")>()),
  recordChatUsage: async () => {},
  appendMessages: async () => {},
}));
// No key of the owner's own in AI Settings.
vi.mock("@/lib/stores/llm-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stores/llm-store")>()),
  getActiveConfig: () => null,
}));

import { NOTICE_TEXT, sendUserMessage } from "@/lib/agent/client";
import { useAgentStore } from "@/lib/agent/store";

/** What the probe answers, in turn; a POST must never happen. */
let probes: Array<() => Response>;
let gets: number;
let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  probes = [];
  gets = 0;
  useAgentStore.getState().reset();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init && init.method !== "GET") throw new Error("unexpected POST");
      gets += 1;
      const next = probes.shift();
      if (!next) throw new TypeError("Failed to fetch");
      return next();
    })
  );
});

afterEach(() => {
  warn.mockRestore();
  vi.unstubAllGlobals();
});

const send = () => sendUserMessage("hi", { userId: "owner-1", toolId: null });

describe("an owner's turn with no backend", () => {
  it("asks the route twice, then says the server can't be reached", async () => {
    await send();
    const s = useAgentStore.getState();
    expect(gets).toBe(2);
    expect(s.notice).toEqual({ tone: "error", kind: "unreachable", text: NOTICE_TEXT.unreachable });
    expect(s.notice?.text).not.toMatch(/GLM_API_KEY|server's/);
    expect(s.messages.map((m) => m.role)).toEqual(["user"]);
    expect(s.streaming).toBe(false);
    expect(warn).toHaveBeenCalledWith("[agent] the agent route's probe failed (no answer)");
  });

  it("says to sign in again when the probe is refused as signed out", async () => {
    probes = [() => new Response(null, { status: 401 }), () => new Response(null, { status: 401 })];
    await send();
    expect(useAgentStore.getState().notice).toMatchObject({ tone: "error", kind: "signed_out" });
  });

  it("goes on with the server when the second probe gets through", async () => {
    // A fresh client: this one caches the server's answer, which the next
    // test must not see.
    vi.resetModules();
    const client = await import("@/lib/agent/client");
    const { useAgentStore: store } = await import("@/lib/agent/store");
    probes = [
      () => new Response(null, { status: 502 }),
      () => Response.json({ mode: "server", model: "openclaw" }),
    ];
    await client.sendUserMessage("hi", { userId: "owner-1", toolId: null });
    expect(gets).toBe(2);
    // It went on to the request, which this file refuses: no setup note.
    expect(store.getState().notice?.kind).toBe("stream_failed");
  });

  it("says no AI key is set when the route has none and AI Settings has none", async () => {
    probes = [() => Response.json({ mode: "client", provider: null })];
    await send();
    const s = useAgentStore.getState();
    expect(gets).toBe(1);
    expect(s.notice).toEqual({ tone: "error", kind: "no_key", text: NOTICE_TEXT.noKey });
    expect(s.messages.map((m) => m.role)).toEqual(["user"]);
    expect(warn.mock.calls[0]?.[0]).toMatch(/^\[agent\] no AI key/);
  });
});
