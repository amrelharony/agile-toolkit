import { useState } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ConversationMeta } from "@/lib/agent/types";

/**
 * The owner's agent panel on a touch screen (mobile audit 2026-11-08):
 * conversation row actions show without hover, are 44 px on touch, and
 * Delete offers Undo before anything leaves for Supabase; the composer's
 * keyboard hints hide on coarse pointers, its box stays editable while Amr
 * answers, and it takes focus on a touch screen only where a tap means "let
 * me type" (New chat). A chat whose conversation couldn't be made says "Not
 * saved yet", and what it said is saved once a later message makes one.
 */

const h = vi.hoisted(() => ({
  conversations: [] as ConversationMeta[],
  deleteConversation: vi.fn<(id: string) => Promise<void>>(async () => {}),
  createConversation: vi.fn<(opts: unknown) => Promise<ConversationMeta | null>>(async () => null),
  appendMessages: vi.fn<(conversationId: string, msgs: unknown[]) => Promise<void>>(async () => {}),
  sendUserMessage: vi.fn<(text: string, opts: unknown) => Promise<void>>(async () => {}),
  retryLastTurn: vi.fn<(opts: unknown) => Promise<boolean>>(async () => true),
  goOn: vi.fn<(opts: unknown) => Promise<boolean>>(async () => true),
  canRetryLastTurn: vi.fn<(messages: unknown) => boolean>(() => true),
  abortInFlight: vi.fn(),
  toast: Object.assign(
    vi.fn<(label: unknown, opts?: unknown) => string>(() => "toast-1"),
    { dismiss: vi.fn(), error: vi.fn() }
  ),
}));

vi.mock("@/lib/agent/persist", () => ({
  listConversations: vi.fn(async () => ({ ok: true, data: h.conversations })),
  loadMessages: vi.fn(async () => ({ ok: true, data: [] })),
  deleteConversation: h.deleteConversation,
  renameConversation: vi.fn(async () => {}),
  createConversation: h.createConversation,
  appendMessages: h.appendMessages,
  conversationTitle: (t: string) => t,
  conversationToMarkdown: () => "",
  titleSlug: () => "thread",
}));
vi.mock("@/lib/auth/supabase-browser", () => ({ getAuthBrowserClient: () => null }));
vi.mock("@/lib/utils/toast", () => ({ toast: h.toast }));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuth: () => ({ user: { id: "owner-1" } }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/sprint" }));
vi.mock("@/lib/agent/client", () => ({
  sendUserMessage: h.sendUserMessage,
  abortInFlight: h.abortInFlight,
  generateTitle: vi.fn(async () => null),
  retryLastTurn: h.retryLastTurn,
  goOn: h.goOn,
  canRetryLastTurn: h.canRetryLastTurn,
}));

import { ConversationList, DELETE_UNDO_MS, rowAction } from "@/components/agent/conversation-list";
import {
  AgentConversation,
  NOT_SAVED,
  NOT_SAVED_LABEL,
} from "@/components/agent/agent-conversation";
import { ChatVisibleContext } from "@/components/agent/chat-visibility";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { useAgentStore } from "@/lib/agent/store";
import { listConversations, loadMessages, renameConversation } from "@/lib/agent/persist";
import { generateTitle } from "@/lib/agent/client";
import { KEY_HINT, STOP_LABEL } from "@/components/agent/chat/chat-composer";
import { DANCE_NOTE } from "@/components/agent/mascot/engine/customization/chat-commands";

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

const meta = (id: string, title: string): ConversationMeta => ({
  id,
  title,
  toolId: null,
  createdAt: "2026-11-08T09:00:00Z",
  updatedAt: "2026-11-08T09:00:00Z",
  lastMessageAt: "2026-11-08T09:00:00Z",
});

const THREADS = [
  meta("c1", "Sprint 42 retro prep"),
  meta("c2", "Backlog grooming notes"),
  meta("c3", "Velocity question"),
];

/** The Undo button of the last toast raised. */
function clickUndo() {
  const opts = h.toast.mock.calls.at(-1)?.[1] as { action: { onClick: () => void } };
  act(() => opts.action.onClick());
}

async function renderList() {
  render(<ConversationList onClose={() => {}} />);
  await screen.findByText("Sprint 42 retro prep");
}

/** A thread's row: its list item. */
const rowOf = (title: string) => screen.getByText(title).closest("li") as HTMLElement;

describe("ConversationList on touch", () => {
  beforeEach(() => {
    h.conversations = THREADS;
    h.deleteConversation.mockReset();
    h.deleteConversation.mockImplementation(async (id) => {
      h.conversations = h.conversations.filter((c) => c.id !== id);
    });
    h.toast.mockClear();
    h.toast.dismiss.mockClear();
    h.toast.error.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    useAgentStore.getState().reset();
  });

  it("shows Export, Rename and Delete without hover on coarse pointers, at 44 px", async () => {
    await renderList();
    for (const verb of ["Export", "Rename", "Delete"] as const) {
      const button = within(rowOf("Velocity question")).getByRole("button", {
        name: rowAction(verb, "Velocity question"),
      });
      // Hidden until hover with a mouse, as before…
      expect(button).toHaveClass("opacity-0", "group-hover:opacity-100");
      // …but visible on touch and whenever the row has keyboard focus.
      expect(button).toHaveClass(
        "pointer-coarse:opacity-100",
        "group-focus-within:opacity-100",
        "focus-visible:opacity-100"
      );
      // 44 x 44 on touch only; the desktop size stays p-1.
      expect(button).toHaveClass("min-touch-coarse", "p-1");
    }
  });

  it("hides a deleted thread at once and deletes it only when Undo has gone", async () => {
    await renderList();
    vi.useFakeTimers();

    fireEvent.click(
      within(rowOf("Backlog grooming notes")).getByRole("button", {
        name: rowAction("Delete", "Backlog grooming notes"),
      })
    );

    expect(screen.queryByText("Backlog grooming notes")).toBeNull();
    expect(h.toast).toHaveBeenCalledWith(
      "Deleted “Backlog grooming notes”",
      expect.objectContaining({ action: expect.objectContaining({ label: "Undo" }) })
    );
    // Nothing reaches Supabase while Undo is on offer.
    act(() => vi.advanceTimersByTime(DELETE_UNDO_MS - 1));
    expect(h.deleteConversation).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(h.deleteConversation).toHaveBeenCalledWith("c2");
  });

  it("closes the Undo toast before the delete goes out", async () => {
    await renderList();
    vi.useFakeTimers();

    fireEvent.click(
      within(rowOf("Backlog grooming notes")).getByRole("button", {
        name: rowAction("Delete", "Backlog grooming notes"),
      })
    );
    expect(h.toast.dismiss).not.toHaveBeenCalled();

    // Sonner pauses its toast while hovered or tapped; this clock doesn't, so
    // the toast is closed here rather than left offering a dead Undo.
    act(() => vi.advanceTimersByTime(DELETE_UNDO_MS));
    expect(h.toast.dismiss).toHaveBeenCalledWith("toast-1");
    expect(h.deleteConversation).toHaveBeenCalledWith("c2");
    expect(h.toast.dismiss.mock.invocationCallOrder[0]).toBeLessThan(
      h.deleteConversation.mock.invocationCallOrder[0]
    );
  });

  it("says it is too late when Undo lands after the delete went out", async () => {
    useAgentStore.getState().setActiveConversation(THREADS[1], []);
    await renderList();
    vi.useFakeTimers();

    fireEvent.click(
      within(rowOf("Backlog grooming notes")).getByRole("button", {
        name: rowAction("Delete", "Backlog grooming notes"),
      })
    );
    act(() => vi.advanceTimersByTime(DELETE_UNDO_MS + 1000));
    clickUndo();

    expect(h.toast.error).toHaveBeenCalledWith(expect.stringMatching(/too late to undo/i));
    expect(screen.queryByText("Backlog grooming notes")).toBeNull();
    // The deleted thread is not reopened.
    expect(useAgentStore.getState().activeConversationId).toBeNull();
  });

  it("shows the thread again when Supabase kept it", async () => {
    // supabase-js reports a refused delete as { error } rather than throwing,
    // so deleteConversation resolves and the thread is still there.
    h.deleteConversation.mockImplementationOnce(async () => {});
    await renderList();
    vi.useFakeTimers();

    fireEvent.click(
      within(rowOf("Backlog grooming notes")).getByRole("button", {
        name: rowAction("Delete", "Backlog grooming notes"),
      })
    );
    expect(screen.queryByText("Backlog grooming notes")).toBeNull();
    act(() => vi.advanceTimersByTime(DELETE_UNDO_MS));
    expect(h.deleteConversation).toHaveBeenCalledWith("c2");
    vi.useRealTimers();

    expect(await screen.findByText("Backlog grooming notes")).toBeInTheDocument();
  });

  it("stays gone after a delete that went through", async () => {
    await renderList();
    const reads = vi.mocked(listConversations).mock.calls.length;
    vi.useFakeTimers();

    fireEvent.click(
      within(rowOf("Backlog grooming notes")).getByRole("button", {
        name: rowAction("Delete", "Backlog grooming notes"),
      })
    );
    act(() => vi.advanceTimersByTime(DELETE_UNDO_MS));
    vi.useRealTimers();

    // The list re-reads once the delete has landed, and the thread isn't in it.
    await waitFor(() =>
      expect(vi.mocked(listConversations).mock.calls.length).toBeGreaterThan(reads)
    );
    await act(async () => {});
    expect(screen.getByText("Sprint 42 retro prep")).toBeInTheDocument();
    expect(screen.queryByText("Backlog grooming notes")).toBeNull();
  });

  it("deletes at once and closes the Undo toast when the page is hidden", async () => {
    await renderList();
    vi.useFakeTimers();

    fireEvent.click(
      within(rowOf("Backlog grooming notes")).getByRole("button", {
        name: rowAction("Delete", "Backlog grooming notes"),
      })
    );
    // Phones fire visibilitychange before swiping an app away or killing the
    // tab, often with no pagehide after it.
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    try {
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
    } finally {
      visibility.mockRestore();
    }

    expect(h.toast.dismiss).toHaveBeenCalledWith("toast-1");
    expect(h.deleteConversation).toHaveBeenCalledWith("c2");
    // Coming back to the page doesn't delete it twice.
    act(() => vi.advanceTimersByTime(DELETE_UNDO_MS));
    expect(h.deleteConversation).toHaveBeenCalledTimes(1);
  });

  it("Undo puts the thread back in its place and never deletes it", async () => {
    await renderList();
    vi.useFakeTimers();

    fireEvent.click(
      within(rowOf("Backlog grooming notes")).getByRole("button", {
        name: rowAction("Delete", "Backlog grooming notes"),
      })
    );
    clickUndo();

    const titles = screen.getAllByTitle(/./).map((el) => el.getAttribute("title"));
    expect(titles).toEqual(THREADS.map((t) => t.title));
    act(() => vi.advanceTimersByTime(DELETE_UNDO_MS * 2));
    expect(h.deleteConversation).not.toHaveBeenCalled();
  });

  it("keeps a thread pending deletion hidden when the list is reopened", async () => {
    const first = render(<ConversationList onClose={() => {}} />);
    await screen.findByText("Velocity question");
    vi.useFakeTimers();
    fireEvent.click(
      within(rowOf("Velocity question")).getByRole("button", {
        name: rowAction("Delete", "Velocity question"),
      })
    );
    first.unmount();
    vi.useRealTimers();

    render(<ConversationList onClose={() => {}} />);
    await screen.findByText("Sprint 42 retro prep");
    expect(screen.queryByText("Velocity question")).toBeNull();

    // Undo from the toast still brings it back in the reopened list.
    clickUndo();
    expect(await screen.findByText("Velocity question")).toBeInTheDocument();
  });

  it("closes the open thread on Delete and reopens it on Undo", async () => {
    const messages = [
      { id: "m1", role: "user" as const, content: [], createdAt: "2026-11-08T09:00:00Z" },
    ];
    useAgentStore.getState().setActiveConversation(THREADS[0], messages);
    await renderList();
    vi.useFakeTimers();

    fireEvent.click(
      within(rowOf("Sprint 42 retro prep")).getByRole("button", {
        name: rowAction("Delete", "Sprint 42 retro prep"),
      })
    );
    expect(useAgentStore.getState().activeConversationId).toBeNull();
    expect(useAgentStore.getState().messages).toEqual([]);

    clickUndo();
    expect(useAgentStore.getState().activeConversationId).toBe("c1");
    expect(useAgentStore.getState().messages).toEqual(messages);
  });

  /** Delete the open thread from its row, then tap Undo. */
  async function deleteThenUndo() {
    await renderList();
    vi.useFakeTimers();
    fireEvent.click(
      within(rowOf("Sprint 42 retro prep")).getByRole("button", {
        name: rowAction("Delete", "Sprint 42 retro prep"),
      })
    );
    expect(useAgentStore.getState().activeConversationId).toBeNull();
    clickUndo();
    expect(useAgentStore.getState().activeConversationId).toBe("c1");
  }

  it("puts a thread started here back on Undo as it was, never as a picked-up one", async () => {
    const messages = [
      { id: "m1", role: "user" as const, content: [], createdAt: "2026-11-08T09:00:00Z" },
    ];
    // Started in this chat: saved on its first message, nothing picked up.
    useAgentStore.setState({ messages, resumedAfter: null });
    expect(useAgentStore.getState().attachConversation(THREADS[0])).toBe(true);

    await deleteThenUndo();
    // Undone, not picked up: no "Picking up where you left off" after it.
    expect(useAgentStore.getState().messages).toEqual(messages);
    expect(useAgentStore.getState().resumedAfter).toBeNull();
  });

  it("keeps where a picked-up thread left off through Delete and Undo", async () => {
    const at = "2026-11-08T09:00:00Z";
    useAgentStore
      .getState()
      .setActiveConversation(THREADS[0], [{ id: "m1", role: "user", content: [], createdAt: at }]);
    // Picked up after m1; the owner has written on since.
    useAgentStore.getState().appendMessage({ id: "m2", role: "user", content: [], createdAt: at });
    expect(useAgentStore.getState().resumedAfter).toBe("m1");

    await deleteThenUndo();
    expect(useAgentStore.getState().messages.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(useAgentStore.getState().resumedAfter).toBe("m1");
  });

  it("makes the rename Save and Cancel buttons 44 px on touch", async () => {
    await renderList();
    fireEvent.click(
      within(rowOf("Velocity question")).getByRole("button", {
        name: rowAction("Rename", "Velocity question"),
      })
    );
    expect(screen.getByRole("button", { name: "Save name" })).toHaveClass("min-touch-coarse");
    expect(screen.getByRole("button", { name: "Cancel rename" })).toHaveClass("min-touch-coarse");
    // 16 px on touch, so iOS doesn't zoom the page when the field focuses.
    expect(
      screen.getByRole("textbox", { name: rowAction("Rename", "Velocity question") })
    ).toHaveClass("pointer-coarse:text-base");
  });

  it("renames the open thread in the panel header too, and no other thread there", async () => {
    useAgentStore.getState().setActiveConversation(THREADS[2], []);
    await renderList();
    const rename = (title: string, to: string) => {
      fireEvent.click(
        within(rowOf(title)).getByRole("button", { name: rowAction("Rename", title) })
      );
      fireEvent.change(screen.getByRole("textbox", { name: rowAction("Rename", title) }), {
        target: { value: to },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    };

    rename("Backlog grooming notes", "Grooming");
    await waitFor(() =>
      expect(vi.mocked(renameConversation)).toHaveBeenCalledWith("c2", "Grooming")
    );
    expect(useAgentStore.getState().activeMeta?.title).toBe("Velocity question");

    rename("Velocity question", "  Velocity, explained ");
    await waitFor(() =>
      expect(useAgentStore.getState().activeMeta?.title).toBe("Velocity, explained")
    );
    expect(useAgentStore.getState().activeMeta?.id).toBe("c3");
  });
});

describe("AgentConversation composer hints", () => {
  beforeEach(() => {
    h.conversations = [];
    if (typeof Element.prototype.scrollTo !== "function") {
      Element.prototype.scrollTo = () => {};
    }
  });

  afterEach(() => {
    useAgentStore.getState().reset();
  });

  it("hides the keyboard hints on coarse pointers and keeps the safety note", async () => {
    render(<AgentConversation />);
    const hint = screen.getByText(KEY_HINT, { exact: false });
    expect(hint).toHaveTextContent("Enter to send · Shift+Enter for a new line");
    expect(hint).toHaveClass("pointer-coarse:hidden");
    const note = screen.getByText(/Amr asks before deleting or resetting anything/);
    expect(note).not.toHaveClass("pointer-coarse:hidden");
    expect(note).toContainElement(hint);
    // The old claim was false: most writes inside a tool run without a card.
    expect(screen.queryByText(/Write actions ask for confirmation/)).toBeNull();
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Message" })).toHaveFocus());
  });

  it("leaves focus alone when the chat opens on a touch screen, so no keyboard rises", async () => {
    touchScreen();
    render(<AgentConversation />);
    await act(async () => {});
    expect(screen.getByRole("textbox", { name: "Message" })).not.toHaveFocus();
    expect(document.body).toHaveFocus();
    vi.restoreAllMocks();
  });

  it("puts focus in the fresh chat's box after History's New chat, even on a touch screen", async () => {
    touchScreen();
    h.conversations = THREADS;
    useAgentStore.getState().setActiveConversation(THREADS[0], [userMsg("m1", "hi")]);
    useAgentStore.getState().setDraft("owner", "half typed");
    function OwnerChat() {
      const [history, setHistory] = useState(true);
      return history ? (
        <ConversationList onClose={() => setHistory(false)} />
      ) : (
        <AgentConversation />
      );
    }
    render(<OwnerChat />);
    await screen.findByText("Sprint 42 retro prep");
    fireEvent.click(screen.getByRole("button", { name: "New chat" }), { detail: 1 });
    const box = await screen.findByRole("textbox", { name: "Message" });
    expect(box).toHaveFocus();
    expect(box).toHaveValue("");
    expect(useAgentStore.getState().messages).toEqual([]);
    vi.restoreAllMocks();
  });
});

describe("AgentConversation hidden under Amr's scenes", () => {
  // jsdom has no element scrollTo: the chat may still scroll after a test, so a no-op stays.
  const original = Element.prototype.scrollTo ?? (() => {});
  const scrollTo = vi.fn();

  beforeEach(() => {
    h.conversations = [];
    Element.prototype.scrollTo = scrollTo;
    scrollTo.mockClear();
  });

  afterEach(() => {
    Element.prototype.scrollTo = original;
    useAgentStore.getState().reset();
  });

  const chat = (visible: boolean) => (
    <ChatVisibleContext.Provider value={visible}>
      <AgentConversation />
    </ChatVisibleContext.Provider>
  );

  it("focuses the composer and scrolls to the latest message once it shows again", async () => {
    // Mounted under the scenes (History to Scenes): it can't focus or scroll yet.
    const { rerender } = render(chat(false));
    const composer = screen.getByRole("textbox", { name: "Message" });
    // jsdom has no layout: the log holds 1000 px in a 200 px view, so a pin
    // to its end has somewhere to go.
    const log = screen.getByRole("log", { name: "Conversation" });
    Object.defineProperty(log, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(log, "clientHeight", { configurable: true, value: 200 });
    act(() =>
      useAgentStore.getState().appendMessage({
        id: "m1",
        role: "assistant",
        content: [{ type: "text", text: "Sprint 47 is set up." }],
        createdAt: "2026-11-16T08:00:00Z",
      })
    );
    // The frame the log's writes wait for has run, and wrote nothing.
    await act(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    );
    expect(composer).not.toHaveFocus();
    expect(scrollTo).not.toHaveBeenCalled();

    rerender(chat(true));
    await waitFor(() => expect(composer).toHaveFocus());
    // The chat frame follows the log from its newest line again.
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 800, behavior: "instant" }));
  });
});

describe("AgentConversation: the comic strip", () => {
  beforeEach(() => {
    h.conversations = [];
    h.goOn.mockClear();
  });

  afterEach(() => {
    useAgentStore.getState().reset();
  });

  const AT = "2026-11-08T09:00:00Z";
  const box = () => screen.getByRole("textbox", { name: "Message" });

  it("draws the owner's chat in a quiet log: balloons on Amr's side, captions, steps in words with Details", () => {
    useAgentStore.setState({
      messages: [
        {
          id: "u1",
          role: "user",
          content: [{ type: "text", text: "Add flaky CI to my retro" }],
          createdAt: AT,
        },
        {
          id: "a1",
          role: "assistant",
          content: [
            { type: "text", text: "On it." },
            {
              type: "tool_use",
              id: "c1",
              name: "tool_retro_add_card",
              input: { text: "flaky CI" },
            },
          ],
          createdAt: AT,
        },
        {
          id: "t1",
          role: "tool",
          content: [{ type: "tool_result", tool_use_id: "c1", content: '{"added":true}' }],
          createdAt: AT,
        },
        {
          id: "a2",
          role: "assistant",
          content: [{ type: "text", text: "Done: it is on the board." }],
          createdAt: AT,
        },
      ],
    });
    render(<AgentConversation />);
    const log = screen.getByRole("log", { name: "Conversation" });
    expect(log).toHaveAttribute("aria-live", "off");
    // The frame is the log's direct parent: one column that scrolls in a short panel.
    expect(log.parentElement).toHaveClass("h-full", "min-h-0", "flex-col", "overflow-y-auto");
    expect(log.parentElement).toHaveAttribute("data-amr-scroll");
    // Its padding is inside that scroller, which clips at its padding box: the
    // composer row keeps 12 px from each edge, so focus rings (High contrast's
    // reach 5 px out) are never cut off.
    expect(log.parentElement).toHaveAttribute("data-chat-frame");
    expect(log.parentElement).toHaveClass("px-3", "py-2");
    // The composer's form sits straight in the frame's shrink-0 footer.
    expect(box().closest("form")?.parentElement).toHaveClass("shrink-0");
    expect(box().closest("form")?.parentElement?.parentElement).toBe(log.parentElement);

    const kinds = Array.from(log.querySelectorAll("[data-chat-item]")).map((el) =>
      el.getAttribute("data-chat-item")
    );
    expect(kinds).toEqual(["you", "balloon", "steps", "balloon"]);
    const caption = log.querySelector('[data-chat-item="you"] .comic-caption');
    expect(caption).toHaveAttribute("data-voice", "you");
    expect(caption).toHaveTextContent("You said: Add flaky CI to my retro");
    for (const balloon of Array.from(log.querySelectorAll(".balloon"))) {
      expect(balloon).toHaveAttribute("data-tail", "amr");
      expect(balloon.textContent).toMatch(/^Amr said: /);
    }
    // The step in words, Details for the owner, and no JSON in the caption's line.
    const step = log.querySelector('[data-chat-item="steps"] [data-tool-step]')!;
    expect(step.querySelector("p")).toHaveTextContent("Retro Board · Add card · Done · “flaky CI”");
    expect(step.querySelector("p")?.textContent).not.toMatch(/[{}]|tool_retro/);
    expect(within(step as HTMLElement).getByText("Details")).toBeInTheDocument();
  });

  it("shows Amr thinking as a wordless balloon in the log, said by a status line outside it", () => {
    useAgentStore.setState({ streaming: true, messages: [userMsg("u1", "plan it")] });
    render(<AgentConversation />);
    const log = screen.getByRole("log", { name: "Conversation" });
    const thinking = log.querySelector('[data-thinking=""]');
    expect(thinking).toHaveAttribute("aria-hidden", "true");
    expect(thinking?.textContent).toBe("");
    const status = screen.getByText("Amr is thinking…");
    expect(status).toHaveAttribute("role", "status");
    expect(log.contains(status)).toBe(false);

    act(() => {
      useAgentStore.getState().appendMessage({
        id: "a1",
        role: "assistant",
        content: [{ type: "text", text: "Here is a plan." }],
        createdAt: AT,
      });
    });
    expect(log.querySelector("[data-thinking]")).toBeNull();
    // The same status line says the next phase, and empties when the turn is over.
    expect(status).toHaveTextContent("Amr is writing…");
    act(() => useAgentStore.getState().setStreaming(false));
    expect(status).toBeInTheDocument();
    expect(status).toBeEmptyDOMElement();
  });

  it("Go on hands focus to the message box with the caret after the draft", () => {
    useAgentStore.getState().setActiveConversation(THREADS[0], [userMsg("m1", "plan it")]);
    useAgentStore.getState().setDraft("owner", "and the retro");
    useAgentStore.getState().setNotice({
      tone: "note",
      kind: "cut_off",
      text: "Amr's answer was cut short. Ask him to go on.",
    });
    render(<AgentConversation />);
    fireEvent.click(screen.getByRole("button", { name: "Go on" }));
    expect(box()).toHaveFocus();
    expect((box() as HTMLTextAreaElement).selectionStart).toBe("and the retro".length);
  });
});

/** A turn under way, as the client registers it: its abort is with the store. */
function liveTurn() {
  const abortTurn = vi.fn();
  useAgentStore.setState({ streaming: true });
  useAgentStore.getState().setAbortTurn(abortTurn);
  return abortTurn;
}

const userMsg = (id: string, text: string) => ({
  id,
  role: "user" as const,
  content: [{ type: "text" as const, text }],
  createdAt: "2026-11-08T09:00:00Z",
});

describe("ConversationList and the answer under way", () => {
  beforeEach(() => {
    h.conversations = THREADS;
    vi.mocked(loadMessages).mockClear();
  });

  afterEach(() => {
    useAgentStore.getState().setAbortTurn(null);
    useAgentStore.getState().reset();
  });

  it("opening another thread stops the answer through the store before the thread loads", async () => {
    useAgentStore.getState().setActiveConversation(THREADS[0], [userMsg("m1", "hi")]);
    const abortTurn = liveTurn();
    const onClose = vi.fn();
    render(<ConversationList onClose={onClose} />);
    await screen.findByText("Velocity question");

    fireEvent.click(screen.getByTitle("Velocity question"));
    expect(abortTurn).toHaveBeenCalledTimes(1);
    expect(abortTurn).toHaveBeenCalledWith("thread");
    expect(abortTurn.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(loadMessages).mock.invocationCallOrder[0]
    );
    await waitFor(() => expect(useAgentStore.getState().activeConversationId).toBe("c3"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opening the open thread goes back to it as it is, answer and all", async () => {
    const messages = [userMsg("m1", "hi")];
    useAgentStore.getState().setActiveConversation(THREADS[0], messages);
    const abortTurn = liveTurn();
    const onClose = vi.fn();
    render(<ConversationList onClose={onClose} />);
    await screen.findByText("Sprint 42 retro prep");

    fireEvent.click(screen.getByTitle("Sprint 42 retro prep"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(abortTurn).not.toHaveBeenCalled();
    expect(loadMessages).not.toHaveBeenCalled();
    expect(useAgentStore.getState().messages).toBe(messages);
    expect(useAgentStore.getState().streaming).toBe(true);
  });

  it("deleting the open thread stops its answer through the store", async () => {
    useAgentStore.getState().setActiveConversation(THREADS[0], [userMsg("m1", "hi")]);
    const abortTurn = liveTurn();
    await renderList();

    fireEvent.click(
      within(rowOf("Sprint 42 retro prep")).getByRole("button", {
        name: rowAction("Delete", "Sprint 42 retro prep"),
      })
    );
    expect(abortTurn).toHaveBeenCalledTimes(1);
    expect(abortTurn).toHaveBeenCalledWith("reset");
    expect(useAgentStore.getState().streaming).toBe(false);
    // Undo, so the thread isn't left pending deletion for the next test.
    clickUndo();
  });

  it("deleting another thread leaves the answer alone", async () => {
    useAgentStore.getState().setActiveConversation(THREADS[0], [userMsg("m1", "hi")]);
    const abortTurn = liveTurn();
    await renderList();

    fireEvent.click(
      within(rowOf("Velocity question")).getByRole("button", {
        name: rowAction("Delete", "Velocity question"),
      })
    );
    expect(abortTurn).not.toHaveBeenCalled();
    expect(useAgentStore.getState().streaming).toBe(true);
    clickUndo();
  });

  it("New chat stops the answer through the store", async () => {
    useAgentStore.getState().setActiveConversation(THREADS[0], [userMsg("m1", "hi")]);
    const abortTurn = liveTurn();
    await renderList();

    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    expect(abortTurn).toHaveBeenCalledWith("reset");
    expect(useAgentStore.getState().messages).toEqual([]);
  });
});

describe("AgentConversation: notices, the draft and a new thread", () => {
  beforeEach(() => {
    h.conversations = [];
    h.sendUserMessage.mockClear();
    h.retryLastTurn.mockClear();
    h.goOn.mockClear();
    h.canRetryLastTurn.mockReset();
    h.canRetryLastTurn.mockReturnValue(true);
    h.createConversation.mockReset();
    h.createConversation.mockResolvedValue(null);
    h.appendMessages.mockClear();
    h.deleteConversation.mockReset();
    if (typeof Element.prototype.scrollTo !== "function") {
      Element.prototype.scrollTo = () => {};
    }
  });

  afterEach(() => {
    useAgentStore.getState().reset();
  });

  const box = () => screen.getByRole("textbox", { name: "Message" });

  it("asks Amr, not the agent", () => {
    render(<AgentConversation />);
    expect(box()).toHaveAttribute("placeholder", "Ask Amr…");
  });

  it("shows a note as a narration caption, with Go on sending the owner's own Go on", () => {
    useAgentStore.getState().setActiveConversation(THREADS[0], [userMsg("m1", "plan it")]);
    useAgentStore.getState().setNotice({
      tone: "note",
      kind: "cut_off",
      text: "Amr's answer was cut short. Ask him to go on.",
    });
    render(<AgentConversation />);
    const caption = screen
      .getByText("Amr's answer was cut short. Ask him to go on.")
      .closest('[data-voice="narration"]');
    expect(caption).toHaveAttribute("data-tone", "note");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Go on" }));
    expect(h.goOn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "owner-1", conversationId: "c1" })
    );
    expect(box()).toHaveFocus();
  });

  it("offers Go on when every tool round was used", () => {
    useAgentStore.getState().setNotice({
      tone: "note",
      kind: "round_limit",
      text: "Amr reached his limit of 10 tool rounds for one request. Send a follow-up and he'll carry on.",
    });
    render(<AgentConversation />);
    expect(screen.getByRole("button", { name: "Go on" })).toBeInTheDocument();
  });

  it("shows an error with the danger line, and Try again only when the last turn may run again", () => {
    useAgentStore.getState().setActiveConversation(THREADS[0], [userMsg("m1", "plan it")]);
    h.canRetryLastTurn.mockReturnValue(false);
    useAgentStore.getState().setNotice({
      tone: "error",
      kind: "upstream_error",
      text: "Amr's AI service hit an error. Try again in a moment.",
    });
    const view = render(<AgentConversation />);
    const caption = screen
      .getByText("Amr's AI service hit an error. Try again in a moment.")
      .closest('[data-voice="narration"]');
    expect(caption).toHaveAttribute("data-tone", "error");
    expect(document.querySelector('[class*="bg-destructive/10"]')).toBeNull();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    view.unmount();

    h.canRetryLastTurn.mockReturnValue(true);
    render(<AgentConversation />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(h.retryLastTurn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "owner-1", conversationId: "c1" })
    );
    expect(screen.queryByRole("button", { name: "Go on" })).toBeNull();
  });

  it("offers nothing to press when asking again won't help", () => {
    useAgentStore.getState().setNotice({
      tone: "error",
      kind: "signed_out",
      text: "Amr couldn't confirm it's you. Sign out and back in, then try again.",
    });
    render(<AgentConversation />);
    expect(screen.getByText(/couldn't confirm it's you/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Go on" })).toBeNull();
  });

  it("stays editable while Amr answers: only sending waits, and the one button stops the answer", () => {
    useAgentStore.setState({ streaming: true });
    h.abortInFlight.mockClear();
    render(<AgentConversation />);
    box().focus();
    expect(box()).not.toBeDisabled();
    expect(box()).not.toHaveAttribute("readonly");
    // The next message can be drafted while the answer comes in.
    fireEvent.change(box(), { target: { value: "and then the review" } });
    expect(useAgentStore.getState().drafts.owner).toBe("and then the review");
    // Enter sends nothing yet, and the draft stays.
    expect(fireEvent.keyDown(box(), { key: "Enter" })).toBe(false);
    expect(h.sendUserMessage).not.toHaveBeenCalled();
    expect(box()).toHaveValue("and then the review");
    expect(box()).toHaveFocus();
    // Send is Stop for now: never disabled, so focus on it would stay.
    const stop = screen.getByRole("button", { name: STOP_LABEL });
    expect(stop).not.toBeDisabled();
    expect(stop).not.toHaveAttribute("aria-disabled");
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    fireEvent.click(stop);
    expect(h.abortInFlight).toHaveBeenCalledTimes(1);
  });

  it("acts out dance itself: the box empties, a note says so, and nothing goes to Amr's AI", () => {
    render(<AgentConversation />);
    fireEvent.change(box(), { target: { value: "dance" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(box()).toHaveValue("");
    // Inside the status row's polite live span (in a node of its own, so the same words again are said again).
    const note = screen.getByText(DANCE_NOTE).closest("[aria-live]");
    expect(note).toHaveAttribute("aria-live", "polite");
    expect(note).toHaveAttribute("data-composer-note");
    expect(h.createConversation).not.toHaveBeenCalled();
    expect(h.sendUserMessage).not.toHaveBeenCalled();
    // The note goes with the next send.
    fireEvent.change(box(), { target: { value: "/mascot-aura none" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(screen.queryByText(DANCE_NOTE)).toBeNull();
  });

  it("says which tool Amr works in, outside the live note", () => {
    render(<AgentConversation />);
    const on = screen.getByText(/^On /);
    expect(on.closest("[aria-live]")).toBeNull();
  });

  it("keeps the draft when the panel closes and opens again", () => {
    const first = render(<AgentConversation />);
    fireEvent.change(box(), { target: { value: "rename the sprint to" } });
    first.unmount();

    render(<AgentConversation />);
    expect(box()).toHaveValue("rename the sprint to");
    expect(useAgentStore.getState().drafts.owner).toBe("rename the sprint to");
  });

  it("gives the chat its new thread without a switch, and empties the draft", async () => {
    h.createConversation.mockResolvedValue(meta("c9", "Plan the sprint"));
    render(<AgentConversation />);
    fireEvent.change(box(), { target: { value: "Plan the sprint" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(box()).toHaveValue("");
    await waitFor(() => expect(h.sendUserMessage).toHaveBeenCalledTimes(1));
    expect(h.sendUserMessage).toHaveBeenCalledWith(
      "Plan the sprint",
      expect.objectContaining({ userId: "owner-1", conversationId: "c9" })
    );
    expect(useAgentStore.getState().activeConversationId).toBe("c9");
    expect(h.deleteConversation).not.toHaveBeenCalled();
  });

  it("gives the new thread's short title to the panel header too, once the first answer is in", async () => {
    h.createConversation.mockResolvedValue(meta("c9", "Plan the sprint at 30 points please"));
    vi.mocked(generateTitle).mockResolvedValueOnce("Sprint Planning");
    vi.mocked(renameConversation).mockClear();
    render(<AgentConversation />);
    fireEvent.change(box(), { target: { value: "Plan the sprint at 30 points please" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(h.sendUserMessage).toHaveBeenCalledTimes(1));
    expect(useAgentStore.getState().activeMeta?.title).toBe("Plan the sprint at 30 points please");

    // The turn the (mocked) client would run: the question, an answer, then it settles.
    act(() => {
      useAgentStore.getState().appendMessage(userMsg("u1", "Plan the sprint at 30 points please"));
      useAgentStore.getState().setStreaming(true);
    });
    act(() => {
      useAgentStore.getState().appendMessage({
        id: "a1",
        role: "assistant",
        content: [{ type: "text", text: "Here is the plan." }],
        createdAt: "2026-11-08T09:01:00Z",
      });
      useAgentStore.getState().setStreaming(false);
    });

    await waitFor(() => expect(useAgentStore.getState().activeMeta?.title).toBe("Sprint Planning"));
    expect(renameConversation).toHaveBeenCalledWith("c9", "Sprint Planning");
  });

  it("sends nothing when another thread opened while the new one was being made", async () => {
    let made: (m: ConversationMeta) => void = () => {};
    h.createConversation.mockImplementation(
      () => new Promise<ConversationMeta>((resolve) => (made = resolve))
    );
    render(<AgentConversation />);
    fireEvent.change(box(), { target: { value: "Plan the sprint" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(h.createConversation).toHaveBeenCalledTimes(1));

    act(() => useAgentStore.getState().setActiveConversation(THREADS[1], [userMsg("o1", "hi")]));
    await act(async () => made(meta("c9", "Plan the sprint")));

    expect(h.sendUserMessage).not.toHaveBeenCalled();
    expect(useAgentStore.getState().activeConversationId).toBe("c2");
    // The question goes back in the box, and the empty thread made for it goes.
    expect(box()).toHaveValue("Plan the sprint");
    expect(h.deleteConversation).toHaveBeenCalledWith("c9");
  });

  it("sends nothing when New chat emptied the chat the new thread was made for", async () => {
    let made: (m: ConversationMeta | null) => void = () => {};
    h.createConversation.mockImplementation(
      () => new Promise<ConversationMeta | null>((resolve) => (made = resolve))
    );
    // A chat with no saved thread yet (an earlier create failed).
    useAgentStore.getState().appendMessage(userMsg("m1", "earlier"));
    render(<AgentConversation />);
    fireEvent.change(box(), { target: { value: "and then?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(h.createConversation).toHaveBeenCalledTimes(1));

    act(() => useAgentStore.getState().reset());
    await act(async () => made(null));

    expect(h.sendUserMessage).not.toHaveBeenCalled();
    expect(useAgentStore.getState().messages).toEqual([]);
    expect(box()).toHaveValue("and then?");
  });

  describe("a chat that couldn't be saved", () => {
    const said = (id: string, text: string, createdAt: string) => ({
      id,
      role: "assistant" as const,
      content: [{ type: "text" as const, text }],
      createdAt,
    });
    const unsavedCaption = () => document.querySelector<HTMLElement>("[data-chat-unsaved]");

    /** The first question sent with no conversation made, and the (mocked) client's turn for it. */
    async function sendUnsaved() {
      render(
        <LiveAnnouncerProvider>
          <AgentConversation />
        </LiveAnnouncerProvider>
      );
      fireEvent.change(box(), { target: { value: "Plan the sprint" } });
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      await waitFor(() => expect(h.sendUserMessage).toHaveBeenCalledTimes(1));
      expect(h.sendUserMessage).toHaveBeenCalledWith(
        "Plan the sprint",
        expect.objectContaining({ conversationId: undefined })
      );
      act(() => {
        useAgentStore.getState().appendMessage({
          ...userMsg("u1", "Plan the sprint"),
          createdAt: "2026-11-08T09:00:00Z",
        });
        useAgentStore.getState().appendMessage(said("a1", "Planned.", "2026-11-08T09:00:05Z"));
      });
    }

    it("says so in a narration caption, once by the announcer, and nothing while it is saved", async () => {
      await sendUnsaved();
      const caption = unsavedCaption()!;
      expect(caption).toHaveAttribute("data-voice", "narration");
      expect(caption).toHaveTextContent(`${NOT_SAVED_LABEL} ${NOT_SAVED}`);
      // Third person, no dashes.
      expect(caption.textContent).not.toMatch(/\b(I|I'm|I'll|I've|me|my)\b|[–—]/);
      // In the log, which is never live; the announcer says it once.
      expect(caption.closest('[role="log"]')).not.toBeNull();
      expect(caption.closest('[aria-live="polite"], [aria-live="assertive"]')).toBeNull();
      await waitFor(() =>
        expect(screen.getByTestId("live-polite")).toHaveTextContent(NOT_SAVED_LABEL)
      );
    });

    it("saves what came before once the next message makes a conversation, then says nothing", async () => {
      await sendUnsaved();
      h.createConversation.mockResolvedValue(meta("c9", "Plan the sprint"));
      fireEvent.change(box(), { target: { value: "and the review" } });
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      await waitFor(() => expect(h.sendUserMessage).toHaveBeenCalledTimes(2));

      // Named for the chat's first question, not this one.
      expect(h.createConversation).toHaveBeenLastCalledWith(
        expect.objectContaining({ title: "Plan the sprint" })
      );
      // The earlier messages go into the new conversation, in order, times kept.
      expect(h.appendMessages).toHaveBeenCalledTimes(1);
      const [id, back] = h.appendMessages.mock.calls[0];
      expect(id).toBe("c9");
      expect(back).toEqual([
        expect.objectContaining({ id: "u1", createdAt: "2026-11-08T09:00:00Z" }),
        expect.objectContaining({ id: "a1", createdAt: "2026-11-08T09:00:05Z" }),
      ]);
      // This message goes with its turn, into the same conversation.
      expect(h.sendUserMessage).toHaveBeenLastCalledWith(
        "and the review",
        expect.objectContaining({ conversationId: "c9" })
      );
      expect(useAgentStore.getState().activeConversationId).toBe("c9");
      expect(unsavedCaption()).toBeNull();
    });

    it("never saves a reply the wire wouldn't take", async () => {
      useAgentStore.getState().appendMessage(userMsg("u1", "Plan it"));
      useAgentStore.getState().appendMessage({
        id: "a0",
        role: "assistant",
        content: [{ type: "tool_use", id: "t1", name: "tool_x", input: { _partial: '{"na' } }],
        createdAt: "2026-11-08T09:00:01Z",
      });
      useAgentStore.getState().appendMessage(said("a1", "Done.", "2026-11-08T09:00:02Z"));
      h.createConversation.mockResolvedValue(meta("c9", "Plan it"));
      render(<AgentConversation />);
      expect(unsavedCaption()).not.toBeNull();
      fireEvent.change(box(), { target: { value: "next" } });
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      await waitFor(() => expect(h.sendUserMessage).toHaveBeenCalledTimes(1));
      expect(h.appendMessages.mock.calls[0][1]).toEqual([
        expect.objectContaining({ id: "u1" }),
        expect.objectContaining({ id: "a1" }),
      ]);
    });

    it("saves nothing twice from a fresh chat: its first message goes with its turn", async () => {
      h.createConversation.mockResolvedValue(meta("c9", "Plan the sprint"));
      render(<AgentConversation />);
      fireEvent.change(box(), { target: { value: "Plan the sprint" } });
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      await waitFor(() => expect(h.sendUserMessage).toHaveBeenCalledTimes(1));
      expect(h.appendMessages).not.toHaveBeenCalled();
      expect(unsavedCaption()).toBeNull();
    });
  });
});
