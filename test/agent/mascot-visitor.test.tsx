import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// Owner state comes from useAuthOptional (via useOwnerState); the chat
// pieces that talk to Supabase / the agent API are replaced by markers so
// the test can assert they never mount for a visitor.
const h = vi.hoisted(() => ({
  auth: null as { status: string; user: { id: string } | null } | null,
  pathname: "/",
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
import { useAgentStore } from "@/lib/agent/store";
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

describe("MascotAssistant — comic reader", () => {
  beforeEach(() => {
    h.auth = null;
    useAgentStore.setState({ open: false });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // The reader's toolbar sits at the bottom of the viewport at every width,
  // so the figure's hit box would cover Download PDF on a laptop too.
  it.each([
    ["on a phone", true],
    ["on a wide screen", false],
  ])("hides the floating mascot on /agile-at-work %s", (_label, isPhone) => {
    stubPhoneWidth(isPhone);
    h.pathname = "/agile-at-work";
    render(<MascotAssistant />);
    expect(screen.queryByRole("button", { name: "Open assistant" })).toBeNull();
  });

  it.each([
    ["another page on a phone", "/kudos", true],
    ["another page on a wide screen", "/kudos", false],
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
