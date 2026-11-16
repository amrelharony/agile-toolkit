/**
 * A visitor's chat without the strip kit on its first paint (Amr chat revamp,
 * size pass): the parts that draw messages (chat/strip-kit) come with the
 * runtime on the first message (mascot/visitor-chat-runtime), not in the
 * chat's own chunk. Before the first send the chat draws only what needs no
 * kit: the empty line and starters, then the thinking balloon and "Amr is
 * thinking…" while the runtime loads. The kit is in the log's holder before
 * the question reaches the store, so the question and the reply draw as they
 * always did.
 *
 * Nothing here imports the kit statically: the holder is per module graph,
 * so each test imports a fresh chat, store and holder, with the runtime
 * mocked behind a gate the test opens by hand. (The runtime failing to load
 * is test/agent/visitor-runtime-load.test.tsx.)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MAX_STARTERS } from "@/components/agent/chat/chat-empty";
import { resolvePageTool, toolIdForPath } from "@/lib/agent/page-tool";
import type { ChatMessage } from "@/lib/agent/types";
import { VISITOR_EMPTY, visitorStarters } from "@/lib/agent/visitor-starters";

const h = vi.hoisted(() => ({
  gate: Promise.resolve(),
  open: () => {},
  /** The fresh graph's holder, read inside the mocked send. */
  currentKit: (): unknown => null,
  /** What the holder held when each send began. */
  kitAtSend: [] as unknown[],
  sendVisitorMessage: vi.fn<(text: string, opts: { toolId: string | null }) => Promise<void>>(),
}));

vi.mock("next/navigation", () => ({ usePathname: () => "/retro" }));

/** The runtime, as a factory that loads once its gate opens. */
async function gatedRuntime() {
  await h.gate;
  return {
    sendVisitorMessage: h.sendVisitorMessage,
    abortInFlight: vi.fn(),
    retryVisitorTurn: vi.fn(async () => true),
    visitorGoOn: vi.fn(async () => true),
    canRetryLastTurn: vi.fn(() => false),
  };
}

type Chat = typeof import("@/components/agent/mascot/visitor-agent-panel").default;
type Store = typeof import("@/lib/agent/store").useAgentStore;
type Holder = typeof import("@/components/agent/chat/strip-kit-ref");

let VisitorAgentPanel: Chat;
let useAgentStore: Store;
let holder: Holder;

const AT = "2026-11-16T09:00:00Z";
const QUESTION = "How do I run a retro?";
const REPLY = "Open the board, then add a card.";

const user = (id: string, text: string): ChatMessage => ({
  id,
  role: "user",
  content: [{ type: "text", text }],
  createdAt: AT,
});
const assistant = (id: string, text: string): ChatMessage => ({
  id,
  role: "assistant",
  content: [{ type: "text", text }],
  createdAt: AT,
});

/** How long a fresh module graph may take to load the runtime and the kit. */
const LOAD = { timeout: 5000 };

/** Let effects, microtasks and timers queued by the last step run. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

const items = (kind: string) =>
  document.querySelectorAll<HTMLElement>(`[data-chat-item="${kind}"]`);

function ask(text: string) {
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
}

beforeEach(async () => {
  h.kitAtSend = [];
  h.sendVisitorMessage.mockReset();
  h.sendVisitorMessage.mockImplementation(async (text) => {
    h.kitAtSend.push(h.currentKit());
    useAgentStore.setState({
      chatProfile: "visitor",
      messages: [user("u1", text), assistant("a1", REPLY)],
    });
  });
  h.gate = new Promise<void>((resolve) => {
    h.open = resolve;
  });
  vi.resetModules();
  vi.doMock("@/lib/agent/visitor-runtime", gatedRuntime);
  VisitorAgentPanel = (await import("@/components/agent/mascot/visitor-agent-panel")).default;
  holder = await import("@/components/agent/chat/strip-kit-ref");
  h.currentKit = holder.currentStripKit;
  useAgentStore = (await import("@/lib/agent/store")).useAgentStore;
  useAgentStore.getState().reset();
  useAgentStore.setState({ chatProfile: "visitor", visitorQuota: null });
  useAgentStore.getState().setDraft("visitor", "");
  if (typeof Element.prototype.scrollTo !== "function") Element.prototype.scrollTo = () => {};
});

afterEach(async () => {
  // A test that left the gate shut lets its turn finish here.
  h.open();
  await settle();
  useAgentStore.getState().reset();
  useAgentStore.getState().setDraft("visitor", "");
});

describe("a visitor's chat before its first message", () => {
  it("draws its empty line, its starters and the thinking balloon with no kit", async () => {
    render(<VisitorAgentPanel initialQuestion="" onOfflineGuide={() => {}} />);
    await settle();
    expect(holder.currentStripKit()).toBeNull();

    // The empty chat: its narration line and the page's starters.
    expect(screen.getByText(VISITOR_EMPTY.line)).toBeInTheDocument();
    const starters = within(screen.getByRole("list", { name: "Ways to start" }))
      .getAllByRole("button")
      .map((b) => b.textContent);
    const tool = resolvePageTool(toolIdForPath("/retro"));
    expect(starters).toEqual(visitorStarters(tool, false).slice(0, MAX_STARTERS));
    expect(starters.length).toBeGreaterThan(0);
    expect(document.querySelectorAll("[data-chat-item]")).toHaveLength(0);

    // Sent, with the runtime still loading: Amr is thinking, and still no kit.
    ask(QUESTION);
    await settle();
    expect(h.sendVisitorMessage).not.toHaveBeenCalled();
    expect(holder.currentStripKit()).toBeNull();
    expect(items("thinking")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("Amr is thinking…");
    expect(screen.queryByText(VISITOR_EMPTY.line)).toBeNull();
    expect(useAgentStore.getState().messages).toEqual([]);

    // The runtime arrives, and the kit with it, before the question goes out.
    await act(async () => h.open());
    await waitFor(() => expect(h.sendVisitorMessage).toHaveBeenCalledTimes(1), LOAD);
    expect(h.kitAtSend).toHaveLength(1);
    expect(h.kitAtSend[0]).not.toBeNull();
    expect(holder.currentStripKit()).toBe(h.kitAtSend[0]);
  });

  it("has the kit in before the question goes out, and draws the reply as a balloon", async () => {
    h.open();
    render(<VisitorAgentPanel initialQuestion="" onOfflineGuide={() => {}} />);
    await settle();
    expect(holder.currentStripKit()).toBeNull();

    ask(QUESTION);
    await waitFor(() => expect(h.sendVisitorMessage).toHaveBeenCalledTimes(1), LOAD);
    // Inside the send, before any message reached the store, the kit was in.
    const { STRIP_KIT } = await import("@/components/agent/chat/strip-kit");
    expect(h.kitAtSend).toEqual([STRIP_KIT]);
    expect(holder.currentStripKit()).toBe(STRIP_KIT);

    await settle();
    const [question] = Array.from(items("you"));
    expect(question).toHaveTextContent(QUESTION);
    const [balloon] = Array.from(items("balloon"));
    expect(balloon).toHaveTextContent(REPLY);
    expect(balloon).toHaveAttribute("data-message-id", "a1");
    expect(items("thinking")).toHaveLength(0);
  });

  it("loads the kit should a message ever show up without it", async () => {
    h.open();
    useAgentStore.setState({ messages: [user("u1", QUESTION), assistant("a1", REPLY)] });
    render(<VisitorAgentPanel initialQuestion="" onOfflineGuide={() => {}} />);
    // Not drawn blank for good: the guard loads the runtime, and the kit with it.
    await waitFor(() => expect(holder.currentStripKit()).not.toBeNull(), LOAD);
    await waitFor(() => expect(items("balloon")).toHaveLength(1));
    expect(items("balloon")[0]).toHaveTextContent(REPLY);
    expect(h.sendVisitorMessage).not.toHaveBeenCalled();
  });
});
