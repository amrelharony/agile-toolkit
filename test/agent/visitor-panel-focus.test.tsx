import { StrictMode, type ReactElement } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const h = vi.hoisted(() => ({
  announce: vi.fn(),
  sendVisitorMessage: vi.fn(async () => {}),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/retro",
}));
// The visitor chat's runtime (registry + client), loaded on the first message.
vi.mock("@/lib/agent/visitor-runtime", () => ({
  sendVisitorMessage: h.sendVisitorMessage,
  abortInFlight: vi.fn(),
  retryVisitorTurn: vi.fn(async () => true),
  visitorGoOn: vi.fn(async () => true),
  canRetryLastTurn: vi.fn(() => true),
}));
vi.mock("@/components/a11y/live-announcer", () => ({
  useAnnounce: () => h.announce,
}));

import {
  VISITOR_AI_CONSENT_KEY,
  VISITOR_AI_CONSENT_VERSION,
} from "@/components/agent/mascot/visitor-ai-consent";
import { SEARCH_ANNOUNCE_MS } from "@/components/agent/mascot/visitor-guide";
import { VisitorPanel, visitorFallbackNote } from "@/components/agent/mascot/visitor-panel";
import { PanelChrome } from "@/components/agent/mascot/panel-chrome";
import { PanelHeader } from "@/components/agent/mascot/panel-header";
import { useAgentStore } from "@/lib/agent/store";

/**
 * The panel as Amr's shell draws it: under the panel's header, whose slots the
 * chat fills (its "Back to tool finder" chevron, Clear chat). The view sits in
 * a box of its own, as in the shell.
 */
function renderPanel(panel: ReactElement = <VisitorPanel />) {
  return render(
    <PanelChrome>
      <PanelHeader onClose={() => {}} />
      <div>{panel}</div>
    </PanelChrome>
  );
}

/** Open the chat from the guide (consent already stored). */
async function openChat() {
  window.localStorage.setItem(VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION);
  renderPanel();
  fireEvent.click(screen.getByRole("button", { name: "Chat with Amr" }));
  await screen.findByRole("button", { name: "Back to tool finder" });
}

const search = () => screen.getByLabelText("What do you need to do?");

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

/**
 * Ask a question from the guide (consent already stored), wait for it to be
 * sent, and put it in the chat as the (mocked) runtime would.
 */
async function askInChat(text: string) {
  window.localStorage.setItem(VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION);
  h.sendVisitorMessage.mockClear();
  renderPanel();
  fireEvent.change(search(), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: `Ask Amr about “${text}”` }));
  await waitFor(() => expect(h.sendVisitorMessage).toHaveBeenCalledTimes(1));
  expect(h.sendVisitorMessage).toHaveBeenCalledWith(text, expect.anything());
  act(() => {
    useAgentStore.setState({
      chatProfile: "visitor",
      messages: [
        {
          id: "v1",
          role: "user",
          content: [{ type: "text", text }],
          createdAt: "2026-11-09T08:00:00Z",
        },
      ],
    });
  });
  await screen.findByRole("button", { name: "Back to tool finder" });
}

/**
 * A note over the guide: a narration caption in a box that takes focus. The
 * text sits inside the caption, so this finds the box around it.
 */
function noteBox(text: string): HTMLElement {
  const words = screen.getByText(text);
  expect(words.closest('[data-voice="narration"]')).not.toBeNull();
  const box = words.closest<HTMLElement>('[tabindex="-1"]');
  expect(box).not.toBe(screen.getByTestId("mascot-visitor-guide"));
  return box!;
}

describe("VisitorPanel: focus and announcements", () => {
  beforeEach(() => {
    h.announce.mockClear();
    window.localStorage.removeItem(VISITOR_AI_CONSENT_KEY);
    useAgentStore.getState().reset();
    useAgentStore.setState({ chatProfile: "owner", visitorQuota: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useAgentStore.getState().reset();
    useAgentStore.setState({ chatProfile: "owner", visitorQuota: null });
    window.localStorage.removeItem(VISITOR_AI_CONSENT_KEY);
  });

  it("moves no focus when the panel opens on the guide", () => {
    renderPanel();
    expect(screen.getByTestId("mascot-visitor-guide")).toBeInTheDocument();
    expect(document.body).toHaveFocus();
    expect(h.announce).not.toHaveBeenCalled();
  });

  it("puts focus on the consent card's scrolling text when it appears", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Chat with Amr" }));
    const card = screen.getByRole("region", { name: "Before you chat with Amr's AI" });
    // Keys scroll the focused element or a scroller around it, never one
    // inside it: focus on the scroller lets the arrow keys scroll the points.
    const scroller = within(card).getByRole("heading", { level: 3 }).closest(".overflow-y-auto");
    expect(scroller).not.toBeNull();
    expect(scroller).toHaveAttribute("tabindex", "-1");
    expect(scroller).toHaveFocus();
    expect(card).not.toHaveAttribute("tabindex");
    // The buttons stay in the named region, outside the scroller.
    expect(card).toContainElement(screen.getByRole("button", { name: "Not now" }));
    expect(scroller).not.toContainElement(screen.getByRole("button", { name: "Not now" }));
  });

  it("Not now leaves focus on the guide, not on the page or the search box", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Chat with Amr" }));
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    const guide = screen.getByTestId("mascot-visitor-guide");
    expect(guide).toHaveAttribute("tabindex", "-1");
    expect(guide).toHaveFocus();
    expect(document.body).not.toHaveFocus();
    expect(screen.getByLabelText("What do you need to do?")).not.toHaveFocus();
    expect(h.announce).not.toHaveBeenCalled();
  });

  it("Back to tool finder leaves focus on the guide", async () => {
    await openChat();
    // The chat's message box takes focus itself, in an effect.
    await waitFor(() => expect(screen.getByLabelText("Message")).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Back to tool finder" }));
    expect(screen.getByTestId("mascot-visitor-guide")).toHaveFocus();
    expect(screen.getByLabelText("What do you need to do?")).not.toHaveFocus();
  });

  it("Not now opens the guide on the question the visitor took to the card, read out by no one", () => {
    vi.useFakeTimers();
    try {
      renderPanel();
      fireEvent.change(search(), { target: { value: "retro" } });
      fireEvent.click(screen.getByRole("button", { name: "Ask Amr about “retro”" }));
      // The card shows the question in the visitor's own caption.
      expect(screen.getByText("retro").closest('[data-voice="you"]')).not.toBeNull();
      act(() => vi.advanceTimersByTime(SEARCH_ANNOUNCE_MS + 50));
      h.announce.mockClear();

      fireEvent.click(screen.getByRole("button", { name: "Not now" }));
      expect(search()).toHaveValue("retro");
      expect(screen.getByRole("list", { name: "Matching tools" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Ask Amr about “retro”" })).toBeInTheDocument();
      expect(screen.getByTestId("mascot-visitor-guide")).toHaveFocus();
      // The visitor typed it before: the guide doesn't read its count again.
      act(() => vi.advanceTimersByTime(SEARCH_ANNOUNCE_MS + 50));
      expect(h.announce).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("going back from the chat opens the guide on its question, and Back to chat returns to it without asking again", async () => {
    await askInChat("retro");

    fireEvent.click(screen.getByRole("button", { name: "Back to tool finder" }));
    expect(search()).toHaveValue("retro");
    expect(screen.getByRole("list", { name: "Matching tools" })).toBeInTheDocument();
    expect(screen.getByTestId("mascot-visitor-guide")).toHaveFocus();

    // The search still holds the chat's own question, sent already: the one
    // Ask button goes back to the chat instead of asking it again.
    expect(screen.queryByRole("button", { name: "Ask Amr about “retro”" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));
    expect(await screen.findByLabelText("Message")).toBeInTheDocument();
    // Once in the chat (getByText finds exactly one), and sent once.
    expect(screen.getByText("retro")).toBeInTheDocument();
    expect(h.sendVisitorMessage).toHaveBeenCalledTimes(1);

    // The next trip back still opens on it, and an empty search goes back too.
    fireEvent.click(screen.getByRole("button", { name: "Back to tool finder" }));
    expect(search()).toHaveValue("retro");
    expect(screen.getByRole("button", { name: "Back to chat" })).toBeInTheDocument();
    fireEvent.change(search(), { target: { value: "" } });
    expect(screen.queryByRole("button", { name: "Chat with Amr" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));
    expect(await screen.findByLabelText("Message")).toBeInTheDocument();
    expect(h.sendVisitorMessage).toHaveBeenCalledTimes(1);
  });

  it("a new search from the guide is asked in the chat under way", async () => {
    await askInChat("retro");
    fireEvent.click(screen.getByRole("button", { name: "Back to tool finder" }));

    fireEvent.change(search(), { target: { value: "estimate" } });
    expect(screen.queryByRole("button", { name: "Back to chat" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ask Amr about “estimate”" }));
    await waitFor(() => expect(h.sendVisitorMessage).toHaveBeenCalledTimes(2));
    expect(h.sendVisitorMessage).toHaveBeenNthCalledWith(2, "estimate", expect.anything());

    // That is now the chat's own question: back on the guide, it goes back to the chat.
    fireEvent.click(await screen.findByRole("button", { name: "Back to tool finder" }));
    expect(search()).toHaveValue("estimate");
    fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));
    expect(await screen.findByLabelText("Message")).toBeInTheDocument();
    expect(h.sendVisitorMessage).toHaveBeenCalledTimes(2);
  });

  it("Clear chat drops the question: with a new chat under way, the guide opens empty and Back to chat sends nothing", async () => {
    await askInChat("retro");
    fireEvent.click(screen.getByRole("button", { name: "Clear chat" }));
    expect(useAgentStore.getState().messages).toHaveLength(0);
    // The visitor sends a new message from the composer (as the runtime would add it).
    act(() => {
      useAgentStore.setState({
        messages: [
          {
            id: "v2",
            role: "user",
            content: [{ type: "text", text: "estimate" }],
            createdAt: "2026-11-09T08:05:00Z",
          },
        ],
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Back to tool finder" }));
    // "retro" is no longer in the chat: the guide doesn't open on it.
    expect(search()).toHaveValue("");
    expect(screen.queryByRole("list", { name: "Matching tools" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));
    expect(await screen.findByLabelText("Message")).toBeInTheDocument();
    expect(screen.getByText("estimate")).toBeInTheDocument();
    expect(screen.queryByText("retro")).toBeNull();
    expect(h.sendVisitorMessage).toHaveBeenCalledTimes(1);

    // Typing "retro" again asks it: it is not the chat's own question any more.
    fireEvent.click(screen.getByRole("button", { name: "Back to tool finder" }));
    fireEvent.change(search(), { target: { value: "retro" } });
    expect(screen.queryByRole("button", { name: "Back to chat" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ask Amr about “retro”" }));
    await waitFor(() => expect(h.sendVisitorMessage).toHaveBeenCalledTimes(2));
    expect(h.sendVisitorMessage).toHaveBeenNthCalledWith(2, "retro", expect.anything());
  });

  it("Clear chat drops the question: with the chat left empty, the guide opens empty on Chat with Amr", async () => {
    await askInChat("retro");
    fireEvent.click(screen.getByRole("button", { name: "Clear chat" }));

    fireEvent.click(screen.getByRole("button", { name: "Back to tool finder" }));
    expect(search()).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Back to chat" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ask Amr about “retro”" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Chat with Amr" }));
    expect(await screen.findByLabelText("Message")).toBeInTheDocument();
    // The chat opens empty: nothing is sent.
    expect(h.sendVisitorMessage).toHaveBeenCalledTimes(1);
  });

  it("a refusal drops the question: the guide opens empty, and Back to chat sends nothing", async () => {
    await askInChat("retro");
    act(() => {
      useAgentStore.getState().setVisitorFallback("visitor_limit");
    });
    expect(search()).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));
    expect(await screen.findByLabelText("Message")).toBeInTheDocument();
    expect(h.sendVisitorMessage).toHaveBeenCalledTimes(1);
  });

  it("a question from the guide keeps focus in a message box that stays editable while Amr answers", async () => {
    window.localStorage.setItem(VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION);
    renderPanel();
    fireEvent.change(screen.getByLabelText("What do you need to do?"), {
      target: { value: "retro" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask Amr about “retro”" }));
    const box = await screen.findByLabelText("Message");
    // Amr is answering the question the chat opened with.
    act(() => {
      useAgentStore.setState({ streaming: true });
    });
    expect(box).toHaveFocus();
    // A disabled box takes no keys and drops focus in a browser; this one
    // stays as it was, and only sending waits.
    expect(box).not.toBeDisabled();
    expect(box).not.toHaveAttribute("readonly");
    fireEvent.change(box, { target: { value: "and how long?" } });
    expect(useAgentStore.getState().drafts.visitor).toBe("and how long?");
    h.sendVisitorMessage.mockClear();
    fireEvent.keyDown(box, { key: "Enter" });
    await act(async () => {});
    expect(h.sendVisitorMessage).not.toHaveBeenCalled();
    expect(box).toHaveValue("and how long?");
    expect(screen.getByRole("button", { name: "Stop answer" })).not.toHaveAttribute(
      "aria-disabled"
    );
    act(() => {
      useAgentStore.setState({ streaming: false });
    });
    expect(box).toHaveFocus();
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  });

  it("a yes on the consent card with no question waiting puts focus in the box, even on a touch screen", async () => {
    touchScreen();
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Chat with Amr" }));
    fireEvent.click(screen.getByRole("button", { name: "Agree and chat" }), { detail: 1 });
    const box = await screen.findByLabelText("Message");
    await waitFor(() => expect(box).toHaveFocus());
    expect(h.sendVisitorMessage).not.toHaveBeenCalled();
  });

  it("a yes with a question waiting leaves focus off the box on a touch screen: the answer is what comes next", async () => {
    touchScreen();
    h.sendVisitorMessage.mockClear();
    renderPanel();
    fireEvent.change(search(), { target: { value: "retro" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask Amr about “retro”" }));
    fireEvent.click(screen.getByRole("button", { name: /^Agree and ask/ }), { detail: 1 });
    const box = await screen.findByLabelText("Message");
    await waitFor(() => expect(h.sendVisitorMessage).toHaveBeenCalledTimes(1));
    expect(box).not.toHaveFocus();
  });

  it("the chat opened from the guide on a touch screen leaves focus alone, as consent was given before", async () => {
    touchScreen();
    await openChat();
    await act(async () => {});
    expect(screen.getByLabelText("Message")).not.toHaveFocus();
  });

  it("a refusal in the chat puts focus on its note and is not announced as well", async () => {
    await openChat();
    act(() => {
      useAgentStore.getState().setVisitorFallback("visitor_limit");
    });
    const text = visitorFallbackNote("visitor_limit", null);
    const note = noteBox(text);
    // Focus on the note makes a screen reader read it: saying it again through
    // the announcer would read it twice.
    expect(note).toHaveFocus();
    expect(note).not.toHaveAttribute("role");
    // A limit is a note, not an error.
    expect(note.querySelector('[data-voice="narration"]')).toHaveAttribute("data-tone", "note");
    expect(screen.queryByRole("status")).toBeNull();
    expect(h.announce).not.toHaveBeenCalled();

    // A later quota update, with the same refusal showing, says nothing either.
    act(() => {
      useAgentStore.getState().setVisitorQuota({
        remaining: 0,
        limit: 100,
        peak: false,
        peakRemaining: null,
        peakLimit: null,
        peakEndsAt: null,
      });
    });
    expect(h.announce).not.toHaveBeenCalled();
  });

  it("a refusal that arrives with the guide showing is announced once and moves no focus", async () => {
    await openChat();
    fireEvent.click(screen.getByRole("button", { name: "Back to tool finder" }));
    const guide = screen.getByTestId("mascot-visitor-guide");
    expect(guide).toHaveFocus();
    h.announce.mockClear();

    // The answer to a message sent before the visitor went back to the guide.
    act(() => {
      useAgentStore.getState().setVisitorFallback("visitor_limit");
    });
    const text = visitorFallbackNote("visitor_limit", null);
    const note = noteBox(text);
    // No focus moves, so the announcer is the only thing that says it.
    expect(note).not.toHaveFocus();
    expect(guide).toHaveFocus();
    expect(h.announce).toHaveBeenCalledTimes(1);
    expect(h.announce).toHaveBeenCalledWith(text);
  });

  it("shows a note inside the guide's own scroll area, above the search", async () => {
    await openChat();
    act(() => {
      useAgentStore.getState().setVisitorFallback("visitor_limit");
    });
    const guide = screen.getByTestId("mascot-visitor-guide");
    const note = noteBox(visitorFallbackNote("visitor_limit", null));
    // In a short panel a note outside the guide would take the guide's height
    // and leave it a strip. Inside, it scrolls with the rest.
    expect(guide).toContainElement(note);
    expect(guide.firstElementChild).toBe(note);
    expect(guide).toHaveClass("h-full", "overflow-y-auto");
    // The panel's box is the guide itself: nothing sits beside it.
    expect(guide.parentElement?.children).toHaveLength(1);
  });

  it("opening the panel with an old refusal showing announces nothing and moves no focus", () => {
    useAgentStore.setState({ visitorFallback: "site_busy" });
    // StrictMode runs each effect twice on mount, as React does in development.
    render(
      <StrictMode>
        <VisitorPanel />
      </StrictMode>
    );
    expect(screen.getByText(/Amr is too busy/)).toBeInTheDocument();
    expect(h.announce).not.toHaveBeenCalled();
    expect(document.body).toHaveFocus();
  });
  it("Try again hands focus to the message box with the caret after the draft, before the note goes", async () => {
    await askInChat("retro");
    act(() => {
      useAgentStore.getState().setDraft("visitor", "and the timer?");
      useAgentStore.getState().setNotice({
        tone: "error",
        kind: "upstream_error",
        text: "Amr's AI service hit an error. Try again in a moment.",
      });
    });
    const tryAgain = await screen.findByRole("button", { name: "Try again" });
    tryAgain.focus();
    fireEvent.click(tryAgain);
    const box = screen.getByLabelText("Message") as HTMLTextAreaElement;
    expect(box).toHaveFocus();
    expect(box.selectionStart).toBe("and the timer?".length);
    expect(box.selectionEnd).toBe("and the timer?".length);
  });

  it("speaks a settled turn once, with Amr's words, and nothing while it streams", async () => {
    await askInChat("retro");
    h.announce.mockClear();
    act(() => {
      useAgentStore.setState({ streaming: true });
      useAgentStore.getState().appendMessage({
        id: "a1",
        role: "assistant",
        content: [{ type: "text", text: "Start" }],
        createdAt: "2026-11-09T08:00:01Z",
      });
      useAgentStore.getState().setStreamingMessageId("a1");
    });
    for (const words of ["Start with", "Start with what went", "Start with what went well."]) {
      act(() => {
        useAgentStore.getState().patchMessage("a1", [{ type: "text", text: words }]);
      });
    }
    expect(h.announce).not.toHaveBeenCalled();
    // The log itself never speaks: it is not live, and nothing in it is.
    const log = screen.getByRole("log", { name: "Conversation" });
    expect(log).toHaveAttribute("aria-live", "off");
    act(() => {
      useAgentStore.getState().setStreaming(false);
    });
    expect(h.announce).toHaveBeenCalledTimes(1);
    expect(h.announce).toHaveBeenCalledWith("Amr said: Start with what went well.");
  });
});
