import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Suspense, lazy } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

/**
 * When a part of Amr crashes, it stops at him (audit critic1-1, critic1-2):
 * - his figure: its own boundary, and the "Ask Amr" plate takes his spot,
 *   still dragged and moved by Move Amr and the arrow keys;
 * - his panel's body: a narration caption inside the panel with Reload page
 *   (and, for the owner, Start a new chat), the header left working;
 * - the owner's chat chunk: tried once more, then the same caption;
 * - anything else in him: the app shell's last resort keeps his plate up, and
 *   a tap tries him again, or reloads the page when his code never loaded.
 * Never the app's full-screen error, and never a blank panel while loading.
 */

const h = vi.hoisted(() => ({
  auth: null as { status: string; user: { id: string } | null } | null,
  chatCrash: false,
  visitorCrash: false,
  amrCrash: false,
}));

vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => h.auth }));
vi.mock("next/navigation", () => ({ usePathname: () => "/retro" }));
vi.mock("@/lib/agent/client", () => ({ abortInFlight: vi.fn() }));
vi.mock("@/lib/actions/register-all", () => ({}));
vi.mock("@/components/agent/mascot/mascot-sprite", () => ({
  default: () => <div data-testid="mascot-sprite" />,
}));
// The owner's chat: a saved reply that crashes it when drawn, with `chatCrash`.
vi.mock("@/components/agent/agent-conversation", () => ({
  AgentConversation: () => {
    if (h.chatCrash) throw new Error("A reply that can't be drawn");
    return <div data-testid="agent-conversation" />;
  },
}));
vi.mock("@/components/agent/conversation-list", () => ({
  ConversationList: () => <div data-testid="conversation-list" />,
}));
vi.mock("@/components/agent/mascot/rate-limit-bar", () => ({ RateLimitBar: () => null }));
// The visitor's tool finder, crashing with `visitorCrash`.
vi.mock("@/components/agent/mascot/lazy-visitor-body", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/agent/mascot/lazy-visitor-body")>();
  return {
    ...actual,
    LazyVisitorBody: (props: Parameters<typeof actual.LazyVisitorBody>[0]) => {
      if (h.visitorCrash) throw new Error("The tool finder broke");
      return <actual.LazyVisitorBody {...props} />;
    },
  };
});

// Loaded here, so the owner chunk's first import never runs out a test's clock.
import "@/components/agent/mascot/owner-agent-panel";
import {
  MascotAssistant,
  type LoadOwnerPanel,
  type LoadSprite,
} from "@/components/agent/mascot/mascot-assistant";
import {
  PANEL_FAILED_NOTE,
  PANEL_FAILED_OWNER_NOTE,
  PANEL_LOADING,
  PanelFailed,
  PanelLoading,
} from "@/components/agent/mascot/panel-parts";
import { AmrBoundary } from "@/components/layout/amr-boundary";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { useAgentStore } from "@/lib/agent/store";
import { useMascotStore } from "@/lib/agent/mascot/store";

const OWNER = { status: "authenticated", user: { id: "u1" } };
const VISITOR = { status: "anonymous", user: null };

/** A crash, a lazy import and a retry: room to settle on a busy machine. */
const SETTLE = { timeout: 5000 };
const SLOW = 20_000;

const amrButton = () => screen.getByRole("button", { name: "Ask Amr" });
const dialog = () => screen.getByRole("dialog", { name: "Amr" });

/** Amr after the tool page, as the app shell has him. */
function renderOnPage(amr = <MascotAssistant />) {
  return render(
    <LiveAnnouncerProvider>
      <main>Retro board</main>
      {amr}
    </LiveAnnouncerProvider>
  );
}

/** The page is still there, and the app's error screen never came. */
function expectPageCarriesOn() {
  expect(screen.getByText("Retro board")).toBeInTheDocument();
  expect(screen.queryByText("Something went wrong")).toBeNull();
}

beforeEach(() => {
  h.auth = VISITOR;
  h.chatCrash = false;
  h.visitorCrash = false;
  h.amrCrash = false;
  // The crashes are on purpose: keep React's and jsdom's reports of them quiet.
  vi.spyOn(console, "error").mockImplementation(() => {});
  window.addEventListener("error", quiet);
  vi.stubGlobal("fetch", vi.fn());
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
  useAgentStore.setState({ open: false });
  useMascotStore.setState({ ready: false });
});

afterEach(() => {
  window.removeEventListener("error", quiet);
  act(() => useAgentStore.getState().reset());
  act(() => useAgentStore.setState({ open: false }));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useMascotStore.setState({ ready: false });
});

function quiet(e: ErrorEvent) {
  e.preventDefault();
}

describe("his figure crashes", { timeout: SLOW }, () => {
  it("leaves the Ask Amr plate in his spot, still dragged and moved; the page carries on", async () => {
    let crashed = 0;
    function BrokenSprite(): never {
      crashed++;
      throw new Error("The figure broke while drawn");
    }
    const loadSprite = vi.fn<LoadSprite>(
      async () => ({ default: BrokenSprite }) as unknown as Awaited<ReturnType<LoadSprite>>
    );
    renderOnPage(<MascotAssistant loadSprite={loadSprite} />);
    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });
    await waitFor(() => expect(crashed).toBeGreaterThan(0), SETTLE);

    const plate = amrButton();
    await waitFor(() => expect(plate).toHaveAttribute("data-launcher"), SETTLE);
    expect(plate).toHaveClass("comic-name-plate");
    expect(plate).toHaveTextContent("Ask Amr");
    // His figure is down (no new likeness stands in), and the page is untouched.
    expect(plate.querySelector("svg, img, canvas")).toBeNull();
    expectPageCarriesOn();

    // Dragged: carried to the top left of jsdom's 1024x768 screen and dropped.
    act(() => {
      fireEvent.pointerDown(plate, { button: 0, clientX: 0, clientY: 0 });
    });
    act(() => {
      fireEvent.pointerMove(document, { clientX: 40, clientY: 40 });
    });
    act(() => {
      fireEvent.pointerUp(document, { clientX: 40, clientY: 40 });
    });
    expect(plate.style.top).not.toBe("");
    expect(plate.style.left).toContain("safe-area-inset-left");

    // Move Amr, in his panel's More menu, takes the plate too.
    act(() => useAgentStore.setState({ open: true }));
    expect(dialog()).toHaveAttribute("data-tail", "none");
    fireEvent.keyDown(within(dialog()).getByRole("button", { name: "More" }), { key: "Enter" });
    const group = within(screen.getByRole("menu")).getByRole("group", { name: "Move Amr" });
    act(() => {
      fireEvent.click(within(group).getByRole("menuitemradio", { name: "Bottom right" }));
    });
    expect(amrButton()).toBe(plate);
    expect(plate.style.bottom).not.toBe("");
    expect(plate.style.right).toContain("safe-area-inset-right");

    // And the arrow keys on it.
    expect(fireEvent.keyDown(plate, { key: "ArrowLeft" })).toBe(false);
    expect(plate.style.left).toContain("safe-area-inset-left");
    expectPageCarriesOn();
  });
});

describe("his panel's body crashes", { timeout: SLOW }, () => {
  it("leaves the owner a narration caption in the panel, with Reload page and Start a new chat", async () => {
    h.auth = OWNER;
    h.chatCrash = true;
    useAgentStore.setState({
      open: true,
      messages: [{ id: "m1", role: "user", content: [], createdAt: "2026-11-12T08:00:00Z" }],
    });
    renderOnPage();

    const note = await screen.findByText(PANEL_FAILED_OWNER_NOTE, {}, SETTLE);
    // The narrator's line, in the third person, marked as an error, in the panel.
    const caption = note.closest(".comic-caption")!;
    expect(caption).toHaveAttribute("data-voice", "narration");
    expect(caption).toHaveAttribute("data-tone", "error");
    expect(PANEL_FAILED_OWNER_NOTE).not.toMatch(/\b(I|me|my)\b/i);
    expect(dialog()).toContainElement(note);
    // The crash took focus with it: the caption has it, so it is read.
    expect(note.closest("[tabindex='-1']")).toHaveFocus();
    const panel = within(dialog());
    expect(panel.getByRole("button", { name: "Reload page" })).toBeInTheDocument();
    // The header still works.
    expect(panel.getByRole("button", { name: "Close assistant" })).toBeInTheDocument();
    expectPageCarriesOn();

    // A new chat leaves the thread that crashed behind, and draws the chat again.
    h.chatCrash = false;
    fireEvent.click(panel.getByRole("button", { name: "Start a new chat" }));
    expect(await screen.findByTestId("agent-conversation", {}, SETTLE)).toBeInTheDocument();
    expect(useAgentStore.getState().messages).toEqual([]);
    expect(screen.queryByText(PANEL_FAILED_OWNER_NOTE)).toBeNull();
  });

  it("tries the owner's chat chunk once more, then says so; Start a new chat imports it again", async () => {
    h.auth = OWNER;
    useAgentStore.setState({ open: true });
    const load = vi
      .fn<LoadOwnerPanel>()
      .mockRejectedValueOnce(new Error("Loading chunk owner-agent-panel failed"))
      .mockRejectedValueOnce(new Error("Loading chunk owner-agent-panel failed"))
      .mockImplementation(() => import("@/components/agent/mascot/owner-agent-panel"));
    renderOnPage(<MascotAssistant loadOwnerPanel={load} />);

    // While it loads: a pen scribbles in the body's place, named for screen readers.
    const loading = screen.getByText(PANEL_LOADING);
    expect(loading).toHaveClass("sr-only");
    expect(loading.parentElement).toHaveAttribute("aria-busy", "true");
    expect(loading.parentElement).toHaveClass("min-h-0", "flex-1");
    expect(loading.parentElement!.querySelector(".ink-scribble")).not.toBeNull();

    expect(await screen.findByText(PANEL_FAILED_OWNER_NOTE, {}, SETTLE)).toBeVisible();
    expect(load).toHaveBeenCalledTimes(2);
    expectPageCarriesOn();

    fireEvent.click(within(dialog()).getByRole("button", { name: "Start a new chat" }));
    expect(await screen.findByTestId("agent-conversation", {}, SETTLE)).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("leaves a visitor the caption with Reload page only", async () => {
    h.auth = VISITOR;
    h.visitorCrash = true;
    useAgentStore.setState({ open: true });
    renderOnPage();

    const note = await screen.findByText(PANEL_FAILED_NOTE, {}, SETTLE);
    expect(note.closest(".comic-caption")).toHaveAttribute("data-voice", "narration");
    expect(PANEL_FAILED_NOTE).not.toMatch(/\b(I|me|my)\b/i);
    const panel = within(dialog());
    expect(panel.getByRole("button", { name: "Reload page" })).toBeInTheDocument();
    expect(panel.queryByRole("button", { name: "Start a new chat" })).toBeNull();
    // Amr himself is untouched.
    expect(amrButton()).toBeInTheDocument();
    expectPageCarriesOn();
  });
});

describe("the panel's parts", () => {
  it("PanelLoading: a scribble and its words for screen readers, never a likeness of him", () => {
    const { container } = render(<PanelLoading />);
    expect(screen.getByText(PANEL_LOADING)).toHaveClass("sr-only");
    expect(PANEL_LOADING).toBe("Loading Amr's chat");
    expect(container.querySelector(".ink-scribble")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector("img, canvas")).toBeNull();
  });

  it("PanelFailed: Reload page reloads the page", () => {
    const reload = vi.fn();
    render(<PanelFailed onReload={reload} />);
    fireEvent.click(screen.getByRole("button", { name: "Reload page" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("PanelFailed: announced once, assertively, when focus is kept elsewhere", async () => {
    render(
      <LiveAnnouncerProvider>
        <button type="button">Somewhere else</button>
      </LiveAnnouncerProvider>
    );
    const elsewhere = screen.getByRole("button", { name: "Somewhere else" });
    elsewhere.focus();
    render(
      <LiveAnnouncerProvider>
        <PanelFailed onNewChat={() => {}} />
      </LiveAnnouncerProvider>
    );
    expect(elsewhere).toHaveFocus();
    await waitFor(() =>
      expect(screen.getAllByTestId("live-assertive").map((n) => n.textContent)).toContain(
        PANEL_FAILED_OWNER_NOTE
      )
    );
  });
});

describe("the app shell's last resort", () => {
  function Amr() {
    if (h.amrCrash) throw new Error("Amr broke");
    return <div>Amr is back</div>;
  }

  it("keeps his plate in his corner when he crashes, and a tap tries him again with his panel open", () => {
    h.amrCrash = true;
    const reload = vi.fn();
    render(
      <>
        <main>Retro board</main>
        <AmrBoundary onReload={reload}>
          <Amr />
        </AmrBoundary>
      </>
    );
    const plate = amrButton();
    expect(plate).toHaveAttribute("data-launcher");
    expect(plate).toHaveClass("comic-name-plate", "fixed");
    expect(plate).toHaveTextContent("Ask Amr");
    expect(plate.style.bottom).toContain("safe-area-inset-bottom");
    expect(plate.style.right).toContain("safe-area-inset-right");
    expectPageCarriesOn();

    h.amrCrash = false;
    fireEvent.click(plate, { detail: 1 });
    expect(screen.getByText("Amr is back")).toBeInTheDocument();
    expect(useAgentStore.getState().open).toBe(true);
    expect(useAgentStore.getState().openedVia).toBe("pointer");
    // A crash is tried again in place: the page isn't reloaded.
    expect(reload).not.toHaveBeenCalled();
  });

  it.each([
    ["a script", Object.assign(new Error("Loading chunk 123 failed."), { name: "ChunkLoadError" })],
    ["a stylesheet", new Error("Loading CSS chunk 7 failed.\n(/_next/static/css/7.css)")],
  ])(
    "reloads the page on a tap when his code (%s) never loaded: trying in place would fail again",
    async (_what, error) => {
      // As next/dynamic loads him: one React.lazy, which keeps its rejection for good.
      const NeverLoads = lazy(() => Promise.reject(error));
      const reload = vi.fn();
      useAgentStore.setState({ open: true });
      render(
        <>
          <main>Retro board</main>
          <AmrBoundary onReload={reload}>
            <Suspense fallback={null}>
              <NeverLoads />
            </Suspense>
          </AmrBoundary>
        </>
      );
      const plate = await screen.findByRole("button", { name: "Ask Amr" }, SETTLE);
      expect(plate).toHaveAttribute("data-amr-stand-in");
      expect(useAgentStore.getState().open).toBe(false);

      fireEvent.click(plate, { detail: 1 });
      expect(reload).toHaveBeenCalledTimes(1);
      // Never a panel opened and shut again under the tap, and the plate stays up.
      expect(useAgentStore.getState().open).toBe(false);
      expect(amrButton()).toBe(plate);
      expectPageCarriesOn();
    }
  );

  it("closes a panel the crash left open: there is no panel to show while the plate stands in", () => {
    h.amrCrash = true;
    useAgentStore.setState({ open: true });
    render(
      <AmrBoundary>
        <Amr />
      </AmrBoundary>
    );
    expect(amrButton()).toBeInTheDocument();
    expect(useAgentStore.getState().open).toBe(false);
  });

  it("is around Amr in the app shell", () => {
    const shell = readFileSync(
      path.join(process.cwd(), "src/components/layout/app-shell.tsx"),
      "utf8"
    );
    expect(shell).toMatch(/<AmrBoundary>\s*<MascotAssistant \/>\s*<\/AmrBoundary>/);
  });
});
