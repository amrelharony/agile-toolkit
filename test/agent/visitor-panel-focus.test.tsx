import { StrictMode } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

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
import { useAgentStore } from "@/lib/agent/store";

/** Open the chat from the guide (consent already stored). */
async function openChat() {
  window.localStorage.setItem(VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION);
  render(<VisitorPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Chat with Amr" }));
  await screen.findByRole("button", { name: "Tool finder" });
}

const search = () => screen.getByLabelText("What do you need to do?");

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
    useAgentStore.getState().reset();
    useAgentStore.setState({ chatProfile: "owner", visitorQuota: null });
    window.localStorage.removeItem(VISITOR_AI_CONSENT_KEY);
  });

  it("moves no focus when the panel opens on the guide", () => {
    render(<VisitorPanel />);
    expect(screen.getByTestId("mascot-visitor-guide")).toBeInTheDocument();
    expect(document.body).toHaveFocus();
    expect(h.announce).not.toHaveBeenCalled();
  });

  it("puts focus on the consent card when it appears", () => {
    render(<VisitorPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Chat with Amr" }));
    const card = screen.getByRole("region", { name: "Before you chat with Amr's AI" });
    expect(card).toHaveAttribute("tabindex", "-1");
    expect(card).toHaveFocus();
  });

  it("Not now leaves focus on the guide, not on the page or the search box", () => {
    render(<VisitorPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Chat with Amr" }));
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    const guide = screen.getByTestId("mascot-visitor-guide");
    expect(guide).toHaveAttribute("tabindex", "-1");
    expect(guide).toHaveFocus();
    expect(document.body).not.toHaveFocus();
    expect(screen.getByLabelText("What do you need to do?")).not.toHaveFocus();
    expect(h.announce).not.toHaveBeenCalled();
  });

  it("Tool finder leaves focus on the guide", async () => {
    await openChat();
    // The chat's message box takes focus itself, in an effect.
    await waitFor(() => expect(screen.getByLabelText("Message")).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Tool finder" }));
    expect(screen.getByTestId("mascot-visitor-guide")).toHaveFocus();
    expect(screen.getByLabelText("What do you need to do?")).not.toHaveFocus();
  });

  it("Not now opens the guide on the question the visitor took to the card, read out by no one", () => {
    vi.useFakeTimers();
    try {
      render(<VisitorPanel />);
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

  it("going back from the chat opens the guide on its question, and Back to chat returns to it", async () => {
    window.localStorage.setItem(VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION);
    h.sendVisitorMessage.mockClear();
    render(<VisitorPanel />);
    fireEvent.change(search(), { target: { value: "retro" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask Amr about “retro”" }));
    await waitFor(() => expect(h.sendVisitorMessage).toHaveBeenCalledTimes(1));
    // The runtime is mocked, so the test puts the visitor's message in the chat.
    act(() => {
      useAgentStore.setState({
        chatProfile: "visitor",
        messages: [
          {
            id: "v1",
            role: "user",
            content: [{ type: "text", text: "retro" }],
            createdAt: "2026-11-09T08:00:00Z",
          },
        ],
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Tool finder" }));
    expect(search()).toHaveValue("retro");
    expect(screen.getByRole("list", { name: "Matching tools" })).toBeInTheDocument();
    expect(screen.getByTestId("mascot-visitor-guide")).toHaveFocus();

    // With the search cleared, the one Ask button is the way back to the chat.
    fireEvent.change(search(), { target: { value: "" } });
    expect(screen.queryByRole("button", { name: "Chat with Amr" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));
    expect(await screen.findByLabelText("Message")).toBeInTheDocument();
    expect(screen.getByText("retro")).toBeInTheDocument();
    // Going back sends nothing again.
    expect(h.sendVisitorMessage).toHaveBeenCalledTimes(1);
  });

  it("a question from the guide keeps focus in a message box that is not disabled", async () => {
    window.localStorage.setItem(VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION);
    render(<VisitorPanel />);
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
    // A disabled box takes no keys and drops focus in a browser. Read-only keeps it.
    expect(box).not.toBeDisabled();
    expect(box).toHaveAttribute("readonly");
    act(() => {
      useAgentStore.setState({ streaming: false });
    });
    expect(box).toHaveFocus();
    expect(box).not.toHaveAttribute("readonly");
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
    fireEvent.click(screen.getByRole("button", { name: "Tool finder" }));
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
});
