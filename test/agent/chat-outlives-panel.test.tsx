/**
 * Closing the panel never stops an answer (Amr chat revamp, PR 3): the
 * owner's panel and the visitor's chat unmount when the panel closes, and the
 * turn goes on in the agent store and the client until its reply is written
 * in full. Only Stop, New chat, a thread switch, sign-out or the chat changing
 * hands stop it.
 *
 * The real client and the real visitor runtime run against a stream the test
 * feeds by hand: part of the reply arrives, the container unmounts, the rest
 * arrives, and the store ends with the whole reply, its request never
 * aborted. The action registry is left empty (register-all is mocked), and
 * persistence and the sign-in are stubbed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  appendMessages: vi.fn<(conversationId: string, msgs: unknown[]) => Promise<void>>(async () => {}),
}));

vi.mock("@/lib/actions/register-all", () => ({}));
vi.mock("@/lib/agent/persist", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent/persist")>()),
  appendMessages: h.appendMessages,
  recordChatUsage: vi.fn(async () => {}),
  fetchChatUsage: vi.fn(async () => null),
  listConversations: vi.fn(async () => []),
  loadMessages: vi.fn(async () => []),
  renameConversation: vi.fn(async () => {}),
  deleteConversation: vi.fn(async () => {}),
  createConversation: vi.fn(async () => ({
    id: "conv-1",
    title: "tell me about retros",
    toolId: null,
    createdAt: "2026-11-12T08:00:00Z",
    updatedAt: "2026-11-12T08:00:00Z",
    lastMessageAt: "2026-11-12T08:00:00Z",
  })),
}));
vi.mock("@/lib/auth/supabase-browser", () => ({ getAuthBrowserClient: () => null }));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuth: () => ({ user: { id: "owner-1" } }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

import OwnerAgentPanel from "@/components/agent/mascot/owner-agent-panel";
import VisitorAgentPanel from "@/components/agent/mascot/visitor-agent-panel";
import { useAgentStore } from "@/lib/agent/store";
import type { ChatMessage } from "@/lib/agent/types";
import { VISITOR_AI_PATH } from "@/lib/visitor-ai/contract";

/**
 * A streamed response the test feeds by hand. Like a real one, its body fails
 * with an AbortError once its request is aborted.
 */
function manualStream() {
  const enc = new TextEncoder();
  let ctl!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      ctl = c;
    },
  });
  const quietly = (fn: () => void) => {
    try {
      fn();
    } catch {
      /* the reader already let go of the stream */
    }
  };
  return {
    respond(init: RequestInit): Response {
      init.signal?.addEventListener(
        "abort",
        () => quietly(() => ctl.error(Object.assign(new Error("aborted"), { name: "AbortError" }))),
        { once: true }
      );
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    },
    /** Events as one network chunk ("[DONE]" passes through). */
    send(...events: unknown[]) {
      const text = events
        .map((e) => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`)
        .join("");
      quietly(() => ctl.enqueue(enc.encode(text)));
    },
    end() {
      quietly(() => ctl.close());
    },
  };
}

const delta = (d: Record<string, unknown>, finish: string | null = null) => ({
  choices: [{ delta: d, finish_reason: finish }],
});

const textOf = (m: ChatMessage | undefined) =>
  (m?.content ?? []).map((c) => (c.type === "text" ? c.text : "")).join("");

const lastAssistant = () =>
  useAgentStore
    .getState()
    .messages.filter((m) => m.role === "assistant")
    .at(-1);

/** The requests the turn posted, with the signal each one carries. */
let posts: Array<{ url: string; signal: AbortSignal | null | undefined }>;
let body: ReturnType<typeof manualStream>;

beforeEach(() => {
  posts = [];
  body = manualStream();
  h.appendMessages.mockClear();
  useAgentStore.getState().reset();
  useAgentStore.setState({ chatProfile: "owner", visitorQuota: null, open: true });
  if (typeof Element.prototype.scrollTo !== "function") Element.prototype.scrollTo = () => {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      // The owner's mode probe.
      if (!init || init.method === "GET") {
        return Response.json({ mode: "server", model: "openclaw", provider: "openclaw" });
      }
      if (posts.length > 0) throw new Error(`unexpected request to ${url}`);
      posts.push({ url, signal: init.signal });
      return body.respond(init);
    })
  );
});

afterEach(() => {
  useAgentStore.getState().reset();
  useAgentStore.setState({ chatProfile: "owner", visitorQuota: null, open: false });
  vi.unstubAllGlobals();
});

describe("closing the panel mid-answer", () => {
  it("leaves the owner's turn running: the reply finishes in the store and is saved", async () => {
    const view = render(
      <OwnerAgentPanel showHistory={false} onToggleHistory={() => {}} onCloseHistory={() => {}} />
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: "tell me about retros" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await vi.waitFor(() => expect(posts).toHaveLength(1));
    body.send(delta({ content: "Retros are" }));
    await vi.waitFor(() => expect(textOf(lastAssistant())).toBe("Retros are"));

    // The panel closes: the owner's panel unmounts with the answer half written.
    view.unmount();
    expect(posts[0].signal?.aborted).toBe(false);
    expect(useAgentStore.getState().streaming).toBe(true);

    body.send(delta({ content: " a team's look back." }), delta({}, "stop"), "[DONE]");
    body.end();
    await vi.waitFor(() => expect(useAgentStore.getState().streaming).toBe(false));

    expect(textOf(lastAssistant())).toBe("Retros are a team's look back.");
    expect(posts[0].signal?.aborted).toBe(false);
    expect(useAgentStore.getState().notice).toBeNull();
    // The thread the send created holds the question and the whole reply.
    expect(useAgentStore.getState().activeConversationId).toBe("conv-1");
    const saved = h.appendMessages.mock.calls
      .filter((c) => c[0] === "conv-1")
      .flatMap((c) => c[1] as ChatMessage[]);
    expect(saved.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(textOf(saved[1])).toBe("Retros are a team's look back.");
  });

  it("leaves the visitor's turn running: the reply finishes in the store", async () => {
    const view = render(
      <VisitorAgentPanel initialQuestion="how do I run a retro?" onOfflineGuide={() => {}} />
    );

    await vi.waitFor(() => expect(posts).toHaveLength(1), { timeout: 4000 });
    expect(posts[0].url).toBe(VISITOR_AI_PATH);
    body.send(delta({ content: "Start with" }));
    await vi.waitFor(() => expect(textOf(lastAssistant())).toBe("Start with"));

    // The panel closes (or the visitor goes back to the tool finder): the chat unmounts.
    view.unmount();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(posts[0].signal?.aborted).toBe(false);
    expect(useAgentStore.getState().streaming).toBe(true);

    body.send(delta({ content: " what went well." }), delta({}, "stop"), "[DONE]");
    body.end();
    await vi.waitFor(() => expect(useAgentStore.getState().streaming).toBe(false));

    expect(textOf(lastAssistant())).toBe("Start with what went well.");
    expect(posts[0].signal?.aborted).toBe(false);
    expect(useAgentStore.getState().chatProfile).toBe("visitor");
    expect(useAgentStore.getState().notice).toBeNull();
  });

  it("still lets New chat stop the turn after the panel has closed", async () => {
    const view = render(
      <OwnerAgentPanel showHistory={false} onToggleHistory={() => {}} onCloseHistory={() => {}} />
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: "tell me about retros" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    body.send(delta({ content: "Retros are" }));
    await vi.waitFor(() => expect(textOf(lastAssistant())).toBe("Retros are"));
    view.unmount();

    // New chat from the header (or sign-out) stops it through the store.
    useAgentStore.getState().reset();
    expect(posts[0].signal?.aborted).toBe(true);
    await vi.waitFor(() => expect(useAgentStore.getState().abortHook).toBeNull());
    expect(useAgentStore.getState().messages).toEqual([]);
  });
});
