import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// Owner state comes from useAuthOptional (via useOwnerState); the chat
// pieces that talk to Supabase / the agent API are replaced by markers so
// the test can assert they never mount for a visitor.
const h = vi.hoisted(() => ({
  auth: null as { status: string; user: { id: string } | null; error?: string } | null,
  pathname: "/",
  sendVisitorMessage: vi.fn(async () => {}),
  abortVisitor: vi.fn(),
}));

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuthOptional: () => h.auth,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => h.pathname,
}));
vi.mock("@/lib/agent/client", () => ({
  abortInFlight: vi.fn(),
}));
// The owner panel populates the action registry; the test doesn't need it.
vi.mock("@/lib/actions/register-all", () => ({}));
// The visitor chat's runtime (registry + client), loaded on the first message.
vi.mock("@/lib/agent/visitor-runtime", () => ({
  sendVisitorMessage: h.sendVisitorMessage,
  abortInFlight: h.abortVisitor,
}));
vi.mock("@/components/agent/mascot/mascot-sprite", () => ({
  default: () => <div data-testid="mascot-sprite" />,
}));
vi.mock("@/components/agent/agent-conversation", () => ({
  AgentConversation: () => <div data-testid="agent-conversation" />,
}));
vi.mock("@/components/agent/conversation-list", () => ({
  ConversationList: () => <div data-testid="conversation-list" />,
}));
vi.mock("@/components/agent/mascot/rate-limit-bar", () => ({
  RateLimitBar: () => <div data-testid="rate-limit-bar" />,
}));

import { MascotAssistant } from "@/components/agent/mascot/mascot-assistant";
import {
  VISITOR_AI_CONSENT_KEY,
  VISITOR_AI_CONSENT_TEXT,
} from "@/components/agent/mascot/visitor-ai-consent";
import {
  VISITOR_FALLBACK_NOTE,
  visitorFallbackNote,
} from "@/components/agent/mascot/visitor-panel";
import { peakNote } from "@/components/agent/mascot/visitor-agent-panel";
import { VISITOR_FALLBACK_CODES } from "@/lib/visitor-ai/contract";
import { formatPeakTime } from "@/lib/visitor-ai/peak";
import { useAgentStore, type VisitorQuota } from "@/lib/agent/store";
import { LIVE_ROOM_KEY_PREFIX, enterLiveVisitorRoom } from "@/lib/realtime/live-visitor-room";
import { OWNER_UNVERIFIED } from "@/lib/auth/owner-check";
import { useLlmUiStore } from "@/lib/stores/llm-ui-store";

const OWNER = { status: "authenticated", user: { id: "u1" } };

function stubPhoneWidth(isPhone: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: isPhone && query === "(max-width: 767px)",
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

describe("MascotAssistant — owner gating", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    h.auth = null;
    h.pathname = "/";
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    stubPhoneWidth(false);
    useAgentStore.setState({ open: true });
    useLlmUiStore.setState({ settingsOpen: false });
  });

  afterEach(() => {
    useAgentStore.getState().reset();
    useAgentStore.setState({ open: false });
    vi.unstubAllGlobals();
  });

  it("shows visitors the tool guide instead of the chat, with no owner requests", () => {
    h.auth = { status: "anonymous", user: null };
    render(<MascotAssistant />);

    expect(screen.getByTestId("mascot-visitor-guide")).toBeInTheDocument();
    expect(screen.queryByTestId("agent-conversation")).toBeNull();
    expect(screen.queryByTestId("conversation-list")).toBeNull();
    expect(screen.queryByTestId("rate-limit-bar")).toBeNull();
    expect(screen.queryByRole("button", { name: "New chat" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Conversation history" })).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("links visitors to AI settings and owner sign-in for the current page", () => {
    h.auth = null; // no AuthProvider at all reads as a visitor too
    h.pathname = "/kudos";
    render(<MascotAssistant />);

    expect(screen.getByRole("link", { name: "Owner sign in" })).toHaveAttribute(
      "href",
      "/auth/sign-in?next=%2Fkudos"
    );
    fireEvent.click(screen.getByRole("button", { name: "AI settings" }));
    expect(useLlmUiStore.getState().settingsOpen).toBe(true);
    expect(useAgentStore.getState().open).toBe(false);
  });

  it("mounts neither the notice nor the chat while auth is loading", () => {
    h.auth = { status: "loading", user: null };
    render(<MascotAssistant />);

    expect(screen.queryByTestId("mascot-visitor-guide")).toBeNull();
    expect(screen.queryByTestId("agent-conversation")).toBeNull();
    expect(screen.queryByTestId("rate-limit-bar")).toBeNull();
  });

  it("lets a visitor find a tool from the panel", () => {
    h.auth = { status: "anonymous", user: null };
    render(<MascotAssistant />);

    fireEvent.change(screen.getByLabelText("What do you need to do?"), {
      target: { value: "retrospective" },
    });
    const results = screen.getByRole("list", { name: "Matching tools" });
    expect(within(results).getAllByRole("link")[0]).toHaveAttribute("href", "/retro");
  });

  it("shows a visitor how to run the tool they're on", async () => {
    h.auth = { status: "anonymous", user: null };
    h.pathname = "/wsjf";
    render(<MascotAssistant />);

    const tool = screen.getByRole("region", { name: "This tool" });
    expect(await within(tool).findByText("How to run it")).toBeInTheDocument();
    expect(within(tool).getByText(/WSJF = cost of delay ÷ job size/)).toBeInTheDocument();
  });

  it("puts the tool search before the current tool's guide", async () => {
    h.auth = { status: "anonymous", user: null };
    h.pathname = "/wsjf";
    render(<MascotAssistant />);

    const search = screen.getByLabelText("What do you need to do?");
    const tool = screen.getByRole("region", { name: "This tool" });
    const howTo = await within(tool).findByText("How to run it");
    const popular = screen.getByRole("list", { name: "Popular tasks" });
    const follows = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    // Search first (a phone shows ~360 px of the panel), then the tool's
    // card, then the common jobs.
    expect(follows(search, howTo)).toBe(true);
    expect(follows(tool, popular)).toBe(true);

    // Results show right under the field, above the tool's card.
    fireEvent.change(search, { target: { value: "retrospective" } });
    const results = screen.getByRole("list", { name: "Matching tools" });
    expect(follows(search, results)).toBe(true);
    expect(follows(results, tool)).toBe(true);
    expect(screen.queryByRole("list", { name: "Popular tasks" })).toBeNull();
  });

  it("gives the footer controls a 44 px target on touch", () => {
    h.auth = { status: "anonymous", user: null };
    render(<MascotAssistant />);

    expect(screen.getByRole("button", { name: "AI settings" })).toHaveClass(
      "pointer-coarse:min-h-11"
    );
    expect(screen.getByRole("link", { name: "Owner sign in" })).toHaveClass(
      "min-touch-coarse",
      "inline-flex",
      "items-center"
    );
  });

  it("hides the Cmd/Ctrl+J hint on touch screens", () => {
    h.auth = { status: "anonymous", user: null };
    render(<MascotAssistant />);

    const hint = screen.getByText(/Cmd\/Ctrl\+J/);
    expect(hint).toHaveClass("pointer-coarse:hidden");
    expect(screen.getByText("Find the right tool")).not.toHaveClass("pointer-coarse:hidden");
  });

  it("gives the owner's New chat and History buttons a 44 px target on touch", async () => {
    h.auth = OWNER;
    render(<MascotAssistant />);

    const panel = screen.getByRole("dialog", { name: "Amr assistant" });
    for (const name of ["New chat", "Conversation history", "Close assistant"]) {
      expect(within(panel).getByRole("button", { name })).toHaveClass(
        "min-touch-coarse",
        "inline-flex",
        "items-center",
        "justify-center"
      );
    }
    expect(screen.getByText(/Cmd\/Ctrl\+J/)).toHaveClass("pointer-coarse:hidden");
    expect(await screen.findByTestId("agent-conversation")).toBeInTheDocument();
  });

  it("gives the owner the full chat panel", async () => {
    h.auth = OWNER;
    render(<MascotAssistant />);

    expect(screen.queryByTestId("mascot-visitor-guide")).toBeNull();
    // The chat is a lazily loaded chunk.
    expect(await screen.findByTestId("agent-conversation")).toBeInTheDocument();
    expect(screen.getByTestId("rate-limit-bar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New chat" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Conversation history" })).toBeInTheDocument();
  });

  it("drops the owner's conversation when the owner signs out", () => {
    h.auth = OWNER;
    const { rerender } = render(<MascotAssistant />);
    act(() => {
      useAgentStore.setState({
        messages: [{ id: "m1", role: "user", content: [], createdAt: "2026-01-01T00:00:00Z" }],
      });
    });

    h.auth = { status: "anonymous", user: null };
    rerender(<MascotAssistant />);

    expect(useAgentStore.getState().messages).toEqual([]);
    expect(screen.getByTestId("mascot-visitor-guide")).toBeInTheDocument();
  });
});

describe("MascotAssistant — visitor AI", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const VISITOR = { status: "anonymous", user: null };

  /** Type a search into the guide and hand it to Amr. */
  function askAbout(query: string) {
    fireEvent.change(screen.getByLabelText("What do you need to do?"), {
      target: { value: query },
    });
    fireEvent.click(screen.getByRole("button", { name: `Ask Amr about “${query}”` }));
  }

  beforeEach(() => {
    h.auth = VISITOR;
    h.pathname = "/retro";
    h.sendVisitorMessage.mockClear();
    h.abortVisitor.mockClear();
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubEnv("NEXT_PUBLIC_VISITOR_AI", "1");
    stubPhoneWidth(false);
    window.localStorage.removeItem(VISITOR_AI_CONSENT_KEY);
    useAgentStore.getState().reset();
    useAgentStore.setState({ open: true, chatProfile: "owner", visitorQuota: null });
  });

  afterEach(() => {
    useAgentStore.getState().reset();
    useAgentStore.setState({ open: false, chatProfile: "owner", visitorQuota: null });
    window.localStorage.removeItem(VISITOR_AI_CONSENT_KEY);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("with the flag off, keeps the plain guide: no AI offers and no requests", () => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_AI", "");
    render(<MascotAssistant />);
    fireEvent.change(screen.getByLabelText("What do you need to do?"), {
      target: { value: "zzqx" },
    });
    expect(screen.getByTestId("mascot-visitor-guide")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ask Amr about/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Chat with Amr" })).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("opens on the offline guide and sends nothing until the visitor agrees", () => {
    render(<MascotAssistant />);
    expect(screen.getByTestId("mascot-visitor-guide")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chat with Amr" })).toBeInTheDocument();

    askAbout("retro");
    expect(screen.getByText(/Before you chat with Amr/)).toBeInTheDocument();
    for (const line of VISITOR_AI_CONSENT_TEXT) expect(screen.getByText(line)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(h.sendVisitorMessage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.getByTestId("mascot-visitor-guide")).toBeInTheDocument();
    expect(window.localStorage.getItem(VISITOR_AI_CONSENT_KEY)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(h.sendVisitorMessage).not.toHaveBeenCalled();
  });

  it("offers to ask Amr when the search finds nothing", () => {
    render(<MascotAssistant />);
    askAbout("zzqx");
    expect(screen.getByRole("button", { name: "Agree and ask" })).toBeInTheDocument();
  });

  it("stores the consent and asks the question once the visitor agrees", async () => {
    render(<MascotAssistant />);
    askAbout("retro");
    fireEvent.click(screen.getByRole("button", { name: "Agree and ask" }));

    expect(window.localStorage.getItem(VISITOR_AI_CONSENT_KEY)).toBe("v1");
    await waitFor(() =>
      expect(h.sendVisitorMessage).toHaveBeenCalledWith("retro", { toolId: "retro" })
    );
    expect(h.sendVisitorMessage).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: "Offline guide" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear chat" })).toBeInTheDocument();
    // The runtime is mocked; the panel itself fetched nothing.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("skips the card once consent is stored, and opens an empty chat from the link", async () => {
    window.localStorage.setItem(VISITOR_AI_CONSENT_KEY, "v1");
    render(<MascotAssistant />);
    fireEvent.click(screen.getByRole("button", { name: "Chat with Amr" }));

    expect(screen.queryByText(/Before you chat with Amr/)).toBeNull();
    expect(await screen.findByRole("button", { name: "Offline guide" })).toBeInTheDocument();
    expect(screen.getByLabelText("Message")).toBeInTheDocument();
    expect(h.sendVisitorMessage).not.toHaveBeenCalled();
  });

  it("asks again when the stored consent is for an older card", () => {
    window.localStorage.setItem(VISITOR_AI_CONSENT_KEY, "v0");
    render(<MascotAssistant />);
    fireEvent.click(screen.getByRole("button", { name: "Chat with Amr" }));
    expect(screen.getByText(/Before you chat with Amr/)).toBeInTheDocument();
  });

  it("shows the visitor's allowance in the chat", async () => {
    window.localStorage.setItem(VISITOR_AI_CONSENT_KEY, "v1");
    render(<MascotAssistant />);
    fireEvent.click(screen.getByRole("button", { name: "Chat with Amr" }));
    await screen.findByRole("button", { name: "Offline guide" });
    act(() => {
      useAgentStore.getState().setVisitorQuota({
        remaining: 62,
        limit: 100,
        peak: false,
        peakRemaining: null,
        peakLimit: null,
        peakEndsAt: null,
      });
    });
    expect(screen.getByTestId("visitor-ai-quota")).toHaveTextContent("62 of 100 left today");
  });

  it("goes back to the offline guide when Amr can't answer any more", async () => {
    window.localStorage.setItem(VISITOR_AI_CONSENT_KEY, "v1");
    render(<MascotAssistant />);
    fireEvent.click(screen.getByRole("button", { name: "Chat with Amr" }));
    await screen.findByRole("button", { name: "Offline guide" });

    act(() => {
      useAgentStore.getState().setVisitorFallback("visitor_limit");
    });
    expect(screen.getByTestId("mascot-visitor-guide")).toBeInTheDocument();
    expect(screen.getByText(visitorFallbackNote("visitor_limit", null))).toBeInTheDocument();
    expect(screen.queryByText(VISITOR_FALLBACK_NOTE)).toBeNull();
    expect(screen.queryByLabelText("Message")).toBeNull();
  });

  it("says when the busy hours end, in the visitor's own time, at a busy-hours limit", async () => {
    window.localStorage.setItem(VISITOR_AI_CONSENT_KEY, "v1");
    render(<MascotAssistant />);
    fireEvent.click(screen.getByRole("button", { name: "Chat with Amr" }));
    await screen.findByRole("button", { name: "Offline guide" });

    const ends = new Date(Date.now() + 90 * 60_000);
    act(() => {
      useAgentStore.getState().setVisitorQuota({
        remaining: 40,
        limit: 100,
        peak: true,
        peakRemaining: 0,
        peakLimit: 25,
        peakEndsAt: ends.toISOString(),
      });
      useAgentStore.getState().setVisitorFallback("visitor_peak_limit");
    });
    expect(
      screen.getByText(
        `You've used all your messages for these busy hours. Here's the offline guide until ${formatPeakTime(ends)}.`
      )
    ).toBeInTheDocument();
  });

  it("asking again after a fallback is a fresh try", async () => {
    window.localStorage.setItem(VISITOR_AI_CONSENT_KEY, "v1");
    useAgentStore.setState({ visitorFallback: "site_busy" });
    render(<MascotAssistant />);
    expect(screen.getByText(/Amr is too busy/)).toBeInTheDocument();

    askAbout("retro");
    expect(useAgentStore.getState().visitorFallback).toBeNull();
    await waitFor(() =>
      expect(h.sendVisitorMessage).toHaveBeenCalledWith("retro", { toolId: "retro" })
    );
  });

  it("reopening the panel mid-chat goes straight back to the chat", async () => {
    window.localStorage.setItem(VISITOR_AI_CONSENT_KEY, "v1");
    useAgentStore.setState({
      chatProfile: "visitor",
      messages: [
        {
          id: "v1",
          role: "user",
          content: [{ type: "text", text: "How do I run a retro?" }],
          createdAt: "2026-11-09T08:00:00Z",
        },
      ],
    });
    render(<MascotAssistant />);
    expect(await screen.findByLabelText("Message")).toBeInTheDocument();
    expect(screen.queryByTestId("mascot-visitor-guide")).toBeNull();
  });

  it("gives Chat with Amr a 44 px target on touch, like the rest of the footer", () => {
    render(<MascotAssistant />);
    expect(screen.getByRole("button", { name: "Chat with Amr" })).toHaveClass(
      "min-touch-coarse",
      "flex",
      "items-center"
    );
  });

  // jsdom has no layout, so this checks the classes, not the wrapped text.
  it("gives Ask Amr the classes that let a long search wrap, and keeps 44 px on touch", () => {
    render(<MascotAssistant />);
    fireEvent.change(screen.getByLabelText("What do you need to do?"), {
      target: { value: "how do I stop my team from skipping the retro" },
    });
    const ask = screen.getByRole("button", { name: /^Ask Amr about/ });
    expect(ask).toHaveClass("h-auto", "max-w-full", "whitespace-normal", "text-left");
    // Size "sm" still sets the touch height; its one-line rules are gone.
    expect(ask).toHaveClass("pointer-coarse:min-h-11");
    expect(ask).not.toHaveClass("whitespace-nowrap");
    expect(ask).not.toHaveClass("md-fine:h-8");
  });

  // jsdom has no layout, so this checks the classes, not the scrolling itself.
  it("gives the chat the classes that keep the composer in reach in a short panel", async () => {
    window.localStorage.setItem(VISITOR_AI_CONSENT_KEY, "v1");
    render(<MascotAssistant />);
    fireEvent.click(screen.getByRole("button", { name: "Chat with Amr" }));
    const log = await screen.findByRole("log", { name: "Conversation" });
    // The log has a floor, and still takes the rest and scrolls inside itself.
    expect(log).toHaveClass("min-h-[6rem]", "flex-1", "overflow-y-auto");
    // The chat scrolls as a whole when the floor and the footer don't fit.
    expect(log.parentElement).toHaveClass("h-full", "min-h-0", "flex-col", "overflow-y-auto");
    // The footer keeps its height.
    const footer = screen.getByLabelText("Message").closest("form")?.parentElement;
    expect(footer).toHaveClass("shrink-0");
  });

  // jsdom has no layout and no scrollIntoView, so this checks the call. In a
  // short panel the chat's root scrolls, and the log is above the message box.
  it("brings the log into view when there is something new in it, not for an empty chat", async () => {
    const scrollIntoView = vi.fn();
    const proto = Element.prototype as { scrollIntoView?: unknown };
    const before = Object.getOwnPropertyDescriptor(proto, "scrollIntoView");
    proto.scrollIntoView = scrollIntoView;
    try {
      window.localStorage.setItem(VISITOR_AI_CONSENT_KEY, "v1");
      render(<MascotAssistant />);
      fireEvent.click(screen.getByRole("button", { name: "Chat with Amr" }));
      const log = await screen.findByRole("log", { name: "Conversation" });
      // An empty chat stays on the message box.
      expect(scrollIntoView).not.toHaveBeenCalled();

      act(() => {
        useAgentStore.getState().appendMessage({
          id: "a1",
          role: "assistant",
          content: [{ type: "text", text: "Start with what went well." }],
          createdAt: "2026-11-09T08:00:01Z",
        });
      });
      // "nearest" moves only as far as needed, so a tall panel does not move.
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
      expect(scrollIntoView.mock.instances.at(-1)).toBe(log);
    } finally {
      if (before) Object.defineProperty(proto, "scrollIntoView", before);
      else delete proto.scrollIntoView;
    }
  });

  it("says Amr only answers questions while the visitor is in a live room", async () => {
    window.localStorage.setItem(VISITOR_AI_CONSENT_KEY, "v1");
    render(<MascotAssistant />);
    fireEvent.click(screen.getByRole("button", { name: "Chat with Amr" }));
    await screen.findByRole("button", { name: "Offline guide" });
    expect(screen.queryByTestId("visitor-ai-live-room")).toBeNull();
    // Out of a room the chat offers a change and says Amr asks first.
    expect(screen.getByText(/Add a card/)).toBeInTheDocument();
    expect(screen.getByTestId("visitor-ai-quota")).toHaveTextContent(
      "Amr asks before changing anything"
    );

    let leave = () => {};
    act(() => {
      leave = enterLiveVisitorRoom();
    });
    try {
      expect(screen.getByTestId("visitor-ai-live-room")).toHaveTextContent(
        "You're in a live room, so Amr only answers questions here: he won't read or change your tools."
      );
      // Nothing else in the chat promises a change the room rules out.
      expect(screen.queryByText(/Add a card/)).toBeNull();
      expect(screen.getByText(/What makes a good sprint goal\?/)).toBeInTheDocument();
      const quota = screen.getByTestId("visitor-ai-quota");
      expect(quota).not.toHaveTextContent("Amr asks before changing anything");
      expect(quota).toHaveTextContent("Not saved");
    } finally {
      act(() => leave());
    }
    expect(screen.queryByTestId("visitor-ai-live-room")).toBeNull();
    expect(screen.getByText(/Add a card/)).toBeInTheDocument();
    expect(screen.getByTestId("visitor-ai-quota")).toHaveTextContent(
      "Amr asks before changing anything"
    );
  });

  it("says the same when the live room is open in another tab of this browser", async () => {
    window.localStorage.setItem(VISITOR_AI_CONSENT_KEY, "v1");
    render(<MascotAssistant />);
    fireEvent.click(screen.getByRole("button", { name: "Chat with Amr" }));
    await screen.findByRole("button", { name: "Offline guide" });
    expect(screen.queryByTestId("visitor-ai-live-room")).toBeNull();

    // What the tab with the room does: it writes its stamp, and this tab gets
    // a storage event for it.
    const key = `${LIVE_ROOM_KEY_PREFIX}another-tab`;
    try {
      act(() => {
        window.localStorage.setItem(key, String(Date.now()));
        window.dispatchEvent(new StorageEvent("storage", { key }));
      });
      expect(screen.getByTestId("visitor-ai-live-room")).toBeInTheDocument();
      expect(screen.queryByText(/Add a card/)).toBeNull();

      // The room closes there: the stamp goes and the line with it.
      act(() => {
        window.localStorage.removeItem(key);
        window.dispatchEvent(new StorageEvent("storage", { key }));
      });
      expect(screen.queryByTestId("visitor-ai-live-room")).toBeNull();
    } finally {
      window.localStorage.removeItem(key);
    }
  });

  describe("the visitor's chat", () => {
    /** Open the chat with a first question, so the (mocked) runtime is loaded. */
    async function openChatWithQuestion() {
      const view = render(<MascotAssistant />);
      askAbout("retro");
      fireEvent.click(screen.getByRole("button", { name: "Agree and ask" }));
      await waitFor(() => expect(h.sendVisitorMessage).toHaveBeenCalledTimes(1));
      await screen.findByRole("button", { name: "Offline guide" });
      return view;
    }

    it("asks before a change with Approve and Deny, never Approve all", async () => {
      await openChatWithQuestion();
      act(() => {
        useAgentStore.getState().setPendingToolUse({
          toolUseId: "c1",
          actionId: "tool_retro_add_card",
          resolvedActionId: "tool.retro.add_card",
          input: { text: "flaky CI" },
          summary: "Add a card 'flaky CI' to the retro",
          resolve: () => {},
        });
      });
      expect(screen.getByText("Add a card 'flaky CI' to the retro")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Deny" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Approve all/ })).toBeNull();
    });

    it("shows Amr thinking until his reply's first words arrive", async () => {
      await openChatWithQuestion();
      act(() => {
        useAgentStore.setState({
          streaming: true,
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
      expect(screen.getByText("Amr is thinking…").closest('[role="status"]')).not.toBeNull();

      act(() => {
        useAgentStore.getState().appendMessage({
          id: "a1",
          role: "assistant",
          content: [{ type: "text", text: "Start with what went well." }],
          createdAt: "2026-11-09T08:00:01Z",
        });
      });
      expect(screen.queryByText("Amr is thinking…")).toBeNull();
    });

    it("Clear chat stops the answer and empties the chat", async () => {
      await openChatWithQuestion();
      act(() => {
        useAgentStore.setState({
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
      h.abortVisitor.mockClear();
      fireEvent.click(screen.getByRole("button", { name: "Clear chat" }));
      expect(h.abortVisitor).toHaveBeenCalledTimes(1);
      expect(useAgentStore.getState().messages).toEqual([]);
    });

    it("Offline guide goes back to the guide and stops the answer", async () => {
      await openChatWithQuestion();
      h.abortVisitor.mockClear();
      fireEvent.click(screen.getByRole("button", { name: "Offline guide" }));
      expect(screen.getByTestId("mascot-visitor-guide")).toBeInTheDocument();
      expect(screen.queryByLabelText("Message")).toBeNull();
      await waitFor(() => expect(h.abortVisitor).toHaveBeenCalledTimes(1));
    });

    it("unmounting the chat stops the answer", async () => {
      const view = await openChatWithQuestion();
      h.abortVisitor.mockClear();
      view.unmount();
      // The stop waits a microtask (React's development double-mount).
      await waitFor(() => expect(h.abortVisitor).toHaveBeenCalledTimes(1));
    });
  });

  it("never shows the owner the visitor AI", async () => {
    h.auth = OWNER;
    render(<MascotAssistant />);
    expect(await screen.findByTestId("agent-conversation")).toBeInTheDocument();
    expect(screen.queryByTestId("mascot-visitor-guide")).toBeNull();
    expect(screen.queryByRole("button", { name: "Chat with Amr" })).toBeNull();
    expect(screen.queryByText(/Before you chat with Amr/)).toBeNull();
  });

  it("keeps the plain guide for an owner session that isn't verified yet", () => {
    h.auth = { status: "error", user: null, error: OWNER_UNVERIFIED };
    render(<MascotAssistant />);
    expect(screen.getByTestId("mascot-visitor-guide")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Chat with Amr" })).toBeNull();
  });

  it("drops the visitor's chat when the visitor turns out to be the owner", () => {
    const { rerender } = render(<MascotAssistant />);
    act(() => {
      useAgentStore.setState({
        chatProfile: "visitor",
        visitorQuota: {
          remaining: 3,
          limit: 100,
          peak: false,
          peakRemaining: null,
          peakLimit: null,
          peakEndsAt: null,
        },
        messages: [{ id: "v1", role: "user", content: [], createdAt: "2026-11-09T08:00:00Z" }],
      });
    });

    h.auth = OWNER;
    rerender(<MascotAssistant />);

    const s = useAgentStore.getState();
    expect(s.messages).toEqual([]);
    expect(s.chatProfile).toBe("owner");
    expect(s.visitorQuota).toBeNull();
  });
});

describe("MascotAssistant — comic reader", () => {
  beforeEach(() => {
    h.auth = null;
    useAgentStore.setState({ open: false });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["another page on a phone", "/kudos", true],
    ["another page on a wide screen", "/kudos", false],
    // A character stays visible for everyone, the comics included: only the
    // comics' full-screen panel covers it.
    ["the comics on a phone", "/comics", true],
    ["the comics on a wide screen", "/comics", false],
  ])("keeps the mascot on %s", async (_label, pathname, isPhone) => {
    stubPhoneWidth(isPhone);
    h.pathname = pathname;
    render(<MascotAssistant />);
    expect(screen.getByRole("button", { name: "Open assistant" })).toBeInTheDocument();
    // The figure waits for the first interaction (or a few seconds after
    // load), so it never competes with the page becoming usable.
    expect(screen.queryByTestId("mascot-sprite")).toBeNull();
    fireEvent.pointerDown(window);
    await waitFor(() => expect(screen.getByTestId("mascot-sprite")).toBeInTheDocument());
  });
});

describe("peakNote (the visitor chat's busy-hours note)", () => {
  // Monday 9 November 2026, 15:00 in Singapore (07:00 UTC): inside 14:00-18:00.
  const IN_PEAK = new Date("2026-11-09T07:00:00Z");
  // Saturday: never busy hours.
  const WEEKEND = new Date("2026-11-14T07:00:00Z");
  const quota = (over: Partial<VisitorQuota>): VisitorQuota => ({
    remaining: 50,
    limit: 100,
    peak: false,
    peakRemaining: null,
    peakLimit: null,
    peakEndsAt: null,
    ...over,
  });

  it("names the end of busy hours in the visitor's own time, from the clock alone", () => {
    const end = formatPeakTime(new Date("2026-11-09T10:00:00Z"));
    expect(peakNote(null, IN_PEAK)).toBe(`Busy hours until ${end}: 25 messages in this window`);
  });

  it("uses the route's numbers once it has answered", () => {
    const ends = "2026-11-09T10:00:00.000Z";
    const note = peakNote(
      quota({ peak: true, peakRemaining: 18, peakLimit: 25, peakEndsAt: ends }),
      IN_PEAK
    );
    expect(note).toBe(
      `Busy hours until ${formatPeakTime(new Date(ends))}: 18 of 25 messages left in this window`
    );
  });

  it("says nothing when the route answered 'not busy hours' during this window (the owner moved it)", () => {
    // Answered at 14:30 Singapore, inside the default window: the route's config wins.
    const answeredInWindow = Date.parse("2026-11-09T06:30:00Z");
    expect(
      peakNote(quota({ peak: false, peakLimit: 25, receivedAt: answeredInWindow }), IN_PEAK)
    ).toBeNull();
    // Left out, receivedAt counts as just now: the route's word wins too.
    expect(peakNote(quota({ peak: false, peakLimit: 25 }), IN_PEAK)).toBeNull();
  });

  it("goes by the clock when the route's 'not busy hours' came before this window, naming its limit", () => {
    // Answered at 13:30 Singapore, before the window opened.
    const answeredBefore = Date.parse("2026-11-09T05:30:00Z");
    const end = formatPeakTime(new Date("2026-11-09T10:00:00Z"));
    expect(
      peakNote(quota({ peak: false, peakLimit: 15, receivedAt: answeredBefore }), IN_PEAK)
    ).toBe(`Busy hours until ${end}: 15 messages in this window`);
  });

  it("says nothing outside busy hours, even after a stale busy-hours answer", () => {
    expect(peakNote(null, WEEKEND)).toBeNull();
    expect(
      peakNote(
        quota({ peak: true, peakRemaining: 0, peakLimit: 25, peakEndsAt: "2026-11-13T10:00:00Z" }),
        WEEKEND
      )
    ).toBeNull();
  });
});

describe("visitorFallbackNote (the note over the guide after a refusal)", () => {
  const NOW = new Date("2026-11-09T07:00:00Z");

  it.each(Array.from(VISITOR_FALLBACK_CODES))("has its own note for %s", (code) => {
    const note = visitorFallbackNote(code, null, NOW);
    expect(note).not.toBe(VISITOR_FALLBACK_NOTE);
    expect(note).toMatch(/offline guide/);
  });

  it("gives each code a different note", () => {
    const notes = Array.from(VISITOR_FALLBACK_CODES).map((c) => visitorFallbackNote(c, null, NOW));
    expect(new Set(notes).size).toBe(notes.length);
  });

  it("names the end of busy hours for the busy-hours limits, only while it's ahead", () => {
    const ends = "2026-11-09T10:00:00.000Z";
    const q: VisitorQuota = {
      remaining: 40,
      limit: 100,
      peak: true,
      peakRemaining: 0,
      peakLimit: 25,
      peakEndsAt: ends,
    };
    const time = formatPeakTime(new Date(ends));
    expect(visitorFallbackNote("visitor_peak_limit", q, NOW)).toContain(`until ${time}`);
    expect(visitorFallbackNote("site_peak_limit", q, NOW)).toContain(`until ${time}`);
    expect(
      visitorFallbackNote("visitor_peak_limit", q, new Date("2026-11-09T11:00:00Z"))
    ).toContain("until they end");
    expect(visitorFallbackNote("visitor_limit", q, NOW)).not.toContain(time);
  });
});
