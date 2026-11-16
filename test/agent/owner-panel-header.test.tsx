/**
 * What the owner's chat puts in the panel header (owner-agent-panel.tsx into
 * panel-chrome's slots): New chat and History in the actions slot, before the
 * shell's Close; under the name plate, the open thread's title or "New chat",
 * and "Your chats" in History. In History the History button is "Back to chat"
 * with an arrow: the same button, so focus stays on it when History opens,
 * with a dot while a confirm card waits in the chat behind it.
 *
 * The chat, History's list and the usage bar are markers here; the shell keeps
 * whether History shows, as MascotAssistant does.
 */

import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ConversationMeta, PendingToolUse } from "@/lib/agent/types";

// The panel fills the action registry; the header doesn't need it.
vi.mock("@/lib/actions/register-all", () => ({}));
vi.mock("@/components/agent/agent-conversation", () => ({
  AgentConversation: () => <div data-testid="agent-conversation" />,
}));
vi.mock("@/components/agent/conversation-list", () => ({
  ConversationList: () => <div data-testid="conversation-list" />,
}));
vi.mock("@/components/agent/mascot/rate-limit-bar", () => ({
  RateLimitBar: () => <div data-testid="rate-limit-bar" />,
}));
const focusAfterNewChat = vi.hoisted(() => vi.fn());
vi.mock("@/components/agent/chat/chat-composer", () => ({
  focusComposerAfterNewChat: focusAfterNewChat,
}));

import OwnerAgentPanel, { CARD_WAITING_NOTE } from "@/components/agent/mascot/owner-agent-panel";
import { PanelHeader } from "@/components/agent/mascot/panel-header";
import { PANEL_SUBTITLE, PanelChrome } from "@/components/agent/mascot/panel-chrome";
import { useAgentStore } from "@/lib/agent/store";

const THREAD: ConversationMeta = {
  id: "c1",
  title: "Sprint 47 planning",
  toolId: null,
  createdAt: "2026-11-12T08:00:00Z",
  updatedAt: "2026-11-12T08:00:00Z",
  lastMessageAt: "2026-11-12T08:00:00Z",
};

const CARD: PendingToolUse = {
  toolUseId: "t1",
  actionId: "workspace_sprint_create",
  resolvedActionId: "workspace.sprint.create",
  input: {},
  prompt: {
    verb: "Create sprint",
    title: "Workspace",
    question: "Create a sprint?",
    detail: "",
    destructive: false,
  },
  resolve: () => {},
};

/** The shell around the owner's chat: the header, and whether History shows. */
function Shell() {
  const [showHistory, setShowHistory] = useState(false);
  return (
    <PanelChrome>
      <PanelHeader subtitle={PANEL_SUBTITLE.owner} onClose={() => {}} />
      <OwnerAgentPanel
        showHistory={showHistory}
        onToggleHistory={() => setShowHistory((v) => !v)}
        onCloseHistory={() => setShowHistory(false)}
      />
    </PanelChrome>
  );
}

const header = () => document.querySelector<HTMLElement>("[data-panel-header]")!;
const slot = (name: string) => header().querySelector<HTMLElement>(`[data-panel-slot="${name}"]`)!;
/** The whole line under the plate: the shell's default or the view's fill. */
const subtitle = () => slot("subtitle").parentElement!.textContent;
const historyButton = () => within(header()).getByRole("button", { name: "Conversation history" });

afterEach(() => {
  useAgentStore.getState().reset();
});

describe("the owner's header actions", () => {
  it("draws New chat and History into the header's actions slot, before Close", () => {
    render(<Shell />);
    const close = within(header()).getByRole("button", { name: "Close assistant" });
    for (const name of ["New chat", "Conversation history"]) {
      const button = within(header()).getByRole("button", { name });
      expect(slot("actions")).toContainElement(button);
      expect(button.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    // Nothing of them is left in the body.
    expect(screen.getAllByRole("button", { name: "New chat" })).toHaveLength(1);
    expect(screen.getByTestId("agent-conversation")).toBeInTheDocument();
  });

  it("New chat empties the chat and leaves History", () => {
    useAgentStore.getState().setActiveConversation(THREAD, []);
    render(<Shell />);
    fireEvent.click(historyButton());
    expect(screen.getByTestId("conversation-list")).toBeInTheDocument();

    focusAfterNewChat.mockClear();
    fireEvent.click(within(header()).getByRole("button", { name: "New chat" }));
    expect(useAgentStore.getState().activeConversationId).toBeNull();
    expect(screen.queryByTestId("conversation-list")).toBeNull();
    expect(screen.getByTestId("agent-conversation")).toBeInTheDocument();
    // The fresh chat's message box takes focus, even on a touch screen
    // (chat-composer.test pins what the call does).
    expect(focusAfterNewChat).toHaveBeenCalledTimes(1);
  });
});

describe("the chat under the header", () => {
  it("leaves its padding to the chat's frame, inside the scroller (agent-panel-touch pins it there)", () => {
    render(<Shell />);
    // Padding out here would sit outside the frame's scroller, which clips the
    // composer's and Send's focus rings at its edges.
    const wrapper = screen.getByTestId("agent-conversation").parentElement!;
    expect(wrapper).toHaveClass("flex", "min-h-0", "flex-1", "flex-col");
    expect(wrapper.className).not.toMatch(/(?:^|\s)p[xy]?-\d/);
  });
});

describe("the owner's subtitle", () => {
  it("says New chat with no thread open, then names the open thread", () => {
    render(<Shell />);
    expect(subtitle()).toBe("New chat");
    // The view fills the slot itself, in place of the shell's default.
    expect(slot("subtitle")).toHaveTextContent(/^New chat$/);

    act(() => useAgentStore.getState().setActiveConversation(THREAD, []));
    expect(slot("subtitle")).toHaveTextContent(/^Sprint 47 planning$/);
    // The line truncates; the whole title shows on hover.
    expect(within(slot("subtitle")).getByText("Sprint 47 planning")).toHaveAttribute(
      "title",
      "Sprint 47 planning"
    );
    expect(subtitle()).toBe("Sprint 47 planning");
  });

  it("follows a rename of the open thread, and goes back to New chat on New chat", () => {
    useAgentStore.getState().setActiveConversation(THREAD, []);
    render(<Shell />);
    act(() => useAgentStore.getState().retitleConversation("c1", "Sprint 47 setup"));
    expect(slot("subtitle")).toHaveTextContent(/^Sprint 47 setup$/);

    fireEvent.click(within(header()).getByRole("button", { name: "New chat" }));
    expect(slot("subtitle")).toHaveTextContent(/^New chat$/);
  });

  it("says New chat for a thread with a blank title", () => {
    useAgentStore.getState().setActiveConversation({ ...THREAD, title: "   " }, []);
    render(<Shell />);
    expect(slot("subtitle")).toHaveTextContent(/^New chat$/);
  });

  it("says Your chats in History, and the thread again back in the chat", () => {
    useAgentStore.getState().setActiveConversation(THREAD, []);
    render(<Shell />);
    fireEvent.click(historyButton());
    expect(slot("subtitle")).toHaveTextContent(/^Your chats$/);
    expect(subtitle()).toBe("Your chats");

    fireEvent.click(within(header()).getByRole("button", { name: "Back to chat" }));
    expect(slot("subtitle")).toHaveTextContent(/^Sprint 47 planning$/);
  });
});

describe("History and Back to chat", () => {
  it("turns History into Back to chat with an arrow, the same button, keeping focus on the way in", () => {
    render(<Shell />);
    const button = historyButton();
    // Its name says where it goes, so it is no toggle.
    expect(button).not.toHaveAttribute("aria-pressed");
    expect(button).toHaveAttribute("title", "History");
    button.focus();
    fireEvent.click(button);

    const back = within(header()).getByRole("button", { name: "Back to chat" });
    expect(back).toBe(button);
    expect(back).toHaveFocus();
    expect(back).not.toHaveAttribute("aria-pressed");
    expect(back).toHaveAttribute("title", "Back to chat");
    // The arrow is a picture of the words: hidden from screen readers.
    const icons = back.querySelectorAll("svg");
    expect(icons).toHaveLength(1);
    expect(icons[0]).toHaveAttribute("aria-hidden", "true");
    expect(icons[0].getAttribute("class")).toMatch(/arrow-left/);
    expect(screen.getByTestId("conversation-list")).toBeInTheDocument();

    fireEvent.click(back);
    // The same button again. Where focus lands on leaving History is PR 6's
    // focus owner (use-panel-focus: Leaving History -> the History button);
    // today the real chat's mount effect focuses the composer.
    expect(historyButton()).toBe(button);
    expect(screen.getByTestId("agent-conversation")).toBeInTheDocument();
  });

  it("marks Back to chat while a confirm card waits in the chat, and says so", () => {
    render(<Shell />);
    act(() => useAgentStore.setState({ pendingToolUse: CARD }));
    // In the chat the card is in view: no dot.
    expect(header().querySelector("[data-card-waiting]")).toBeNull();
    expect(historyButton()).toHaveAttribute("title", "History");

    fireEvent.click(historyButton());
    const back = within(header()).getByRole("button", { name: "Back to chat" });
    const dot = back.querySelector<HTMLElement>("[data-card-waiting]");
    expect(dot).not.toBeNull();
    // A dot, so rounded-full is allowed; decorative, the title says it.
    expect(dot).toHaveAttribute("aria-hidden", "true");
    expect(dot).toHaveClass("rounded-full", "bg-accent", "absolute");
    expect(back).toHaveClass("relative");
    expect(back).toHaveAttribute("title", `Back to chat · ${CARD_WAITING_NOTE}`);
    // Narration: Amr in the third person.
    expect(CARD_WAITING_NOTE).toBe("Amr is waiting for your OK");
    // The name stays the same, so it is still found by it.
    expect(back).toHaveAccessibleName("Back to chat");

    act(() => useAgentStore.setState({ pendingToolUse: null }));
    expect(back.querySelector("[data-card-waiting]")).toBeNull();
    expect(back).toHaveAttribute("title", "Back to chat");
  });
});
