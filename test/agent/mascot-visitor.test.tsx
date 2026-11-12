import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// Owner state comes from useAuthOptional (via useOwnerState); the chat
// pieces that talk to Supabase / the agent API are replaced by markers so
// the test can assert they never mount for a visitor.
const h = vi.hoisted(() => ({
  auth: null as { status: string; user: { id: string } | null; error?: string } | null,
  pathname: "/",
  sendVisitorMessage: vi.fn(async () => {}),
  abortVisitor: vi.fn(),
  retryVisitorTurn: vi.fn(async () => true),
  visitorGoOn: vi.fn(async () => true),
  canRetryLastTurn: vi.fn(() => true),
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
  retryVisitorTurn: h.retryVisitorTurn,
  visitorGoOn: h.visitorGoOn,
  canRetryLastTurn: h.canRetryLastTurn,
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

import { MascotAssistant, UNVERIFIED_OWNER_NOTE } from "@/components/agent/mascot/mascot-assistant";
import { VISITOR_BODY_LOADING } from "@/components/agent/mascot/lazy-visitor-body";
import {
  VISITOR_AI_CONSENT_KEY,
  VISITOR_AI_CONSENT_TEXT,
  VISITOR_AI_CONSENT_VERSION,
  VISITOR_AI_DAILY_MESSAGES,
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
import { PRIVACY_PATH, PRIVACY_TITLE } from "@/lib/site/owner";
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

/**
 * Amr, with his panel open when the store says so. The visitor views are a
 * chunk of their own (lazy-visitor-body), so this waits until they have
 * replaced the panel's loading placeholder; the owner's panel and a panel
 * still waiting on auth never show one.
 */
async function renderAmr() {
  const view = render(<MascotAssistant />);
  await waitFor(() => expect(screen.queryByText(VISITOR_BODY_LOADING)).toBeNull());
  return view;
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

  it("shows visitors the tool guide instead of the chat, with no owner requests", async () => {
    h.auth = { status: "anonymous", user: null };
    await renderAmr();

    expect(screen.getByTestId("mascot-visitor-guide")).toBeInTheDocument();
    expect(screen.queryByTestId("agent-conversation")).toBeNull();
    expect(screen.queryByTestId("conversation-list")).toBeNull();
    expect(screen.queryByTestId("rate-limit-bar")).toBeNull();
    expect(screen.queryByRole("button", { name: "New chat" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Conversation history" })).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("links visitors to AI settings, and leaves signing in to the account menu", async () => {
    h.auth = null; // no AuthProvider at all reads as a visitor too
    h.pathname = "/kudos";
    await renderAmr();

    // A sign-in a visitor can't use has no place in Amr's help panel; the
    // owner signs in from the header's account menu.
    const guide = screen.getByTestId("mascot-visitor-guide");
    expect(within(guide).queryByRole("link", { name: /sign in/i })).toBeNull();
    expect(within(guide).queryByText(/Owner sign in/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "AI settings" }));
    expect(useLlmUiStore.getState().settingsOpen).toBe(true);
    expect(useAgentStore.getState().open).toBe(false);
  });

  it("tells an owner whose check is unanswered that the chat comes back, in narration", async () => {
    h.auth = { status: "error", user: null, error: OWNER_UNVERIFIED };
    await renderAmr();

    const guide = screen.getByTestId("mascot-visitor-guide");
    const note = within(guide).getByText(UNVERIFIED_OWNER_NOTE);
    // A narration caption, not an Amr line, and in the third person.
    expect(note.closest(".comic-caption")).toHaveAttribute("data-voice", "narration");
    expect(UNVERIFIED_OWNER_NOTE).not.toMatch(/\b(I|me|my)\b/i);
    expect(screen.queryByTestId("agent-conversation")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows a confirmed visitor no owner-check note", async () => {
    h.auth = { status: "anonymous", user: null };
    await renderAmr();
    expect(screen.queryByText(UNVERIFIED_OWNER_NOTE)).toBeNull();
  });

  it("mounts neither the notice nor the chat while auth is loading", async () => {
    h.auth = { status: "loading", user: null };
    await renderAmr();

    expect(screen.queryByTestId("mascot-visitor-guide")).toBeNull();
    expect(screen.queryByTestId("agent-conversation")).toBeNull();
    expect(screen.queryByTestId("rate-limit-bar")).toBeNull();
  });

  it("lets a visitor find a tool from the panel", async () => {
    h.auth = { status: "anonymous", user: null };
    await renderAmr();

    fireEvent.change(screen.getByLabelText("What do you need to do?"), {
      target: { value: "retrospective" },
    });
    const results = screen.getByRole("list", { name: "Matching tools" });
    expect(within(results).getAllByRole("link")[0]).toHaveAttribute("href", "/retro");
  });

  it("shows a visitor how to run the tool they're on", async () => {
    h.auth = { status: "anonymous", user: null };
    h.pathname = "/wsjf";
    await renderAmr();

    const tool = screen.getByRole("region", { name: "This tool" });
    const howTo = await within(tool).findByText(/^How to run it \(\d+ steps\)$/);
    // The steps wait in a closed disclosure: the page's own guide has them too.
    expect(howTo.tagName).toBe("SUMMARY");
    expect(howTo.closest("details")).not.toHaveAttribute("open");
    expect(within(tool).getByText(/WSJF = cost of delay ÷ job size/)).toBeInTheDocument();
  });

  it("puts the tool search before the current tool's guide", async () => {
    h.auth = { status: "anonymous", user: null };
    h.pathname = "/wsjf";
    await renderAmr();

    const search = screen.getByLabelText("What do you need to do?");
    const tool = screen.getByRole("region", { name: "This tool" });
    const howTo = await within(tool).findByText(/^How to run it/);
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

  it("gives the quiet AI settings footer a 44 px target on touch", async () => {
    h.auth = { status: "anonymous", user: null };
    await renderAmr();

    const settings = screen.getByRole("button", { name: "AI settings" });
    expect(settings).toHaveClass("pointer-coarse:min-h-11");
    // A ghost button: the own-key settings are no longer the loudest control.
    expect(settings).toHaveAttribute("data-variant", "ghost");
  });

  it("hides the Cmd/Ctrl+J hint on touch screens", async () => {
    h.auth = { status: "anonymous", user: null };
    await renderAmr();

    const hint = screen.getByText(/Cmd\/Ctrl\+J/);
    expect(hint).toHaveClass("pointer-coarse:hidden");
    expect(screen.getByText("Find the right tool")).not.toHaveClass("pointer-coarse:hidden");
  });

  it("gives the owner's New chat and History buttons a 44 px target on touch", async () => {
    h.auth = OWNER;
    await renderAmr();

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
    await renderAmr();

    expect(screen.queryByTestId("mascot-visitor-guide")).toBeNull();
    // The chat is a lazily loaded chunk.
    expect(await screen.findByTestId("agent-conversation")).toBeInTheDocument();
    expect(screen.getByTestId("rate-limit-bar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New chat" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Conversation history" })).toBeInTheDocument();
  });

  it("drops the owner's conversation when the owner signs out", async () => {
    h.auth = OWNER;
    const { rerender } = await renderAmr();
    act(() => {
      useAgentStore.setState({
        messages: [{ id: "m1", role: "user", content: [], createdAt: "2026-01-01T00:00:00Z" }],
      });
    });

    h.auth = { status: "anonymous", user: null };
    rerender(<MascotAssistant />);

    expect(useAgentStore.getState().messages).toEqual([]);
    expect(await screen.findByTestId("mascot-visitor-guide")).toBeInTheDocument();
  });
});

describe("MascotAssistant — Escape", () => {
  beforeEach(() => {
    h.auth = { status: "anonymous", user: null };
    h.pathname = "/";
    vi.stubGlobal("fetch", vi.fn());
    stubPhoneWidth(false);
    useAgentStore.setState({ open: true });
  });

  afterEach(() => {
    useAgentStore.getState().reset();
    useAgentStore.setState({ open: false });
    vi.unstubAllGlobals();
  });

  const search = () => screen.getByLabelText("What do you need to do?");

  it("closes the panel", async () => {
    await renderAmr();
    fireEvent.keyDown(search(), { key: "Escape" });
    expect(useAgentStore.getState().open).toBe(false);
    expect(screen.queryByRole("dialog", { name: "Amr assistant" })).toBeNull();
  });

  it("leaves the panel open when a field inside it already used the Escape", async () => {
    await renderAmr();
    const field = search();
    // The field's own Escape (the guide's search clearing itself) runs first.
    const own = (e: KeyboardEvent) => {
      if (e.key === "Escape") e.preventDefault();
    };
    field.addEventListener("keydown", own);

    fireEvent.keyDown(field, { key: "Escape" });
    expect(useAgentStore.getState().open).toBe(true);

    // Once the field lets it through, the next Escape closes.
    field.removeEventListener("keydown", own);
    fireEvent.keyDown(field, { key: "Escape" });
    expect(useAgentStore.getState().open).toBe(false);
  });

  it("clears the tool finder's search on the first Escape, and closes on the next", async () => {
    await renderAmr();
    fireEvent.change(search(), { target: { value: "retro" } });

    fireEvent.keyDown(search(), { key: "Escape" });
    expect(search()).toHaveValue("");
    expect(useAgentStore.getState().open).toBe(true);
    expect(screen.getByRole("dialog", { name: "Amr assistant" })).toBeInTheDocument();

    fireEvent.keyDown(search(), { key: "Escape" });
    expect(useAgentStore.getState().open).toBe(false);
  });

  it("ignores an Escape that ends an input method's composition", async () => {
    await renderAmr();
    fireEvent.keyDown(search(), { key: "Escape", isComposing: true });
    expect(useAgentStore.getState().open).toBe(true);
    // Older browsers say "composing" with keyCode 229 instead.
    fireEvent.keyDown(search(), { key: "Escape", keyCode: 229 });
    expect(useAgentStore.getState().open).toBe(true);
    expect(screen.getByRole("dialog", { name: "Amr assistant" })).toBeInTheDocument();
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
    h.retryVisitorTurn.mockClear();
    h.visitorGoOn.mockClear();
    h.canRetryLastTurn.mockReset();
    h.canRetryLastTurn.mockReturnValue(true);
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

  it("with the flag off, keeps the plain guide: no AI offers and no requests", async () => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_AI", "");
    await renderAmr();
    fireEvent.change(screen.getByLabelText("What do you need to do?"), {
      target: { value: "zzqx" },
    });
    expect(screen.getByTestId("mascot-visitor-guide")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ask Amr about/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Chat with Amr" })).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("opens on the tool finder and sends nothing until the visitor agrees", async () => {
    await renderAmr();
    expect(screen.getByTestId("mascot-visitor-guide")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chat with Amr" })).toBeInTheDocument();

    askAbout("retro");
    expect(screen.getByText(/Before you chat with Amr/)).toBeInTheDocument();
    for (const line of VISITOR_AI_CONSENT_TEXT) expect(screen.getByText(line)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(h.sendVisitorMessage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.getByTestId("mascot-visitor-guide")).toBeInTheDocument();
    // The search the visitor took to the card is still in the box.
    expect(screen.getByLabelText("What do you need to do?")).toHaveValue("retro");
    expect(window.localStorage.getItem(VISITOR_AI_CONSENT_KEY)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(h.sendVisitorMessage).not.toHaveBeenCalled();
  });

  it("offers to ask Amr when the search finds nothing", async () => {
    await renderAmr();
    askAbout("zzqx");
    expect(screen.getByRole("button", { name: "Agree and ask" })).toBeInTheDocument();
  });

  it("stores the consent and asks the question once the visitor agrees", async () => {
    await renderAmr();
    askAbout("retro");
    fireEvent.click(screen.getByRole("button", { name: "Agree and ask" }));

    expect(window.localStorage.getItem(VISITOR_AI_CONSENT_KEY)).toBe("v2");
    await waitFor(() =>
      expect(h.sendVisitorMessage).toHaveBeenCalledWith("retro", { toolId: "retro" })
    );
    expect(h.sendVisitorMessage).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: "Tool finder" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear chat" })).toBeInTheDocument();
    // The runtime is mocked; the panel itself fetched nothing.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("skips the card once consent is stored, and opens an empty chat from the link", async () => {
    window.localStorage.setItem(VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION);
    await renderAmr();
    fireEvent.click(screen.getByRole("button", { name: "Chat with Amr" }));

    expect(screen.queryByText(/Before you chat with Amr/)).toBeNull();
    expect(await screen.findByRole("button", { name: "Tool finder" })).toBeInTheDocument();
    expect(screen.getByLabelText("Message")).toBeInTheDocument();
    expect(h.sendVisitorMessage).not.toHaveBeenCalled();
  });

  it("asks again when the stored consent is for an older card", async () => {
    // v1 agreed to the chat only; v2 adds the tools' Ask Amr buttons.
    expect(VISITOR_AI_CONSENT_VERSION).toBe("v2");
    for (const older of ["v0", "v1"]) {
      window.localStorage.setItem(VISITOR_AI_CONSENT_KEY, older);
      await renderAmr();
      fireEvent.click(screen.getByRole("button", { name: "Chat with Amr" }));
      expect(screen.getByText(/Before you chat with Amr/)).toBeInTheDocument();
      cleanup();
    }
  });

  it("says Agree and chat when nothing was asked, and shows a question in the visitor's caption", async () => {
    await renderAmr();
    fireEvent.click(screen.getByRole("button", { name: "Chat with Amr" }));
    expect(screen.getByRole("button", { name: "Agree and chat" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Agree and ask" })).toBeNull();
    expect(document.querySelector('[data-voice="you"]')).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    askAbout("retro");
    expect(screen.getByRole("button", { name: "Agree and ask" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Agree and chat" })).toBeNull();
    const caption = screen.getByText("retro").closest('[data-voice="you"]');
    expect(caption).not.toBeNull();
    // A screen reader hears whose words they are.
    expect(caption).toHaveTextContent("You said: retro");
  });

  // jsdom has no layout, so this checks the structure and classes.
  it("keeps the card's buttons in a footer that never scrolls, under a lettered title", async () => {
    await renderAmr();
    askAbout("retro");
    const card = screen.getByRole("region", { name: "Before you chat with Amr's AI" });
    const title = within(card).getByRole("heading", {
      level: 3,
      name: "Before you chat with Amr's AI",
    });
    expect(title).toHaveClass("font-display");
    expect(card).toHaveClass("flex", "h-full", "min-h-0", "flex-col");

    // The title, the question and the points scroll, inside the card...
    const scroller = title.closest(".overflow-y-auto");
    expect(scroller).not.toBeNull();
    expect(scroller).toHaveClass("min-h-0", "flex-1", "overscroll-contain");
    expect(scroller?.parentElement).toBe(card);
    expect(within(card).getByRole("list")).toHaveClass("ps-5");

    // ...and the buttons sit below them, in a footer that keeps its height.
    const agree = within(card).getByRole("button", { name: "Agree and ask" });
    const notNow = within(card).getByRole("button", { name: "Not now" });
    expect(scroller).not.toContainElement(agree);
    const footer = agree.parentElement;
    expect(footer?.parentElement).toBe(card);
    expect(footer).toHaveClass("shrink-0");
    expect(footer).toContainElement(notNow);
    // 44 px on touch and on narrow screens.
    for (const button of [agree, notNow]) expect(button).toHaveClass("min-h-[44px]");
  });

  it("links the privacy page from the card, and closes the panel when it is followed", async () => {
    await renderAmr();
    askAbout("retro");
    const card = screen.getByRole("region", { name: "Before you chat with Amr's AI" });
    const link = within(card).getByRole("link", { name: PRIVACY_TITLE });
    expect(link).toHaveAttribute("href", PRIVACY_PATH);
    // jsdom can't follow a link to another page, so the click stops short of it.
    const stay = (e: Event) => e.preventDefault();
    document.addEventListener("click", stay);
    try {
      fireEvent.click(link);
    } finally {
      document.removeEventListener("click", stay);
    }
    expect(useAgentStore.getState().open).toBe(false);
    // Following it agrees to nothing.
    expect(window.localStorage.getItem(VISITOR_AI_CONSENT_KEY)).toBeNull();
    expect(h.sendVisitorMessage).not.toHaveBeenCalled();
  });

  it("shows the visitor's allowance in the chat", async () => {
    window.localStorage.setItem(VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION);
    await renderAmr();
    fireEvent.click(screen.getByRole("button", { name: "Chat with Amr" }));
    await screen.findByRole("button", { name: "Tool finder" });
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

  it("goes back to the tool finder when Amr can't answer any more", async () => {
    window.localStorage.setItem(VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION);
    await renderAmr();
    fireEvent.click(screen.getByRole("button", { name: "Chat with Amr" }));
    await screen.findByRole("button", { name: "Tool finder" });

    act(() => {
      useAgentStore.getState().setVisitorFallback("visitor_limit");
    });
    expect(screen.getByTestId("mascot-visitor-guide")).toBeInTheDocument();
    expect(screen.getByText(visitorFallbackNote("visitor_limit", null))).toBeInTheDocument();
    expect(screen.queryByText(VISITOR_FALLBACK_NOTE)).toBeNull();
    expect(screen.queryByLabelText("Message")).toBeNull();
  });

  it("says when the busy hours end, in the visitor's own time, at a busy-hours limit", async () => {
    window.localStorage.setItem(VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION);
    await renderAmr();
    fireEvent.click(screen.getByRole("button", { name: "Chat with Amr" }));
    await screen.findByRole("button", { name: "Tool finder" });

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
        `You've used all your messages for these busy hours. Here's the tool finder until ${formatPeakTime(ends)}.`
      )
    ).toBeInTheDocument();
  });

  it("asking again after a fallback is a fresh try", async () => {
    window.localStorage.setItem(VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION);
    useAgentStore.setState({ visitorFallback: "site_busy" });
    await renderAmr();
    expect(screen.getByText(/Amr is too busy/)).toBeInTheDocument();

    askAbout("retro");
    expect(useAgentStore.getState().visitorFallback).toBeNull();
    await waitFor(() =>
      expect(h.sendVisitorMessage).toHaveBeenCalledWith("retro", { toolId: "retro" })
    );
  });

  it("reopening the panel mid-chat goes straight back to the chat", async () => {
    window.localStorage.setItem(VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION);
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
    await renderAmr();
    expect(await screen.findByLabelText("Message")).toBeInTheDocument();
    expect(screen.queryByTestId("mascot-visitor-guide")).toBeNull();
  });

  it("offers one primary Ask button under the search, 44 px on touch", async () => {
    await renderAmr();
    const ask = screen.getByRole("button", { name: "Chat with Amr" });
    expect(ask).toHaveClass("pointer-coarse:min-h-11", "inline-flex", "items-center");
    expect(ask).toHaveAttribute("data-variant", "default");
    // Right under the field, before the results.
    const search = screen.getByLabelText("What do you need to do?");
    expect(search.compareDocumentPosition(ask) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Typing turns the same button into the question: never two Ask buttons.
    fireEvent.change(search, { target: { value: "retro" } });
    expect(screen.getByRole("button", { name: "Ask Amr about “retro”" })).toBe(ask);
    expect(screen.queryByRole("button", { name: "Chat with Amr" })).toBeNull();
    const results = screen.getByRole("list", { name: "Matching tools" });
    expect(ask.compareDocumentPosition(results) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // jsdom has no layout, so this checks the classes, not the wrapped text.
  it("gives Ask Amr the classes that let a long search wrap, and keeps 44 px on touch", async () => {
    await renderAmr();
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
    window.localStorage.setItem(VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION);
    await renderAmr();
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
      window.localStorage.setItem(VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION);
      await renderAmr();
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
    window.localStorage.setItem(VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION);
    await renderAmr();
    fireEvent.click(screen.getByRole("button", { name: "Chat with Amr" }));
    await screen.findByRole("button", { name: "Tool finder" });
    expect(screen.queryByTestId("visitor-ai-live-room")).toBeNull();
    // Out of a room the chat offers a change and says Amr asks first.
    expect(screen.getByText(/Add a card/)).toBeInTheDocument();
    expect(screen.getByTestId("visitor-ai-quota")).toHaveTextContent(
      "Amr asks before changing anything"
    );
    // Before any answer, the allowance in the card's words: AI uses, shared
    // by the chat and the Ask Amr buttons.
    expect(screen.getByTestId("visitor-ai-quota")).toHaveTextContent(
      `${VISITOR_AI_DAILY_MESSAGES} AI uses a day`
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
    window.localStorage.setItem(VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION);
    await renderAmr();
    fireEvent.click(screen.getByRole("button", { name: "Chat with Amr" }));
    await screen.findByRole("button", { name: "Tool finder" });
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
      const view = await renderAmr();
      askAbout("retro");
      fireEvent.click(screen.getByRole("button", { name: "Agree and ask" }));
      await waitFor(() => expect(h.sendVisitorMessage).toHaveBeenCalledTimes(1));
      await screen.findByRole("button", { name: "Tool finder" });
      return view;
    }

    it("asks before a change with its verb and Not now, never Approve all", async () => {
      await openChatWithQuestion();
      act(() => {
        useAgentStore.getState().setPendingToolUse({
          toolUseId: "c1",
          actionId: "tool_retro_add_card",
          resolvedActionId: "tool.retro.add_card",
          input: { text: "flaky CI" },
          prompt: {
            verb: "Add card",
            title: "Retro Board",
            question: "Add a card to Retro Board?",
            detail: "Text: “flaky CI”",
            destructive: false,
          },
          resolve: () => {},
        });
      });
      expect(
        screen.getByRole("heading", { level: 3, name: "Add a card to Retro Board?" })
      ).toBeInTheDocument();
      expect(screen.getByText("Text: “flaky CI”")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Add card" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Not now" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /don't ask again/ })).toBeNull();
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

    /** A turn under way, as the runtime registers it: its abort is with the store. */
    function liveTurn() {
      const abortTurn = vi.fn();
      act(() => {
        useAgentStore.setState({
          chatProfile: "visitor",
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
        useAgentStore.getState().setAbortTurn(abortTurn);
      });
      return abortTurn;
    }

    /** Let effects, microtasks and timers queued by the last step run. */
    const settle = () =>
      act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

    it("Clear chat stops the answer through the store and empties the chat", async () => {
      await openChatWithQuestion();
      const abortTurn = liveTurn();
      fireEvent.click(screen.getByRole("button", { name: "Clear chat" }));
      expect(abortTurn).toHaveBeenCalledTimes(1);
      expect(abortTurn).toHaveBeenCalledWith("reset");
      expect(useAgentStore.getState().messages).toEqual([]);
      expect(useAgentStore.getState().streaming).toBe(false);
    });

    it("Tool finder goes back to the guide and the answer goes on", async () => {
      await openChatWithQuestion();
      const abortTurn = liveTurn();
      h.abortVisitor.mockClear();
      fireEvent.click(screen.getByRole("button", { name: "Tool finder" }));
      expect(screen.getByTestId("mascot-visitor-guide")).toBeInTheDocument();
      expect(screen.getByLabelText("What do you need to do?")).toHaveValue("retro");
      expect(screen.queryByLabelText("Message")).toBeNull();
      await settle();
      expect(abortTurn).not.toHaveBeenCalled();
      expect(h.abortVisitor).not.toHaveBeenCalled();
      expect(useAgentStore.getState().streaming).toBe(true);
      // Back to chat shows the answer still under way.
      fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));
      expect(await screen.findByRole("button", { name: "Stop generating" })).toBeInTheDocument();
    });

    it("keeps a new question asked from the guide mid-answer in the box, unsent", async () => {
      await openChatWithQuestion();
      const abortTurn = liveTurn();
      h.sendVisitorMessage.mockClear();
      fireEvent.click(screen.getByRole("button", { name: "Tool finder" }));
      askAbout("sprint goal");
      // The chat opens on the answer still under way, with the question waiting.
      expect(await screen.findByLabelText("Message")).toHaveValue("sprint goal");
      await settle();
      expect(h.sendVisitorMessage).not.toHaveBeenCalled();
      expect(abortTurn).not.toHaveBeenCalled();
      expect(useAgentStore.getState().drafts.visitor).toBe("sprint goal");

      // Once the answer ends, Send asks it.
      act(() => useAgentStore.setState({ streaming: false }));
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      await waitFor(() =>
        expect(h.sendVisitorMessage).toHaveBeenCalledWith("sprint goal", { toolId: "retro" })
      );
      expect(useAgentStore.getState().drafts.visitor).toBe("");
    });

    it("puts a question asked mid-answer after what the visitor had typed", async () => {
      await openChatWithQuestion();
      liveTurn();
      h.sendVisitorMessage.mockClear();
      act(() => useAgentStore.getState().setDraft("visitor", "and how long"));
      fireEvent.click(screen.getByRole("button", { name: "Tool finder" }));
      askAbout("sprint goal");
      expect(await screen.findByLabelText("Message")).toHaveValue("and how long\n\nsprint goal");
      await settle();
      expect(h.sendVisitorMessage).not.toHaveBeenCalled();
    });

    it("closing the panel mid-answer leaves the answer running", async () => {
      const view = await openChatWithQuestion();
      const abortTurn = liveTurn();
      h.abortVisitor.mockClear();
      act(() => useAgentStore.getState().closeSheet());
      expect(screen.queryByLabelText("Message")).toBeNull();
      view.unmount();
      await settle();
      expect(abortTurn).not.toHaveBeenCalled();
      expect(h.abortVisitor).not.toHaveBeenCalled();
      expect(useAgentStore.getState().streaming).toBe(true);
    });

    it("keeps what the visitor typed when the panel closes and opens again", async () => {
      await openChatWithQuestion();
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
      fireEvent.change(screen.getByLabelText("Message"), {
        target: { value: "and how long should it" },
      });
      expect(useAgentStore.getState().drafts.visitor).toBe("and how long should it");

      act(() => useAgentStore.getState().closeSheet());
      expect(screen.queryByLabelText("Message")).toBeNull();
      act(() => useAgentStore.getState().openSheet());
      expect(await screen.findByLabelText("Message")).toHaveValue("and how long should it");
    });

    it("sends the draft and empties it", async () => {
      await openChatWithQuestion();
      fireEvent.change(screen.getByLabelText("Message"), { target: { value: "what next?" } });
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      await waitFor(() =>
        expect(h.sendVisitorMessage).toHaveBeenLastCalledWith("what next?", { toolId: "retro" })
      );
      expect(screen.getByLabelText("Message")).toHaveValue("");
      expect(useAgentStore.getState().drafts.visitor).toBe("");
    });

    it("shows a note as a narration caption with Go on, which sends the visitor's own Go on", async () => {
      await openChatWithQuestion();
      act(() => {
        useAgentStore.getState().setNotice({
          tone: "note",
          kind: "cut_off",
          text: "Amr's answer was cut short. Ask him to go on.",
        });
      });
      const caption = screen
        .getByText("Amr's answer was cut short. Ask him to go on.")
        .closest('[data-voice="narration"]');
      expect(caption).toHaveAttribute("data-tone", "note");
      expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Go on" }));
      await waitFor(() => expect(h.visitorGoOn).toHaveBeenCalledWith({ toolId: "retro" }));
      // Its button goes with the notice: focus waits in the message box.
      expect(screen.getByLabelText("Message")).toHaveFocus();
    });

    it("shows an error with the danger line, and Try again only when the last turn may run again", async () => {
      await openChatWithQuestion();
      h.canRetryLastTurn.mockReturnValue(false);
      act(() => {
        useAgentStore.getState().setNotice({
          tone: "error",
          kind: "upstream_error",
          text: "Amr's AI service hit an error. Try again in a moment.",
        });
      });
      const caption = screen
        .getByText("Amr's AI service hit an error. Try again in a moment.")
        .closest('[data-voice="narration"]');
      expect(caption).toHaveAttribute("data-tone", "error");
      // The old red box is gone.
      expect(document.querySelector('[class*="bg-destructive/10"]')).toBeNull();
      // A change ran in that turn: trying again would repeat it.
      expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();

      h.canRetryLastTurn.mockReturnValue(true);
      act(() => {
        useAgentStore.getState().setNotice({
          tone: "error",
          kind: "upstream_error",
          text: "Amr's AI service hit an error. Try again in a moment.",
        });
      });
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      await waitFor(() => expect(h.retryVisitorTurn).toHaveBeenCalledWith({ toolId: "retro" }));
      expect(screen.queryByRole("button", { name: "Go on" })).toBeNull();
    });

    it("offers nothing to press for a notice that asking again won't fix, or while Amr answers", async () => {
      await openChatWithQuestion();
      act(() => {
        useAgentStore.getState().setNotice({
          tone: "error",
          kind: "too_large",
          text: "That conversation got too long to send. Clear the chat and ask again.",
        });
      });
      expect(screen.getByText(/got too long to send/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Go on" })).toBeNull();

      act(() => {
        useAgentStore.getState().setNotice({
          tone: "note",
          kind: "cut_off",
          text: "Amr's answer was cut short. Ask him to go on.",
        });
        useAgentStore.setState({ streaming: true });
      });
      expect(screen.queryByRole("button", { name: "Go on" })).toBeNull();
    });
  });

  it("never shows the owner the visitor AI", async () => {
    h.auth = OWNER;
    await renderAmr();
    expect(await screen.findByTestId("agent-conversation")).toBeInTheDocument();
    expect(screen.queryByTestId("mascot-visitor-guide")).toBeNull();
    expect(screen.queryByRole("button", { name: "Chat with Amr" })).toBeNull();
    expect(screen.queryByText(/Before you chat with Amr/)).toBeNull();
  });

  it("keeps the plain guide for an owner session that isn't verified yet", async () => {
    h.auth = { status: "error", user: null, error: OWNER_UNVERIFIED };
    await renderAmr();
    expect(screen.getByTestId("mascot-visitor-guide")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Chat with Amr" })).toBeNull();
    expect(screen.getByText(UNVERIFIED_OWNER_NOTE)).toBeInTheDocument();
  });

  it("drops the visitor's chat when the visitor turns out to be the owner", async () => {
    const { rerender } = await renderAmr();
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
    await renderAmr();
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
    expect(note).toMatch(/tool finder/);
    expect(note).not.toMatch(/offline/);
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
