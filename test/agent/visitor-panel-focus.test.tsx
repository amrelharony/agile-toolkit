import { StrictMode } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  announce: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/retro",
}));
// The visitor chat's runtime (registry + client), loaded on the first message.
vi.mock("@/lib/agent/visitor-runtime", () => ({
  sendVisitorMessage: vi.fn(async () => {}),
  abortInFlight: vi.fn(),
}));
vi.mock("@/components/a11y/live-announcer", () => ({
  useAnnounce: () => h.announce,
}));

import {
  VISITOR_AI_CONSENT_KEY,
  VISITOR_AI_CONSENT_VERSION,
} from "@/components/agent/mascot/visitor-ai-consent";
import { VisitorPanel, visitorFallbackNote } from "@/components/agent/mascot/visitor-panel";
import { useAgentStore } from "@/lib/agent/store";

/** Open the chat from the guide (consent already stored). */
async function openChat() {
  window.localStorage.setItem(VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION);
  render(<VisitorPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Chat with Amr" }));
  await screen.findByRole("button", { name: "Offline guide" });
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

  it("Offline guide leaves focus on the guide", async () => {
    await openChat();
    // The chat's message box takes focus itself, in an effect.
    await waitFor(() => expect(screen.getByLabelText("Message")).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Offline guide" }));
    expect(screen.getByTestId("mascot-visitor-guide")).toHaveFocus();
    expect(screen.getByLabelText("What do you need to do?")).not.toHaveFocus();
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
    const note = screen.getByText(text);
    // Focus on the note makes a screen reader read it: saying it again through
    // the announcer would read it twice.
    expect(note).toHaveFocus();
    expect(note).not.toHaveAttribute("role");
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
    fireEvent.click(screen.getByRole("button", { name: "Offline guide" }));
    const guide = screen.getByTestId("mascot-visitor-guide");
    expect(guide).toHaveFocus();
    h.announce.mockClear();

    // The answer to a message sent before the visitor went back to the guide.
    act(() => {
      useAgentStore.getState().setVisitorFallback("visitor_limit");
    });
    const text = visitorFallbackNote("visitor_limit", null);
    const note = screen.getByText(text);
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
    const note = screen.getByText(visitorFallbackNote("visitor_limit", null));
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
