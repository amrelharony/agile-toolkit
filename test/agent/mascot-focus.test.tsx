import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

/**
 * Focus in Amr's panel has one owner, use-panel-focus (design §1.3 item 10;
 * audit panel-focus-order, autofocus-raises-keyboard). A keyboard open waits
 * on the name plate, so focus never sits on <body> while a chunk loads, then
 * moves to the view's target (the composer, on a fine pointer); a pointer
 * open leaves focus where it is; a touch screen never gets a text field
 * focused for it. Closing brings focus back to the opener (or Amr's button),
 * except after a link. While the panel is open, focus that falls from inside
 * it to the page goes to the plate, unless a click put it there.
 */

const h = vi.hoisted(() => ({
  auth: null as { status: string; user: { id: string } | null } | null,
  /** How long the owner's chat chunk takes to arrive after the panel opens. */
  chunkDelay: 0,
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
  listConversations: vi.fn(async () => []),
  loadMessages: vi.fn(async () => []),
  deleteConversation: vi.fn(async () => {}),
  renameConversation: vi.fn(async () => {}),
  createConversation: vi.fn(async () => null),
  conversationTitle: (t: string) => t,
  conversationToMarkdown: () => "",
  titleSlug: () => "thread",
}));
vi.mock("@/lib/actions/register-all", () => ({}));
vi.mock("@/components/agent/mascot/mascot-sprite", () => ({
  default: () => <div data-testid="mascot-sprite" />,
}));
vi.mock("@/components/agent/conversation-list", () => ({
  ConversationList: () => <div data-testid="conversation-list" />,
}));
vi.mock("@/components/agent/mascot/rate-limit-bar", () => ({ RateLimitBar: () => null }));
// The owner's chat is a chunk of its own: this one arrives `h.chunkDelay` ms
// after the panel opens, as a slow network would bring it.
vi.mock("@/components/agent/mascot/owner-agent-panel", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/agent/mascot/owner-agent-panel")>();
  const { useEffect, useState } = await import("react");
  type Props = Parameters<typeof actual.default>[0];
  function SlowOwnerChunk(props: Props) {
    const [ready, setReady] = useState(false);
    useEffect(() => {
      const id = setTimeout(() => setReady(true), h.chunkDelay);
      return () => clearTimeout(id);
    }, []);
    return ready ? (
      <actual.default {...props} />
    ) : (
      <div className="min-h-0 flex-1" aria-busy="true" />
    );
  }
  return { ...actual, default: SlowOwnerChunk };
});

// Loaded here, so the chunk's own import never adds to the delay above.
import "@/components/agent/mascot/owner-agent-panel";
import { MascotAssistant } from "@/components/agent/mascot/mascot-assistant";
import { VISITOR_BODY_LOADING } from "@/components/agent/mascot/lazy-visitor-body";
import { VISITOR_AI_CONSENT_KEY } from "@/components/agent/mascot/visitor-ai-consent";
import { useAgentStore } from "@/lib/agent/store";

const OWNER = { status: "authenticated", user: { id: "owner-1" } };
const VISITOR = { status: "anonymous", user: null };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A fine pointer (a mouse), or a touch screen. */
function stubPointer(coarse: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: coarse && query === "(pointer: coarse)",
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

const amr = () => screen.getByRole("button", { name: "Ask Amr" });
const plate = () => screen.getByRole("heading", { name: "Amr" });

/** Enter or Space on Amr (a click with detail 0), or a mouse or finger on him. */
function pressAmr(via: "keyboard" | "pointer") {
  fireEvent.click(amr(), { detail: via === "keyboard" ? 0 : 1 });
}

/** The tool finder has replaced the panel's loading placeholder. */
async function guideLoaded() {
  await waitFor(() => expect(screen.queryByText(VISITOR_BODY_LOADING)).toBeNull());
  return screen.getByTestId("mascot-visitor-guide");
}

/** A control on the page, outside the panel, holding focus. */
function pageButton(name: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = name;
  document.body.appendChild(button);
  return button;
}

const originalCloseSheet = useAgentStore.getState().closeSheet;

beforeEach(() => {
  // jsdom has no scrolling; the owner's chat scrolls its log.
  if (typeof Element.prototype.scrollTo !== "function") {
    Element.prototype.scrollTo = () => {};
  }
  h.auth = VISITOR;
  h.chunkDelay = 0;
  stubPointer(false);
  useAgentStore.getState().reset();
  useAgentStore.getState().closeSheet();
  window.localStorage.removeItem(VISITOR_AI_CONSENT_KEY);
});

afterEach(() => {
  cleanup();
  useAgentStore.setState({ closeSheet: originalCloseSheet });
  useAgentStore.getState().reset();
  useAgentStore.getState().closeSheet();
  window.localStorage.removeItem(VISITOR_AI_CONSENT_KEY);
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("a keyboard open", () => {
  it("of the owner's chat waits on the plate, never on <body>, and lands in the composer when the chunk arrives 200 ms later", async () => {
    h.auth = OWNER;
    h.chunkDelay = 200;
    render(<MascotAssistant />);
    const fell = vi.fn();
    const watch = (e: FocusEvent) => {
      if (!e.relatedTarget) fell();
    };
    document.addEventListener("focusout", watch);
    try {
      pressAmr("keyboard");
      // At once, before any chunk: the plate, the dialog's title.
      expect(plate()).toHaveFocus();
      expect(document.activeElement).not.toBe(document.body);

      // Halfway: the chat hasn't arrived, and focus still waits on the plate.
      await act(() => sleep(100));
      expect(screen.queryByLabelText("Message")).toBeNull();
      expect(plate()).toHaveFocus();

      const box = await screen.findByLabelText("Message", undefined, { timeout: 2000 });
      await waitFor(() => expect(box).toHaveFocus());
      // Focus moved from the plate to the composer and never fell to the page.
      expect(fell).not.toHaveBeenCalled();
      const dialog = screen.getByRole("dialog", { name: "Amr" });
      expect(dialog).not.toHaveFocus();
      expect(screen.getByRole("log")).not.toHaveFocus();
    } finally {
      document.removeEventListener("focusout", watch);
    }
  });

  it("of the tool finder focuses the name plate, and leaves it there", async () => {
    render(<MascotAssistant />);
    pressAmr("keyboard");
    expect(plate()).toHaveFocus();
    await guideLoaded();
    expect(plate()).toHaveFocus();
    expect(plate()).toHaveAttribute("tabindex", "-1");
    // The search would raise a phone's keyboard: never on open.
    expect(screen.getByLabelText("What do you need to do?")).not.toHaveFocus();
  });

  it("from Ctrl/Cmd+J focuses the plate too", async () => {
    const opener = pageButton("Somewhere");
    opener.focus();
    render(<MascotAssistant />);
    fireEvent.keyDown(opener, { key: "j", ctrlKey: true });
    expect(plate()).toHaveFocus();
    await guideLoaded();
    expect(plate()).toHaveFocus();
  });
});

describe("a pointer open", () => {
  it("of the owner's chat on a fine pointer focuses the composer", async () => {
    h.auth = OWNER;
    render(<MascotAssistant />);
    amr().focus();
    pressAmr("pointer");
    const box = await screen.findByLabelText("Message");
    await waitFor(() => expect(box).toHaveFocus());
  });

  it("of the tool finder leaves focus where it was", async () => {
    render(<MascotAssistant />);
    amr().focus();
    pressAmr("pointer");
    await guideLoaded();
    await act(() => sleep(20));
    expect(amr()).toHaveFocus();
    expect(plate()).not.toHaveFocus();
  });
});

describe("closing", () => {
  it("with the Close button brings focus back to the opener", async () => {
    const opener = pageButton("Somewhere");
    opener.focus();
    render(<MascotAssistant />);
    fireEvent.keyDown(opener, { key: "j", ctrlKey: true });
    await guideLoaded();
    expect(plate()).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Close assistant" }));
    expect(screen.queryByRole("dialog", { name: "Amr" })).toBeNull();
    expect(opener).toHaveFocus();
  });

  it("with Escape brings focus back to the opener", async () => {
    const opener = pageButton("Somewhere");
    opener.focus();
    render(<MascotAssistant />);
    fireEvent.keyDown(opener, { key: "J", metaKey: true });
    await guideLoaded();

    fireEvent.keyDown(plate(), { key: "Escape" });
    expect(useAgentStore.getState().open).toBe(false);
    expect(opener).toHaveFocus();
  });

  it("with Ctrl/Cmd+J from inside the panel brings focus back to the opener", async () => {
    const opener = pageButton("Somewhere");
    opener.focus();
    render(<MascotAssistant />);
    fireEvent.keyDown(opener, { key: "j", ctrlKey: true });
    await guideLoaded();

    fireEvent.keyDown(plate(), { key: "j", ctrlKey: true });
    expect(useAgentStore.getState().open).toBe(false);
    expect(opener).toHaveFocus();
  });

  it("falls back to Amr's button when nothing held focus at the open", async () => {
    render(<MascotAssistant />);
    expect(document.body).toHaveFocus();
    fireEvent.keyDown(document.body, { key: "j", ctrlKey: true });
    await guideLoaded();
    expect(plate()).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Close assistant" }));
    expect(amr()).toHaveFocus();
  });

  it("falls back to Amr's button when the opener has gone", async () => {
    const opener = pageButton("Somewhere");
    opener.focus();
    render(<MascotAssistant />);
    fireEvent.keyDown(opener, { key: "j", ctrlKey: true });
    await guideLoaded();
    opener.remove();

    fireEvent.click(screen.getByRole("button", { name: "Close assistant" }));
    expect(amr()).toHaveFocus();
  });

  it("on a touch screen never brings focus back into a text field: Amr's button instead", async () => {
    stubPointer(true);
    const field = document.createElement("input");
    field.setAttribute("aria-label", "Page field");
    document.body.appendChild(field);
    field.focus();
    render(<MascotAssistant />);
    // Opened from code while the field held focus (Ctrl/Cmd+J skips fields).
    act(() => useAgentStore.getState().openSheet({ via: "keyboard" }));
    await guideLoaded();
    expect(plate()).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Close assistant" }));
    expect(field).not.toHaveFocus();
    expect(amr()).toHaveFocus();
  });

  it("leaves focus where the visitor has since put it", async () => {
    const opener = pageButton("Somewhere");
    const elsewhere = pageButton("Elsewhere");
    opener.focus();
    render(<MascotAssistant />);
    fireEvent.keyDown(opener, { key: "j", ctrlKey: true });
    await guideLoaded();
    elsewhere.focus();

    fireEvent.keyDown(elsewhere, { key: "j", ctrlKey: true });
    expect(useAgentStore.getState().open).toBe(false);
    expect(elsewhere).toHaveFocus();
  });

  it("by following a link brings nothing back", async () => {
    const opener = pageButton("Somewhere");
    opener.focus();
    render(<MascotAssistant />);
    fireEvent.keyDown(opener, { key: "j", ctrlKey: true });
    await guideLoaded();
    fireEvent.change(screen.getByLabelText("What do you need to do?"), {
      target: { value: "retro" },
    });
    const link = within(screen.getByRole("list", { name: "Matching tools" })).getAllByRole(
      "link"
    )[0];
    link.focus();
    // jsdom can't follow a link to another page, so the click stops short of it.
    const stay = (e: Event) => e.preventDefault();
    document.addEventListener("click", stay);
    try {
      fireEvent.click(link);
    } finally {
      document.removeEventListener("click", stay);
    }
    expect(useAgentStore.getState().open).toBe(false);
    // The next page takes focus: none goes back to the opener or to Amr.
    expect(opener).not.toHaveFocus();
    expect(amr()).not.toHaveFocus();
    expect(document.body).toHaveFocus();
  });

  it("goes through closeSheet once, however many closes arrive at once", async () => {
    const closeSheet = vi.fn(originalCloseSheet);
    useAgentStore.setState({ closeSheet });
    render(<MascotAssistant />);
    fireEvent.keyDown(document.body, { key: "j", ctrlKey: true });
    await guideLoaded();

    // The Close button, then Escape, before the panel has gone from the page.
    act(() => {
      screen.getByRole("button", { name: "Close assistant" }).click();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(closeSheet).toHaveBeenCalledTimes(1);
    expect(useAgentStore.getState().open).toBe(false);
    expect(amr()).toHaveFocus();
  });
});

describe("the safety net", () => {
  it("puts focus that falls from inside the panel to the page on the plate", async () => {
    render(<MascotAssistant />);
    pressAmr("pointer");
    const guide = await guideLoaded();
    // A control inside the panel that takes focus and then removes itself.
    const gone = document.createElement("button");
    gone.textContent = "Gone soon";
    guide.appendChild(gone);
    gone.focus();
    gone.remove();
    expect(document.body).toHaveFocus();
    await waitFor(() => expect(plate()).toHaveFocus());
  });

  it("leaves focus on the page after a click on nothing", async () => {
    render(<MascotAssistant />);
    pressAmr("pointer");
    await guideLoaded();
    const search = screen.getByLabelText("What do you need to do?");
    search.focus();
    // A press on the panel's plain text: the browser takes focus off the
    // field (jsdom doesn't, so the blur stands in for it).
    fireEvent.pointerDown(screen.getByRole("dialog", { name: "Amr" }));
    fireEvent.mouseDown(screen.getByRole("dialog", { name: "Amr" }));
    search.blur();
    await act(() => sleep(20));
    expect(document.body).toHaveFocus();
    expect(plate()).not.toHaveFocus();
  });
});
