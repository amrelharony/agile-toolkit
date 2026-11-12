import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ConfirmPrompt, ConversationMeta } from "@/lib/agent/types";

/**
 * Escape and Ctrl/Cmd+J belong to Amr's panel only when they are meant for it
 * (design §1.3 item 10; audit escape-handling, critic2-4,
 * shortcut-and-header-polish). Escape goes in one order, wherever the panel
 * takes it:
 *   0. an input method composing keeps it;
 *   1. a field that used it keeps it (the tool finder's search clears,
 *      History's rename cancels);
 *   2. a waiting card is denied;
 *   3. History goes back to the chat;
 *   4. the panel closes.
 * Every step the panel takes calls preventDefault (fireEvent returns false).
 * Outside the panel it answers only with nothing focused or on Amr; a page
 * field's Escape stays the page's. Ctrl/Cmd+J closes the panel from anywhere
 * inside it, its composer too, except History's rename field.
 */

const h = vi.hoisted(() => ({
  auth: null as { status: string; user: { id: string } | null } | null,
  conversations: [] as ConversationMeta[],
}));

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuthOptional: () => h.auth,
  useAuth: () => ({ user: h.auth?.user ?? null }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/retro" }));
vi.mock("@/lib/agent/client", () => ({
  abortInFlight: vi.fn(),
  sendUserMessage: vi.fn(async () => {}),
  generateTitle: vi.fn(async () => null),
  retryLastTurn: vi.fn(async () => true),
  goOn: vi.fn(async () => true),
  canRetryLastTurn: vi.fn(() => false),
}));
vi.mock("@/lib/agent/persist", () => ({
  listConversations: vi.fn(async () => h.conversations),
  loadMessages: vi.fn(async () => []),
  deleteConversation: vi.fn(async () => {}),
  renameConversation: vi.fn(async () => {}),
  createConversation: vi.fn(async () => null),
  conversationTitle: (t: string) => t,
  conversationToMarkdown: () => "",
  titleSlug: () => "thread",
}));
// History is the real list (its rename field is under test); no realtime.
vi.mock("@/lib/auth/supabase-browser", () => ({ getAuthBrowserClient: () => null }));
vi.mock("@/lib/actions/register-all", () => ({}));
vi.mock("@/components/agent/mascot/mascot-sprite", () => ({
  default: () => <div data-testid="mascot-sprite" />,
}));
vi.mock("@/components/agent/mascot/rate-limit-bar", () => ({ RateLimitBar: () => null }));

// Loaded here, so the owner's chunk is ready when the panel opens.
import "@/components/agent/mascot/owner-agent-panel";
import { MascotAssistant } from "@/components/agent/mascot/mascot-assistant";
import { VISITOR_BODY_LOADING } from "@/components/agent/mascot/lazy-visitor-body";
import { AMR_PANEL_ID } from "@/components/agent/mascot/panel-ids";
import { useAgentStore } from "@/lib/agent/store";

const OWNER = { status: "authenticated", user: { id: "owner-1" } };
const VISITOR = { status: "anonymous", user: null };

const ADD: ConfirmPrompt = {
  verb: "Add card",
  title: "Retro Board",
  question: "Add a card to Retro Board?",
  detail: "Text: “flaky CI”",
  destructive: false,
};

const amr = () => screen.getByRole("button", { name: "Ask Amr" });
const plate = () => screen.getByRole("heading", { name: "Amr" });
const dialog = () => screen.queryByRole("dialog", { name: "Amr" });
const isOpen = () => useAgentStore.getState().open;

/** Escape on `el`; true when nothing prevented it (fireEvent's own return). */
const escape = (el: Element | Document, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(el, { key: "Escape", ...init });
/** Ctrl+J (or Cmd+J with `meta`) on `el`; true when nothing prevented it. */
const ctrlJ = (el: Element | Document, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(el, { key: "j", ctrlKey: true, ...init });

/**
 * A change waiting for the OK. Like the client's, its resolver settles once
 * and takes the card away; the answers it got are returned.
 */
function cardWaits(): boolean[] {
  const answers: boolean[] = [];
  let settled = false;
  act(() => {
    useAgentStore.getState().setPendingToolUse({
      toolUseId: "c1",
      actionId: "tool_retro_add_card",
      resolvedActionId: "tool.retro.add_card",
      input: {},
      prompt: ADD,
      resolve: (approved) => {
        if (settled) return;
        settled = true;
        answers.push(approved);
        useAgentStore.getState().setPendingToolUse(null);
      },
    });
  });
  return answers;
}

/** A mouse on Amr opens the panel (a fine pointer: jsdom's matchMedia matches nothing). */
async function openOwnerChat(): Promise<HTMLElement> {
  h.auth = OWNER;
  render(<MascotAssistant />);
  fireEvent.click(amr(), { detail: 1 });
  const box = await screen.findByLabelText("Message");
  await waitFor(() => expect(box).toHaveFocus());
  return box;
}

async function openHistory(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Conversation history" }));
  await screen.findByRole("button", { name: "Back to chat" });
}

async function openToolFinder(): Promise<void> {
  h.auth = VISITOR;
  render(<MascotAssistant />);
  fireEvent.click(amr(), { detail: 0 });
  await waitFor(() => expect(screen.queryByText(VISITOR_BODY_LOADING)).toBeNull());
  await screen.findByTestId("mascot-visitor-guide");
}

/** A field on the tool page, outside the panel. */
function pageField(): HTMLInputElement {
  const field = document.createElement("input");
  field.setAttribute("aria-label", "Page field");
  document.body.appendChild(field);
  return field;
}

beforeEach(() => {
  // jsdom has no scrolling; the owner's chat scrolls its log.
  if (typeof Element.prototype.scrollTo !== "function") {
    Element.prototype.scrollTo = () => {};
  }
  h.auth = VISITOR;
  h.conversations = [
    {
      id: "t1",
      title: "Sprint plan",
      toolId: null,
      createdAt: "2026-11-10T09:00:00Z",
      updatedAt: "2026-11-10T09:00:00Z",
      lastMessageAt: "2026-11-10T09:00:00Z",
    },
  ];
  useAgentStore.getState().reset();
  useAgentStore.getState().closeSheet();
});

afterEach(() => {
  cleanup();
  useAgentStore.getState().reset();
  useAgentStore.getState().closeSheet();
  document.body.replaceChildren();
});

describe("Escape, in order", () => {
  it("is left to an input method that is composing", async () => {
    const box = await openOwnerChat();
    const answers = cardWaits();
    expect(escape(box, { isComposing: true })).toBe(true);
    // Older browsers say "composing" with keyCode 229 instead.
    expect(escape(box, { keyCode: 229 })).toBe(true);
    expect(answers).toEqual([]);
    expect(isOpen()).toBe(true);
  });

  it("clears the tool finder's search first, then closes the panel", async () => {
    await openToolFinder();
    const search = screen.getByLabelText("What do you need to do?");
    fireEvent.change(search, { target: { value: "retro" } });

    expect(escape(search)).toBe(false);
    expect(search).toHaveValue("");
    expect(isOpen()).toBe(true);
    expect(dialog()).toBeInTheDocument();

    expect(escape(search)).toBe(false);
    expect(isOpen()).toBe(false);
    expect(dialog()).toBeNull();
  });

  it("denies a waiting card before anything else, and the panel stays open", async () => {
    const box = await openOwnerChat();
    const answers = cardWaits();
    expect(screen.getByRole("group", { name: ADD.question })).toBeInTheDocument();

    expect(escape(box)).toBe(false);
    expect(answers).toEqual([false]);
    expect(screen.queryByRole("group", { name: ADD.question })).toBeNull();
    expect(isOpen()).toBe(true);

    // The card has gone: the next Escape closes.
    expect(escape(box)).toBe(false);
    expect(isOpen()).toBe(false);
  });

  it("in History denies the card, then goes back to the chat, then closes, one step a key", async () => {
    await openOwnerChat();
    await openHistory();
    const row = await screen.findByRole("button", { name: /Sprint plan/ });
    row.focus();
    const answers = cardWaits();

    // 2. The card, though History hides it.
    expect(escape(row)).toBe(false);
    expect(answers).toEqual([false]);
    expect(screen.getByRole("button", { name: "Back to chat" })).toBeInTheDocument();
    expect(isOpen()).toBe(true);

    // 3. Back to the chat, focus on History's own button, never on the page.
    expect(escape(row)).toBe(false);
    const history = screen.getByRole("button", { name: "Conversation history" });
    expect(history).toHaveFocus();
    expect(await screen.findByLabelText("Message")).toBeInTheDocument();
    expect(isOpen()).toBe(true);

    // 4. Closed.
    expect(escape(history)).toBe(false);
    expect(isOpen()).toBe(false);
    expect(dialog()).toBeNull();
  });

  it("in History's rename field with a card waiting cancels only the rename", async () => {
    await openOwnerChat();
    await openHistory();
    fireEvent.click(await screen.findByRole("button", { name: "Rename conversation" }));
    const field = screen.getByRole("textbox", { name: "Rename conversation" });
    expect(field).toHaveAttribute("data-agent-rename");
    fireEvent.change(field, { target: { value: "Sprint plan v2" } });
    const answers = cardWaits();

    // The field keeps its Escape (it prevents it), and nothing else moves.
    expect(escape(field)).toBe(false);
    expect(screen.queryByRole("textbox", { name: "Rename conversation" })).toBeNull();
    expect(screen.getByRole("button", { name: /Sprint plan/ })).toBeInTheDocument();
    expect(answers).toEqual([]);
    expect(screen.getByRole("button", { name: "Back to chat" })).toBeInTheDocument();
    expect(isOpen()).toBe(true);

    // The next Escape is the panel's again: the card first.
    expect(escape(document.activeElement ?? document.body)).toBe(false);
    expect(answers).toEqual([false]);
    expect(isOpen()).toBe(true);
  });

  it("leaves an input method's Escape in the rename field to it", async () => {
    await openOwnerChat();
    await openHistory();
    fireEvent.click(await screen.findByRole("button", { name: "Rename conversation" }));
    const field = screen.getByRole("textbox", { name: "Rename conversation" });
    expect(escape(field, { isComposing: true })).toBe(true);
    expect(screen.getByRole("textbox", { name: "Rename conversation" })).toBeInTheDocument();
    expect(isOpen()).toBe(true);
  });

  it("no longer stops on History's Rename buttons: Escape there goes back to the chat", async () => {
    await openOwnerChat();
    await openHistory();
    const pencil = await screen.findByRole("button", { name: "Rename conversation" });
    pencil.focus();
    expect(escape(pencil)).toBe(false);
    expect(screen.getByRole("button", { name: "Conversation history" })).toHaveFocus();
    expect(isOpen()).toBe(true);
  });

  it("closes the panel last, from the plate", async () => {
    await openToolFinder();
    expect(plate()).toHaveFocus();
    expect(escape(plate())).toBe(false);
    expect(isOpen()).toBe(false);
  });

  it("in the header's More menu closes only the menu, then takes its usual order", async () => {
    // Everyone's panel has the menu: Move Amr is its first group.
    await openToolFinder();
    // Held: while the menu is open the rest of the page is out of the
    // accessibility tree.
    const more = screen.getByRole("button", { name: "More" });
    fireEvent.keyDown(more, { key: "Enter" });
    const item = screen.getByRole("menuitemradio", { name: "Top left" });
    await waitFor(() => expect(item).toHaveFocus());
    const answers = cardWaits();

    // 1. The menu's own: it shuts, prevents the default, and nothing else moves.
    expect(escape(item)).toBe(false);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(answers).toEqual([]);
    expect(isOpen()).toBe(true);
    await waitFor(() => expect(more).toHaveFocus());

    // 2. Then the card, and 4. the panel.
    expect(escape(more)).toBe(false);
    expect(answers).toEqual([false]);
    expect(isOpen()).toBe(true);
    expect(escape(more)).toBe(false);
    expect(isOpen()).toBe(false);
  });
});

describe("Escape outside the panel", () => {
  it("is the panel's with nothing focused, and on Amr himself", async () => {
    await openOwnerChat();
    const answers = cardWaits();
    expect(escape(document.body)).toBe(false);
    expect(answers).toEqual([false]);
    expect(isOpen()).toBe(true);

    amr().focus();
    expect(escape(amr())).toBe(false);
    expect(isOpen()).toBe(false);
    // Focus stays on Amr, where it was.
    expect(amr()).toHaveFocus();
  });

  it("is the panel's on the header's opener, which names it in aria-controls", async () => {
    await openOwnerChat();
    const opener = document.createElement("button");
    opener.textContent = "Open agent chat";
    opener.setAttribute("aria-controls", AMR_PANEL_ID);
    document.body.appendChild(opener);
    opener.focus();
    expect(escape(opener)).toBe(false);
    expect(isOpen()).toBe(false);
  });

  it("stays a page field's: the card keeps waiting and the panel stays open", async () => {
    await openOwnerChat();
    const field = pageField();
    field.focus();
    const answers = cardWaits();
    expect(escape(field)).toBe(true);
    expect(answers).toEqual([]);
    expect(isOpen()).toBe(true);
  });

  it("is a page's own once the panel is closed", async () => {
    h.auth = VISITOR;
    render(<MascotAssistant />);
    expect(escape(document.body)).toBe(true);
    expect(isOpen()).toBe(false);
  });
});

describe("Ctrl/Cmd+J", () => {
  it("closes the panel from its composer, keeping the browser's own Ctrl+J away", async () => {
    const box = await openOwnerChat();
    expect(ctrlJ(box)).toBe(false);
    expect(isOpen()).toBe(false);
    expect(dialog()).toBeNull();
  });

  it("closes it with Cmd+J from History's search too", async () => {
    h.conversations = ["a", "b", "c", "d"].map((id) => ({
      id,
      title: `Thread ${id}`,
      toolId: null,
      createdAt: "2026-11-10T09:00:00Z",
      updatedAt: "2026-11-10T09:00:00Z",
      lastMessageAt: "2026-11-10T09:00:00Z",
    }));
    await openOwnerChat();
    await openHistory();
    const search = await screen.findByLabelText("Search conversations");
    expect(fireEvent.keyDown(search, { key: "J", metaKey: true })).toBe(false);
    expect(isOpen()).toBe(false);
  });

  it("leaves History's rename field alone, so a name being typed isn't lost", async () => {
    await openOwnerChat();
    await openHistory();
    fireEvent.click(await screen.findByRole("button", { name: "Rename conversation" }));
    const field = screen.getByRole("textbox", { name: "Rename conversation" });
    fireEvent.change(field, { target: { value: "Sprint plan v2" } });

    expect(ctrlJ(field)).toBe(true);
    expect(fireEvent.keyDown(field, { key: "j", metaKey: true })).toBe(true);
    expect(isOpen()).toBe(true);
    expect(screen.getByRole("textbox", { name: "Rename conversation" })).toHaveValue(
      "Sprint plan v2"
    );
  });

  it("is an input method's while it composes", async () => {
    const box = await openOwnerChat();
    expect(ctrlJ(box, { isComposing: true })).toBe(true);
    expect(ctrlJ(box, { keyCode: 229 })).toBe(true);
    expect(isOpen()).toBe(true);
  });

  it("still leaves a field on the page alone, open or closed", async () => {
    const box = await openOwnerChat();
    const field = pageField();
    field.focus();
    expect(ctrlJ(field)).toBe(true);
    expect(isOpen()).toBe(true);

    expect(ctrlJ(box)).toBe(false);
    expect(isOpen()).toBe(false);
    field.focus();
    expect(ctrlJ(field)).toBe(true);
    expect(isOpen()).toBe(false);
  });

  it("toggles once when held down", async () => {
    const box = await openOwnerChat();
    expect(ctrlJ(box, { repeat: true })).toBe(false);
    expect(isOpen()).toBe(true);
  });
});
