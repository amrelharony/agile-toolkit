import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ConversationMeta } from "@/lib/agent/types";

/**
 * The owner's agent panel on a touch screen (mobile audit 2026-11-08):
 * conversation row actions show without hover, are 44 px on touch, and
 * Delete offers Undo before anything leaves for Supabase; the composer's
 * keyboard hints hide on coarse pointers.
 */

const h = vi.hoisted(() => ({
  conversations: [] as ConversationMeta[],
  deleteConversation: vi.fn<(id: string) => Promise<void>>(async () => {}),
  toast: Object.assign(
    vi.fn<(label: unknown, opts?: unknown) => string>(() => "toast-1"),
    { dismiss: vi.fn() }
  ),
}));

vi.mock("@/lib/agent/persist", () => ({
  listConversations: vi.fn(async () => h.conversations),
  loadMessages: vi.fn(async () => []),
  deleteConversation: h.deleteConversation,
  renameConversation: vi.fn(async () => {}),
  createConversation: vi.fn(async () => null),
  conversationTitle: (t: string) => t,
  conversationToMarkdown: () => "",
  titleSlug: () => "thread",
}));
vi.mock("@/lib/auth/supabase-browser", () => ({ getAuthBrowserClient: () => null }));
vi.mock("@/lib/utils/toast", () => ({ toast: h.toast }));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuth: () => ({ user: { id: "owner-1" } }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/sprint" }));
vi.mock("@/lib/agent/client", () => ({
  sendUserMessage: vi.fn(),
  abortInFlight: vi.fn(),
  generateTitle: vi.fn(async () => null),
}));

import { ConversationList, DELETE_UNDO_MS } from "@/components/agent/conversation-list";
import { AgentConversation } from "@/components/agent/agent-conversation";
import { useAgentStore } from "@/lib/agent/store";

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

const rowOf = (title: string) => screen.getByText(title).closest("div") as HTMLElement;

describe("ConversationList on touch", () => {
  beforeEach(() => {
    h.conversations = THREADS;
    h.deleteConversation.mockClear();
    h.toast.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    useAgentStore.getState().reset();
  });

  it("shows Export, Rename and Delete without hover on coarse pointers, at 44 px", async () => {
    await renderList();
    for (const name of ["Export conversation", "Rename conversation", "Delete conversation"]) {
      const button = within(rowOf("Velocity question")).getByRole("button", { name });
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
      within(rowOf("Backlog grooming notes")).getByRole("button", { name: "Delete conversation" })
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

  it("Undo puts the thread back in its place and never deletes it", async () => {
    await renderList();
    vi.useFakeTimers();

    fireEvent.click(
      within(rowOf("Backlog grooming notes")).getByRole("button", { name: "Delete conversation" })
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
      within(rowOf("Velocity question")).getByRole("button", { name: "Delete conversation" })
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
      within(rowOf("Sprint 42 retro prep")).getByRole("button", { name: "Delete conversation" })
    );
    expect(useAgentStore.getState().activeConversationId).toBeNull();
    expect(useAgentStore.getState().messages).toEqual([]);

    clickUndo();
    expect(useAgentStore.getState().activeConversationId).toBe("c1");
    expect(useAgentStore.getState().messages).toEqual(messages);
  });

  it("makes the rename Save and Cancel buttons 44 px on touch", async () => {
    await renderList();
    fireEvent.click(
      within(rowOf("Velocity question")).getByRole("button", { name: "Rename conversation" })
    );
    expect(screen.getByRole("button", { name: "Save name" })).toHaveClass("min-touch-coarse");
    expect(screen.getByRole("button", { name: "Cancel rename" })).toHaveClass("min-touch-coarse");
    // 16 px on touch, so iOS doesn't zoom the page when the field focuses.
    expect(screen.getByRole("textbox", { name: "Rename conversation" })).toHaveClass(
      "pointer-coarse:text-base"
    );
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
    const hint = screen.getByText(/Enter to send · Shift\+Enter for newline/);
    expect(hint).toHaveClass("pointer-coarse:hidden");
    const note = screen.getByText(/Write actions ask for confirmation/);
    expect(note).not.toHaveClass("pointer-coarse:hidden");
    expect(note).toContainElement(hint);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Message" })).toHaveFocus());
  });
});
