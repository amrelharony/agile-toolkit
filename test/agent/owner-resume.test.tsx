/**
 * The owner's chat on its first open after a page load
 * (src/components/agent/agent-conversation.tsx, chat/pick-up-chip.tsx): the
 * latest thread is picked up only when its last message is under two hours
 * old; an older one leaves the chat fresh, with a 'Pick up “{title}”' chip
 * under the starters that opens the thread (a way to it, not words for the
 * box). "Now" is moved with a Date subclass, so the result never hangs on
 * when the suite runs.
 *
 * The look for a thread runs once per page load (module state), so each test
 * loads the chat afresh.
 */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, ConversationMeta } from "@/lib/agent/types";

const h = vi.hoisted(() => ({
  list: [] as ConversationMeta[],
  listConversations: null as unknown as () => Promise<{ ok: boolean; data: unknown[] }>,
  loadMessages: null as unknown as (id: string) => Promise<{ ok: boolean; data: unknown[] }>,
}));
vi.mock("@/lib/agent/persist", async () => {
  const { vi: v } = await import("vitest");
  h.listConversations = v.fn(async () => ({ ok: true, data: h.list }));
  h.loadMessages = v.fn(async () => ({ ok: true, data: THREAD_MESSAGES }));
  return {
    listConversations: (...a: []) => h.listConversations(...a),
    loadMessages: (id: string) => h.loadMessages(id),
    createConversation: async () => null,
    appendMessages: async () => {},
    deleteConversation: async () => {},
    renameConversation: async () => {},
    conversationTitle: (t: string) => t,
  };
});
vi.mock("@/lib/agent/client", () => ({
  sendUserMessage: async () => {},
  abortInFlight: () => {},
  generateTitle: async () => null,
  retryLastTurn: async () => true,
  goOn: async () => true,
  canRetryLastTurn: () => false,
}));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuth: () => ({ user: { id: "owner-1" } }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/retro" }));

const THREAD_MESSAGES: ChatMessage[] = [
  {
    id: "u1",
    role: "user",
    content: [{ type: "text", text: "Plan the sprint" }],
    createdAt: "2026-11-16T09:00:00.000Z",
  },
  {
    id: "a1",
    role: "assistant",
    content: [{ type: "text", text: "Planned at 30 points." }],
    createdAt: "2026-11-16T09:00:05.000Z",
  },
];

const RealDate = Date;

/**
 * "Now" moved to `to`, still ticking: new Date() and Date.now() read the real
 * clock plus the offset, and a Date made from a value is a plain one.
 */
function shiftNow(to: Date) {
  const offset = to.getTime() - RealDate.now();
  class Shifted extends RealDate {
    constructor(...args: ConstructorParameters<typeof Date>) {
      super(...((args.length ? args : [RealDate.now() + offset]) as [number]));
    }
    static now() {
      return RealDate.now() + offset;
    }
  }
  globalThis.Date = Shifted as DateConstructor;
}

/** Monday 16 November 2026, 12:00 UTC. */
const NOW = new RealDate("2026-11-16T12:00:00.000Z");
const MIN = 60_000;
const ago = (ms: number) => new RealDate(NOW.getTime() - ms).toISOString();

const thread = (lastMessageAt: string): ConversationMeta => ({
  id: "c1",
  title: "Sprint plan",
  toolId: null,
  createdAt: "2026-11-15T08:00:00.000Z",
  updatedAt: lastMessageAt,
  lastMessageAt,
});

/** The chat, loaded afresh (its look for a thread runs once per load). */
async function loadChat() {
  vi.resetModules();
  const conversation = await import("@/components/agent/agent-conversation");
  const chip = await import("@/components/agent/chat/pick-up-chip");
  const items = await import("@/components/agent/chat/chat-items");
  const { useAgentStore } = await import("@/lib/agent/store");
  const { LiveAnnouncerProvider } = await import("@/components/a11y/live-announcer");
  const { AgentConversation } = conversation;
  const view = render(
    <LiveAnnouncerProvider>
      <AgentConversation />
    </LiveAnnouncerProvider>
  );
  // The look for a thread answers, and the chat settles.
  await act(async () => {});
  await act(async () => {});
  return { ...conversation, ...chip, ...items, useAgentStore, view };
}

const box = () => screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
const pickUpList = () => screen.queryByRole("list", { name: "Your last chat" });
const scenes = () =>
  Array.from(document.querySelectorAll('[data-chat-item="scene"]')).map((s) => s.textContent);

/** The page on a touch screen: (pointer: coarse) matches, nothing else does. */
const touchScreen = () =>
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: query.includes("pointer: coarse"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
      }) as unknown as MediaQueryList
  );

beforeEach(() => {
  // The stand-ins outlive a fresh load: each test counts its own calls.
  if (h.loadMessages) vi.mocked(h.loadMessages).mockClear();
  if (h.listConversations) vi.mocked(h.listConversations).mockClear();
  shiftNow(NOW);
  if (typeof Element.prototype.scrollTo !== "function") {
    Element.prototype.scrollTo = () => {};
  }
});

afterEach(() => {
  globalThis.Date = RealDate;
  vi.restoreAllMocks();
});

describe("resumable", () => {
  it("is true only for a last message under two hours old", async () => {
    const { resumable, RESUME_WITHIN_MS } = await import("@/components/agent/agent-conversation");
    expect(RESUME_WITHIN_MS).toBe(2 * 60 * MIN);
    expect(resumable(thread(ago(5 * MIN)))).toBe(true);
    expect(resumable(thread(ago(2 * 60 * MIN - 1000)))).toBe(true);
    expect(resumable(thread(ago(2 * 60 * MIN)))).toBe(false);
    expect(resumable(thread(ago(26 * 60 * MIN)))).toBe(false);
    // Nothing to go by: offered, never picked up blind.
    expect(resumable(thread("not a time"))).toBe(false);
  });

  it("reads the moved clock, not the real one", async () => {
    const { resumable } = await import("@/components/agent/agent-conversation");
    // Ten minutes before the moved "now", which is weeks from the real one.
    shiftNow(new RealDate("2026-12-31T12:00:00.000Z"));
    expect(resumable(thread("2026-12-31T11:50:00.000Z"))).toBe(true);
    expect(resumable(thread(ago(10 * MIN)))).toBe(false);
  });
});

describe("the owner's first open after a page load", () => {
  it("picks up a thread whose last message is under two hours old, with no chip", async () => {
    h.list = [thread(ago(90 * MIN))];
    const { PICKED_UP, useAgentStore } = await loadChat();
    expect(await screen.findByText("Planned at 30 points.")).toBeInTheDocument();
    expect(scenes()).toContain(PICKED_UP);
    expect(useAgentStore.getState().activeConversationId).toBe("c1");
    expect(pickUpList()).toBeNull();
  });

  it("starts fresh after two hours, offering the thread as Pick up “…” under the starters", async () => {
    h.list = [thread(ago(3 * 60 * MIN))];
    const { pickUpLabel, useAgentStore } = await loadChat();
    expect(h.loadMessages).not.toHaveBeenCalled();
    expect(useAgentStore.getState().activeConversationId).toBeNull();
    // The fresh chat's empty state, then the way back to the older thread.
    const starters = screen.getByRole("list", { name: "Ways to start" });
    const chip = within(pickUpList()!).getByRole("button", { name: pickUpLabel("Sprint plan") });
    expect(chip).toHaveTextContent("Pick up “Sprint plan”");
    expect(starters.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The starters' recipe: outline, 44 px on a touch screen, never a pill.
    expect(chip.className).not.toMatch(/rounded-full|uppercase/);
    expect(scenes()).toEqual([]);
  });

  it("opens the thread when pressed, leaving the draft as it was", async () => {
    h.list = [thread(ago(26 * 60 * MIN))];
    const { pickUpLabel, PICKED_UP, useAgentStore } = await loadChat();
    fireEvent.change(box(), { target: { value: "half typed" } });
    fireEvent.click(screen.getByRole("button", { name: pickUpLabel("Sprint plan") }), {
      detail: 1,
    });
    expect(await screen.findByText("Planned at 30 points.")).toBeInTheDocument();
    expect(h.loadMessages).toHaveBeenCalledWith("c1");
    expect(useAgentStore.getState().activeConversationId).toBe("c1");
    expect(scenes()).toContain(PICKED_UP);
    // A way to a thread, not words for the box.
    expect(box()).toHaveValue("half typed");
    expect(useAgentStore.getState().drafts.owner).toBe("half typed");
    // The chip went with the empty chat; focus went to the box first.
    expect(pickUpList()).toBeNull();
    expect(box()).toHaveFocus();
  });

  it("leaves the box alone after a tap on a touch screen, so no keyboard rises", async () => {
    touchScreen();
    h.list = [thread(ago(26 * 60 * MIN))];
    const { pickUpLabel } = await loadChat();
    fireEvent.click(screen.getByRole("button", { name: pickUpLabel("Sprint plan") }), {
      detail: 1,
    });
    expect(await screen.findByText("Planned at 30 points.")).toBeInTheDocument();
    expect(box()).not.toHaveFocus();
  });

  it("keeps a thread that can't be read shut: the chip stays, with a caption, said once", async () => {
    h.list = [thread(ago(26 * 60 * MIN))];
    const { pickUpLabel, pickUpFailed, useAgentStore } = await loadChat();
    vi.mocked(h.loadMessages).mockResolvedValueOnce({ ok: false, data: [] });
    const chip = screen.getByRole("button", { name: pickUpLabel("Sprint plan") });
    fireEvent.click(chip, { detail: 1 });
    const caption = await screen.findByText(pickUpFailed("Sprint plan"));
    expect(caption.closest('[data-voice="narration"]')).toHaveAttribute("data-tone", "error");
    expect(useAgentStore.getState().activeConversationId).toBeNull();
    expect(chip).toBeInTheDocument();
    expect(chip).not.toHaveAttribute("aria-busy");
    await waitFor(() =>
      expect(screen.getByTestId("live-assertive")).toHaveTextContent(pickUpFailed("Sprint plan"))
    );

    // Pressed again, it tries again.
    fireEvent.click(chip, { detail: 1 });
    expect(await screen.findByText("Planned at 30 points.")).toBeInTheDocument();
  });

  it("reads once while busy: a second press loads nothing twice", async () => {
    h.list = [thread(ago(26 * 60 * MIN))];
    const { pickUpLabel } = await loadChat();
    let answer: (v: { ok: boolean; data: unknown[] }) => void = () => {};
    vi.mocked(h.loadMessages).mockImplementationOnce(
      () => new Promise((resolve) => (answer = resolve))
    );
    const chip = screen.getByRole("button", { name: pickUpLabel("Sprint plan") });
    fireEvent.click(chip, { detail: 1 });
    expect(chip).toHaveAttribute("aria-busy", "true");
    fireEvent.click(chip, { detail: 1 });
    expect(h.loadMessages).toHaveBeenCalledTimes(1);
    await act(async () => answer({ ok: true, data: THREAD_MESSAGES }));
    expect(screen.getByText("Planned at 30 points.")).toBeInTheDocument();
  });

  it("stops offering it once the chat starts on something else, even after a New chat", async () => {
    h.list = [thread(ago(26 * 60 * MIN))];
    const { useAgentStore } = await loadChat();
    expect(pickUpList()).not.toBeNull();
    act(() =>
      useAgentStore.getState().appendMessage({
        id: "m1",
        role: "user",
        content: [{ type: "text", text: "Something new" }],
        createdAt: NOW.toISOString(),
      })
    );
    expect(pickUpList()).toBeNull();
    act(() => useAgentStore.getState().reset());
    expect(screen.getByRole("list", { name: "Ways to start" })).toBeInTheDocument();
    expect(pickUpList()).toBeNull();
  });

  it("opens nothing over a chat the owner started while the thread loaded", async () => {
    h.list = [thread(ago(26 * 60 * MIN))];
    const { pickUpLabel, useAgentStore } = await loadChat();
    let answer: (v: { ok: boolean; data: unknown[] }) => void = () => {};
    vi.mocked(h.loadMessages).mockImplementationOnce(
      () => new Promise((resolve) => (answer = resolve))
    );
    fireEvent.click(screen.getByRole("button", { name: pickUpLabel("Sprint plan") }), {
      detail: 1,
    });
    act(() =>
      useAgentStore.getState().appendMessage({
        id: "m1",
        role: "user",
        content: [{ type: "text", text: "Something new" }],
        createdAt: NOW.toISOString(),
      })
    );
    await act(async () => answer({ ok: true, data: THREAD_MESSAGES }));
    expect(useAgentStore.getState().activeConversationId).toBeNull();
    expect(screen.queryByText("Planned at 30 points.")).toBeNull();
  });
});
