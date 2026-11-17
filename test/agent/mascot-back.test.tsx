import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { ConfirmPrompt, ConversationMeta } from "@/lib/agent/types";
import type { Sprint } from "@/lib/stores/workspace-types";

/**
 * The phone's Back closes Amr's full-height sheet, and links followed from it
 * close it too (design §1.3 item 9, PR 8; audits critic2-2, critic2-1).
 *
 * With a CloseWatcher (stubbed here as the browser behaves: Back closes the
 * newest watcher, and so does an Escape nothing prevented), the sheet has one,
 * History a second on top, and no history entry is added, so a link pushes
 * its page. Without one, a marker entry is pushed as the sheet opens: Back
 * leaves it and the sheet closes; a link's page replaces it; any other close
 * takes it back out with history.back(), once; and an address changed while
 * the sheet was open comes back after.
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
import {
  AmrPanelContext,
  NO_AMR_PANEL,
  type AmrPanelLayout,
} from "@/components/agent/mascot/panel-context";
import { VisitorAiConsent } from "@/components/agent/mascot/visitor-ai-consent";
import { VisitorGuide } from "@/components/agent/mascot/visitor-guide";
import { Markdown } from "@/components/agent/markdown";
import { replaceUrl } from "@/components/shared/on-search-params";
import { BACK_MARKER, URL_CHECK_MS } from "@/lib/agent/mascot/use-back-closes";
import { useAgentStore } from "@/lib/agent/store";
import { resetSelectedSprint, useSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { useLlmUiStore } from "@/lib/stores/llm-ui-store";
import { PRIVACY_TITLE } from "@/lib/site/owner";

const OWNER = { status: "authenticated", user: { id: "owner-1" } };
const VISITOR = { status: "anonymous", user: null };

const ADD: ConfirmPrompt = {
  verb: "Add card",
  title: "Retro Board",
  question: "Add a card to Retro Board?",
  detail: "Text: “flaky CI”",
  destructive: false,
};

// ── The browser around the panel ─────────────────────────────────────────

/** The app router a next/link navigates with. */
const router = {
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
};

function withRouter(ui: ReactNode) {
  return <AppRouterContext.Provider value={router}>{ui}</AppRouterContext.Provider>;
}

/**
 * CloseWatcher as the browser has it: Back closes the newest live watcher
 * (onclose), destroy() takes one away without a close, and an Escape that
 * nothing prevented is a close request too.
 */
class StubCloseWatcher {
  static live: StubCloseWatcher[] = [];
  onclose: ((event: Event) => void) | null = null;
  constructor() {
    StubCloseWatcher.live.push(this);
  }
  destroy() {
    StubCloseWatcher.live = StubCloseWatcher.live.filter((w) => w !== this);
  }
  requestClose() {
    if (!StubCloseWatcher.live.includes(this)) return;
    this.destroy();
    this.onclose?.(new Event("close"));
  }
}
const watchers = () => StubCloseWatcher.live.length;
/** The phone's Back, with a close watcher: the newest one closes. */
const pressBack = () => act(() => StubCloseWatcher.live.at(-1)?.requestClose());
/** The browser's close request for an Escape that nothing prevented. */
const escapeRequests = (e: KeyboardEvent) => {
  if (e.key === "Escape" && !e.defaultPrevented) StubCloseWatcher.live.at(-1)?.requestClose();
};
function installCloseWatcher() {
  StubCloseWatcher.live = [];
  Object.assign(window, { CloseWatcher: StubCloseWatcher });
  window.addEventListener("keydown", escapeRequests);
}

/**
 * The phone's Back with no close watcher: one step back in history, done once
 * its popstate has fired (never a clock, which a loaded run outlasts). The
 * sheet's own popstate listener was added as it opened, so it runs first, and
 * act flushes the close.
 */
async function historyBack() {
  await act(async () => {
    const popped = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true })
    );
    window.history.back();
    await popped;
  });
}

/** Long enough for the sheet's address check to have run. */
const addressChecked = () => act(() => new Promise((r) => setTimeout(r, URL_CHECK_MS + 60)));

/** A phone held upright: the panel opens as the full-height sheet. */
function uprightPhone() {
  window.innerWidth = 375;
  window.innerHeight = 812;
}

// ── The panel ────────────────────────────────────────────────────────────

const amr = () => screen.getByRole("button", { name: "Ask Amr" });
const dialog = () => screen.queryByRole("dialog", { name: "Amr" });
const isOpen = () => useAgentStore.getState().open;
const escape = (el: Element | Document) => fireEvent.keyDown(el, { key: "Escape" });

async function openToolFinder(): Promise<void> {
  h.auth = VISITOR;
  render(withRouter(<MascotAssistant />));
  fireEvent.click(amr(), { detail: 1 });
  // The visitor body is a chunk of its own: the first import can be slow.
  await waitFor(() => expect(screen.queryByText(VISITOR_BODY_LOADING)).toBeNull(), {
    timeout: 5000,
  });
  await screen.findByTestId("mascot-visitor-guide");
}

async function openOwnerChat(): Promise<HTMLElement> {
  h.auth = OWNER;
  render(withRouter(<MascotAssistant />));
  fireEvent.click(amr(), { detail: 1 });
  const box = await screen.findByLabelText("Message");
  await waitFor(() => expect(box).toHaveFocus());
  return box;
}

async function openHistory(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Conversation history" }));
  await screen.findByRole("button", { name: "Back to chat" });
}

/** The tool finder's first popular task: a link to a tool's page. */
function firstTile(): HTMLAnchorElement {
  const list = screen.getByRole("list", { name: "Popular tasks" });
  return within(list).getAllByRole("link")[0] as HTMLAnchorElement;
}

/** A change waiting for the OK; the answers it got are returned. */
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

const markerState = () => (window.history.state as Record<string, unknown> | null)?.[BACK_MARKER];

beforeEach(() => {
  if (typeof Element.prototype.scrollTo !== "function") {
    Element.prototype.scrollTo = () => {};
  }
  window.history.replaceState(null, "", "/retro");
  uprightPhone();
  for (const fn of Object.values(router)) fn.mockClear();
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
  vi.restoreAllMocks();
  useAgentStore.getState().reset();
  useAgentStore.getState().closeSheet();
  useLlmUiStore.getState().closeSettings();
  document.body.replaceChildren();
  delete (window as Window & { CloseWatcher?: unknown }).CloseWatcher;
  window.removeEventListener("keydown", escapeRequests);
  window.innerWidth = 1024;
  window.innerHeight = 768;
});

// ── With a CloseWatcher ──────────────────────────────────────────────────

describe("Back with a CloseWatcher", () => {
  beforeEach(installCloseWatcher);

  it("closes the sheet, and the sheet adds no history entry", async () => {
    const entries = window.history.length;
    await openToolFinder();
    expect(dialog()).toHaveAttribute("data-amr-layout", "sheet");
    expect(watchers()).toBe(1);
    expect(window.history.length).toBe(entries);

    pressBack();
    expect(isOpen()).toBe(false);
    expect(dialog()).toBeNull();
    expect(watchers()).toBe(0);
  });

  it("lets a link push its page (there is no marker to replace), and closes the sheet", async () => {
    await openToolFinder();
    const tile = firstTile();
    const href = tile.getAttribute("href");
    fireEvent.click(tile);

    expect(router.push).toHaveBeenCalledWith(href, expect.anything());
    expect(router.replace).not.toHaveBeenCalled();
    expect(isOpen()).toBe(false);
    expect(watchers()).toBe(0);
  });

  it("nests a second watcher while History shows: Back leaves History, then closes", async () => {
    await openOwnerChat();
    expect(watchers()).toBe(1);
    await openHistory();
    expect(watchers()).toBe(2);

    pressBack();
    expect(screen.queryByRole("button", { name: "Back to chat" })).toBeNull();
    expect(screen.getByRole("button", { name: "Conversation history" })).toBeInTheDocument();
    expect(isOpen()).toBe(true);
    expect(watchers()).toBe(1);

    pressBack();
    expect(isOpen()).toBe(false);
    expect(watchers()).toBe(0);
  });

  it("leaves Escape in History to the panel: History goes, the sheet stays open", async () => {
    await openOwnerChat();
    await openHistory();
    const row = await screen.findByRole("button", { name: /Sprint plan/ });
    row.focus();

    // Prevented by the panel, so the watchers never hear it.
    expect(escape(row)).toBe(false);
    expect(screen.queryByRole("button", { name: "Back to chat" })).toBeNull();
    expect(isOpen()).toBe(true);
    expect(watchers()).toBe(1);
  });

  it("denies a waiting card on Escape, and the sheet stays open", async () => {
    const box = await openOwnerChat();
    const answers = cardWaits();

    expect(escape(box)).toBe(false);
    expect(answers).toEqual([false]);
    expect(isOpen()).toBe(true);
    expect(watchers()).toBe(1);
  });

  it("closes the sheet for AI settings with no step back in history", async () => {
    const back = vi.spyOn(window.history, "back");
    await openToolFinder();
    fireEvent.click(screen.getByRole("button", { name: "AI settings" }));
    expect(isOpen()).toBe(false);
    expect(useLlmUiStore.getState().settingsOpen).toBe(true);
    expect(watchers()).toBe(0);
    expect(back).not.toHaveBeenCalled();
  });

  it("makes no watcher beside a floating panel (a wide screen)", async () => {
    window.innerWidth = 1280;
    window.innerHeight = 800;
    await openToolFinder();
    expect(dialog()).toHaveAttribute("data-amr-layout", "float");
    expect(watchers()).toBe(0);
  });
});

// ── Without one: the history marker ──────────────────────────────────────

describe("Back with the history marker (no CloseWatcher)", () => {
  it("pushes one marker as the sheet opens, at the same address; Back closes the sheet", async () => {
    const entries = window.history.length;
    await openToolFinder();
    expect(window.history.length).toBe(entries + 1);
    expect(markerState()).toEqual(expect.any(String));
    expect(window.location.pathname).toBe("/retro");

    await historyBack();
    expect(isOpen()).toBe(false);
    expect(dialog()).toBeNull();
    expect(window.location.pathname).toBe("/retro");
  });

  it("has a link's page replace the marker, and calls no history.back()", async () => {
    const back = vi.spyOn(window.history, "back");
    await openToolFinder();
    const tile = firstTile();
    const href = tile.getAttribute("href");
    fireEvent.click(tile);

    expect(router.replace).toHaveBeenCalledWith(href, expect.anything());
    expect(router.push).not.toHaveBeenCalled();
    expect(isOpen()).toBe(false);
    await act(() => new Promise((r) => setTimeout(r, 30)));
    expect(back).not.toHaveBeenCalled();
  });

  it("after replaceUrl() while open, Close calls history.back() exactly once and the newest address stays", async () => {
    const back = vi.spyOn(window.history, "back");
    await openToolFinder();
    // A tool keeps its query in the address (replaceUrl writes a null state).
    act(() => replaceUrl(new URL("/retro?board=b2", window.location.href)));
    await addressChecked();
    expect(markerState()).toEqual(expect.any(String)); // flagged again

    fireEvent.click(screen.getByRole("button", { name: "Close assistant" }));
    expect(isOpen()).toBe(false);
    // Closing again, any way, takes nothing more out of history.
    act(() => useAgentStore.getState().closeSheet());
    escape(document.body);
    expect(back).toHaveBeenCalledTimes(1);

    // Back lands on the entry under the marker, and the newest address comes back.
    await waitFor(() => expect(markerState()).toBeUndefined());
    expect(window.location.search).toBe("?board=b2");
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("keeps the sprint selected after Back (popstate), address and all", async () => {
    const sprint = (id: string): Sprint => ({
      id,
      name: `Sprint ${id}`,
      startDate: "2026-11-02",
      endDate: "2026-11-13",
      pointsPlanned: 20,
      status: "active",
    });
    useWorkspaceStore.setState({ sprints: [sprint("s1"), sprint("s2")], sprintSeries: [] });
    resetSelectedSprint();
    window.history.replaceState(null, "", "/burnup?sprint=s1");

    function Picker() {
      const { selected, select } = useSelectedSprint();
      return (
        <button type="button" onClick={() => select("s2")}>
          {`On ${selected?.id ?? "none"}`}
        </button>
      );
    }
    try {
      h.auth = VISITOR;
      render(
        withRouter(
          <>
            <Picker />
            <MascotAssistant />
          </>
        )
      );
      expect(screen.getByRole("button", { name: "On s1" })).toBeInTheDocument();
      fireEvent.click(amr(), { detail: 1 });
      await screen.findByTestId("mascot-visitor-guide", undefined, { timeout: 5000 });

      // Amr (or the visitor) picks another sprint while the sheet is open.
      fireEvent.click(screen.getByRole("button", { name: "On s1" }));
      expect(window.location.search).toBe("?sprint=s2");
      await addressChecked();

      await historyBack();
      expect(isOpen()).toBe(false);
      expect(screen.getByRole("button", { name: "On s2" })).toBeInTheDocument();
      // The address still names it, so a refresh opens on it too.
      await waitFor(() => expect(window.location.search).toBe("?sprint=s2"));
      cleanup();
      resetSelectedSprint();
      window.localStorage.clear();
      render(<Picker />);
      expect(screen.getByRole("button", { name: "On s2" })).toBeInTheDocument();
    } finally {
      useWorkspaceStore.setState({ sprints: [], sprintSeries: [] });
      resetSelectedSprint();
      window.localStorage.clear();
    }
  });

  it("leaves a marker behind when a page goes over it, and covers the new page with a fresh one", async () => {
    const back = vi.spyOn(window.history, "back");
    await openToolFinder();
    const entries = window.history.length;
    // A link outside the sheet (the site header) pushes a page.
    act(() => window.history.pushState({}, "", "/kudos"));
    await addressChecked();
    expect(window.history.length).toBe(entries + 2);
    expect(window.location.pathname).toBe("/kudos");
    expect(markerState()).toEqual(expect.any(String));

    // Close takes out the fresh marker only: the visitor stays on the new page.
    fireEvent.click(screen.getByRole("button", { name: "Close assistant" }));
    expect(back).toHaveBeenCalledTimes(1);
    await act(() => new Promise((r) => setTimeout(r, 30)));
    expect(window.location.pathname).toBe("/kudos");
  });

  it("takes the marker out once when AI settings opens over the sheet: a dialog, not a page", async () => {
    const back = vi.spyOn(window.history, "back");
    await openToolFinder();
    expect(markerState()).toEqual(expect.any(String));
    fireEvent.click(screen.getByRole("button", { name: "AI settings" }));
    expect(isOpen()).toBe(false);
    expect(useLlmUiStore.getState().settingsOpen).toBe(true);
    expect(back).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
    // Back's next press leaves the page, not a marker left at the same address.
    await waitFor(() => expect(markerState()).toBeUndefined());
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("takes the marker out once for Escape as well", async () => {
    const back = vi.spyOn(window.history, "back");
    const box = await openOwnerChat();
    expect(escape(box)).toBe(false);
    expect(isOpen()).toBe(false);
    expect(back).toHaveBeenCalledTimes(1);
  });
});

// ── Links in the panel's views ───────────────────────────────────────────

describe("links close the sheet through the panel context", () => {
  function inPanel(layout: AmrPanelLayout, replaceOnNavigate: boolean, ui: ReactNode) {
    const onNavigate = vi.fn();
    render(
      withRouter(
        <AmrPanelContext.Provider
          value={{ ...NO_AMR_PANEL, layout, onNavigate, replaceOnNavigate }}
        >
          {ui}
        </AmrPanelContext.Provider>
      )
    );
    return onNavigate;
  }

  it("a link in Amr's answer, in the sheet with the marker on top: closes and replaces", () => {
    const onNavigate = inPanel("sheet", true, <Markdown source="Open [Retro](/retro) now." />);
    fireEvent.click(screen.getByRole("link", { name: "Retro" }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith("/retro", expect.anything());
    expect(router.push).not.toHaveBeenCalled();
  });

  it("a link in Amr's answer, in the sheet with a CloseWatcher: closes and pushes", () => {
    const onNavigate = inPanel("sheet", false, <Markdown source="Open [Retro](/retro) now." />);
    fireEvent.click(screen.getByRole("link", { name: "Retro" }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith("/retro", expect.anything());
  });

  it("a link in Amr's answer beside a floating panel: the chat stays open", () => {
    const onNavigate = inPanel("float", false, <Markdown source="Open [Retro](/retro) now." />);
    fireEvent.click(screen.getByRole("link", { name: "Retro" }));
    expect(onNavigate).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith("/retro", expect.anything());
  });

  it("the consent card's privacy link closes through the context and replaces the marker", () => {
    const onNavigate = inPanel(
      "sheet",
      true,
      <VisitorAiConsent question="" onAgree={() => {}} onDecline={() => {}} />
    );
    const link = screen.getByRole("link", { name: PRIVACY_TITLE });
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith(link.getAttribute("href"), expect.anything());
  });

  it("a tool picked in the tool finder closes through the context and replaces the marker", () => {
    const onNavigate = inPanel("sheet", true, <VisitorGuide />);
    const tile = firstTile();
    fireEvent.click(tile);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith(tile.getAttribute("href"), expect.anything());
    expect(router.push).not.toHaveBeenCalled();
  });
});
