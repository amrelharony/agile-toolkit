import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * A streamed chunk re-renders the comic strip alone (chat revamp PR 9, audit
 * per-token-rerender): never Amr's own shell (MascotAssistant, 1,000+ lines
 * with his figure, header and placement), never the chat's container with
 * its composer and card, and of the strip's items only the reply still
 * growing. A React Profiler around Amr counts the commits, so each chunk is
 * seen to land; counters on the shell's own focus hook, the visitor chat's
 * view and the markdown renderer say who drew it.
 *
 * Amr's figure is a stand-in; the visitor chat is the real one, opened from
 * the tool finder with consent already given, and its runtime is mocked. The
 * owner's chat (agent-conversation) is checked on its own, its renders
 * counted by its useAuth call.
 */

const h = vi.hoisted(() => ({
  /** MascotAssistant renders: usePanelFocus is its own hook, called once a render. */
  shell: 0,
  /** The visitor chat's view (visitor-agent-panel) renders. */
  chat: 0,
  /** The owner's chat view (agent-conversation) renders: useAuth is called once a render. */
  owner: 0,
  /** Markdown renders, by the reply's source. */
  markdown: new Map<string, number>(),
}));

vi.mock("@/lib/auth/auth-provider", () => ({
  // Amr's shell: a visitor. The owner's chat, rendered on its own: the owner.
  useAuthOptional: () => ({ status: "anonymous", user: null }),
  useAuth: () => {
    h.owner++;
    return { user: { id: "owner-1" } };
  },
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/retro" }));
vi.mock("@/lib/agent/client", () => ({
  abortInFlight: vi.fn(),
  sendUserMessage: vi.fn(async () => {}),
  generateTitle: vi.fn(async () => null),
  retryLastTurn: vi.fn(async () => true),
  goOn: vi.fn(async () => true),
  canRetryLastTurn: vi.fn(() => true),
}));
vi.mock("@/lib/agent/persist", () => ({
  listConversations: vi.fn(async () => []),
  loadMessages: vi.fn(async () => []),
  deleteConversation: vi.fn(async () => {}),
  renameConversation: vi.fn(async () => {}),
  createConversation: vi.fn(async () => null),
  conversationTitle: (t: string) => t,
}));
vi.mock("@/lib/actions/register-all", () => ({}));
vi.mock("@/lib/agent/visitor-runtime", () => ({
  sendVisitorMessage: vi.fn(async () => {}),
  abortInFlight: vi.fn(),
  retryVisitorTurn: vi.fn(async () => true),
  visitorGoOn: vi.fn(async () => true),
  canRetryLastTurn: vi.fn(() => true),
}));
vi.mock("@/components/agent/mascot/mascot-sprite", () => ({
  default: () => <div data-testid="mascot-sprite" />,
}));
// The real hooks and views, counted: each one's hooks run as the wrapper's own.
vi.mock("@/lib/agent/mascot/use-panel-focus", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/agent/mascot/use-panel-focus")>();
  return {
    ...real,
    usePanelFocus: (options: Parameters<typeof real.usePanelFocus>[0]) => {
      h.shell++;
      return real.usePanelFocus(options);
    },
  };
});
vi.mock("@/components/agent/mascot/visitor-agent-panel", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("@/components/agent/mascot/visitor-agent-panel")>();
  return {
    ...real,
    default: function CountedVisitorChat(props: Parameters<typeof real.default>[0]) {
      h.chat++;
      return real.default(props);
    },
  };
});
vi.mock("@/components/agent/markdown", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/agent/markdown")>();
  return {
    ...real,
    Markdown: (props: Parameters<typeof real.Markdown>[0]) => {
      h.markdown.set(props.source, (h.markdown.get(props.source) ?? 0) + 1);
      return real.Markdown(props);
    },
  };
});

import { AgentConversation } from "@/components/agent/agent-conversation";
import { MascotAssistant } from "@/components/agent/mascot/mascot-assistant";
import { VISITOR_BODY_LOADING } from "@/components/agent/mascot/lazy-visitor-body";
import {
  VISITOR_AI_CONSENT_KEY,
  VISITOR_AI_CONSENT_VERSION,
} from "@/components/agent/mascot/visitor-ai-consent";
import { useAgentStore } from "@/lib/agent/store";
import { useMascotStore } from "@/lib/agent/mascot/store";
import type { ChatMessage, ContentBlock } from "@/lib/agent/types";

const AT = "2026-11-16T09:00:00Z";
const text = (t: string): ContentBlock => ({ type: "text", text: t });
const message = (id: string, role: ChatMessage["role"], t: string): ChatMessage => ({
  id,
  role,
  content: [text(t)],
  createdAt: AT,
});

const EARLIER = "Start with what went well.";
const CHUNKS = 12;

/** Let the chat's animation frames and effects run. */
const settle = () => act(() => new Promise((r) => setTimeout(r, 40)));

/** A turn under way: an earlier exchange, then the reply streaming in. */
function streamingTurn(profile: "owner" | "visitor") {
  act(() => {
    useAgentStore.setState({
      chatProfile: profile,
      streaming: true,
      streamingMessageId: "a2",
      messages: [
        message("u1", "user", "How do I run a retro?"),
        message("a1", "assistant", EARLIER),
        message("u2", "user", "And then?"),
        message("a2", "assistant", "Pick"),
      ],
    });
  });
}

/**
 * His first words, past the opening sentence, so the reply is drawn from
 * here on (an undecided opener waits in a scribbling balloon: chat-view's
 * `held`).
 */
const FIRST_WORDS = "Pick one. Then";

/** Stream CHUNKS more words into the reply; the reply as it ends. */
function streamChunks(): string {
  let reply = FIRST_WORDS;
  for (let i = 0; i < CHUNKS; i++) {
    reply += ` thing${i}`;
    const next = reply;
    act(() => useAgentStore.getState().patchMessage("a2", [text(next)]));
  }
  return reply;
}

/** Of the strip, the growing reply only, once a chunk; the earlier one never. */
function expectOnlyTheReplyDrawn(reply: string) {
  expect(h.markdown.has(EARLIER)).toBe(false);
  expect(Array.from(h.markdown.values()).reduce((a, b) => a + b, 0)).toBe(CHUNKS);
  expect(h.markdown.get(reply)).toBe(1);
}

describe("a streamed chunk", () => {
  beforeEach(() => {
    // A build with Amr's AI on for visitors, the visitor already agreed.
    vi.stubEnv("NEXT_PUBLIC_VISITOR_AI", "1");
    vi.stubGlobal("fetch", vi.fn());
    // No media query matches. unstubAllGlobals below takes test/setup's
    // matchMedia away too, and the composer reads one (its narrow width).
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    window.localStorage.setItem(VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION);
    useMascotStore.setState({ ready: true });
    useAgentStore.setState({ open: true });
  });

  afterEach(() => {
    useAgentStore.getState().reset();
    useAgentStore.setState({ open: false });
    useMascotStore.setState({ ready: false });
    window.localStorage.removeItem(VISITOR_AI_CONSENT_KEY);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("renders Amr's shell 0 times, the chat's view 0 times, and only the growing reply's markdown", async () => {
    let commits = 0;
    render(
      <Profiler id="amr" onRender={() => commits++}>
        <MascotAssistant />
      </Profiler>
    );
    await screen.findByTestId("mascot-visitor-guide", undefined, { timeout: 5000 });
    await waitFor(() => expect(screen.queryByText(VISITOR_BODY_LOADING)).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Chat with Amr" }));
    await screen.findByRole("button", { name: "Tool finder" });

    streamingTurn("visitor");
    // His first words: he starts talking, a change the shell may show once.
    act(() => useAgentStore.getState().patchMessage("a2", [text(FIRST_WORDS)]));
    await settle();

    const shell = h.shell;
    const chat = h.chat;
    // The counters are on the real shell and view: both have drawn by now.
    expect(shell).toBeGreaterThan(0);
    expect(chat).toBeGreaterThan(0);
    const before = commits;
    h.markdown.clear();
    const reply = streamChunks();

    // Each chunk landed: the log shows the reply as it stands.
    expect(commits - before).toBeGreaterThanOrEqual(CHUNKS);
    expect(screen.getByRole("log", { name: "Conversation" })).toHaveTextContent(reply);
    // Nobody but the strip drew it.
    expect(h.shell - shell).toBe(0);
    expect(h.chat - chat).toBe(0);
    expectOnlyTheReplyDrawn(reply);
  });

  it("in the owner's chat, renders its view 0 times and only the growing reply's markdown", async () => {
    let commits = 0;
    streamingTurn("owner");
    render(
      <Profiler id="owner-chat" onRender={() => commits++}>
        <AgentConversation />
      </Profiler>
    );
    act(() => useAgentStore.getState().patchMessage("a2", [text(FIRST_WORDS)]));
    await settle();

    const owner = h.owner;
    expect(owner).toBeGreaterThan(0);
    const before = commits;
    h.markdown.clear();
    const reply = streamChunks();

    expect(commits - before).toBeGreaterThanOrEqual(CHUNKS);
    expect(screen.getByRole("log", { name: "Conversation" })).toHaveTextContent(reply);
    expect(h.owner - owner).toBe(0);
    expectOnlyTheReplyDrawn(reply);
  });
});
