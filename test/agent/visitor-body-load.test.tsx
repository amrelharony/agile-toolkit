import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { VisitorBodyProps } from "@/components/agent/mascot/visitor-body";

/**
 * The open panel's visitor views are a chunk of their own (visitor-body), so
 * Amr's chunk, which every page loads, stays small. mascot-assistant fetches
 * it ahead: once the browser is idle after Amr mounts, and when a pointer, a
 * finger or focus first reaches him; never before auth settles, never for the
 * owner, never with Data Saver on. lazy-visitor-body loads it, holds its place while it comes, and
 * offers Try again when it can't load.
 *
 * The prefetch is watched through a spy in place of prefetchVisitorBody (the
 * rest of lazy-visitor-body is real). The body itself is a stand-in whose
 * import can be held back or made to fail.
 */

type Auth = { status: string; user: { id: string } | null } | null;

const h = vi.hoisted(() => ({
  auth: null as Auth,
  prefetch: vi.fn(),
  /** Holds the body's import back until it resolves. */
  gate: null as Promise<void> | null,
  /** The body's import fails (offline, or a deploy since the page loaded). */
  fail: false,
  /** How many times the body's module was imported. */
  imports: 0,
}));

vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => h.auth }));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("@/lib/agent/client", () => ({ abortInFlight: vi.fn() }));
vi.mock("@/lib/actions/register-all", () => ({}));
vi.mock("@/components/agent/mascot/mascot-sprite", () => ({
  default: () => <div data-testid="mascot-sprite" />,
}));
vi.mock("@/components/agent/agent-conversation", () => ({
  AgentConversation: () => <div data-testid="agent-conversation" />,
}));
vi.mock("@/components/agent/mascot/rate-limit-bar", () => ({
  RateLimitBar: () => null,
}));
vi.mock("@/components/agent/mascot/lazy-visitor-body", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/agent/mascot/lazy-visitor-body")>()),
  prefetchVisitorBody: h.prefetch,
}));
/** The body's stand-in, imported through the gate and the failure switch. */
const visitorBody = vi.hoisted(() => async () => {
  h.imports++;
  if (h.gate) await h.gate;
  if (h.fail) throw new Error("Loading chunk visitor-body failed");
  return {
    VisitorBody: ({ ai, note }: VisitorBodyProps) => (
      <div data-testid="visitor-body">
        {ai ? "Visitor panel" : "Tool finder"}
        {note}
      </div>
    ),
  };
});
vi.mock("@/components/agent/mascot/visitor-body", visitorBody);

import { MascotAssistant } from "@/components/agent/mascot/mascot-assistant";
import { AMR_PANEL_TITLE_ID } from "@/components/agent/mascot/panel-header";
import { useAgentStore } from "@/lib/agent/store";

const VISITOR = { status: "anonymous", user: null };
const OWNER = { status: "authenticated", user: { id: "u1" } };

const amrButton = () => screen.getByRole("button", { name: "Ask Amr" });

/** Collects requestIdleCallback callbacks, so the test decides when the browser is idle. */
function stubIdle() {
  const callbacks: Array<() => void> = [];
  vi.stubGlobal("requestIdleCallback", (cb: () => void) => callbacks.push(cb));
  vi.stubGlobal("cancelIdleCallback", vi.fn());
  return () => act(() => callbacks.splice(0).forEach((cb) => cb()));
}

function stubSaveData(saveData: boolean) {
  Object.defineProperty(navigator, "connection", {
    configurable: true,
    value: { saveData },
  });
}

beforeEach(() => {
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
  h.auth = VISITOR;
  h.prefetch.mockClear();
  h.gate = null;
  h.fail = false;
  h.imports = 0;
  vi.stubGlobal("fetch", vi.fn());
  useAgentStore.setState({ open: false });
});

afterEach(() => {
  useAgentStore.getState().reset();
  useAgentStore.setState({ open: false });
  delete (navigator as { connection?: unknown }).connection;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("MascotAssistant fetches the visitor body ahead", () => {
  it("once the browser is idle after Amr mounts", () => {
    const idle = stubIdle();
    render(<MascotAssistant />);
    expect(document.readyState).toBe("complete");
    expect(h.prefetch).not.toHaveBeenCalled();

    idle();
    expect(h.prefetch).toHaveBeenCalledTimes(1);
  });

  it("after a short wait where the browser has no idle callback", () => {
    vi.useFakeTimers();
    render(<MascotAssistant />);
    expect(h.prefetch).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1500));
    expect(h.prefetch).toHaveBeenCalledTimes(1);
  });

  it("when a pointer, a finger or focus first reaches Amr", () => {
    stubIdle(); // never idle here
    render(<MascotAssistant />);
    expect(h.prefetch).not.toHaveBeenCalled();

    fireEvent.pointerEnter(amrButton());
    expect(h.prefetch).toHaveBeenCalledTimes(1);
    fireEvent.touchStart(amrButton());
    expect(h.prefetch).toHaveBeenCalledTimes(2);
    fireEvent.focus(amrButton());
    expect(h.prefetch).toHaveBeenCalledTimes(3);
  });

  it("not before auth has settled, and never for the owner", () => {
    const idle = stubIdle();
    h.auth = { status: "loading", user: null };
    const { rerender } = render(<MascotAssistant />);
    idle();
    expect(h.prefetch).not.toHaveBeenCalled();
    // Reaching for him while it's still loading: isOwner reads false then, and
    // this may yet be the owner.
    fireEvent.pointerEnter(amrButton());
    fireEvent.touchStart(amrButton());
    fireEvent.focus(amrButton());
    expect(h.prefetch).not.toHaveBeenCalled();

    h.auth = OWNER;
    rerender(<MascotAssistant />);
    idle();
    fireEvent.pointerEnter(amrButton());
    fireEvent.touchStart(amrButton());
    fireEvent.focus(amrButton());
    expect(h.prefetch).not.toHaveBeenCalled();
  });

  it("reaching for Amr fetches it once auth settles on a visitor", () => {
    stubIdle(); // never idle here
    h.auth = { status: "loading", user: null };
    const { rerender } = render(<MascotAssistant />);
    fireEvent.pointerEnter(amrButton());
    expect(h.prefetch).not.toHaveBeenCalled();

    h.auth = VISITOR;
    rerender(<MascotAssistant />);
    fireEvent.pointerEnter(amrButton());
    expect(h.prefetch).toHaveBeenCalledTimes(1);
  });

  it("never with Data Saver on: the body loads when the panel opens", async () => {
    stubSaveData(true);
    const idle = stubIdle();
    render(<MascotAssistant />);
    idle();
    fireEvent.pointerEnter(amrButton());
    fireEvent.touchStart(amrButton());
    fireEvent.focus(amrButton());
    expect(h.prefetch).not.toHaveBeenCalled();

    act(() => useAgentStore.setState({ open: true }));
    expect(await screen.findByTestId("visitor-body")).toHaveTextContent("Tool finder");
  });
});

describe("LazyVisitorBody", () => {
  // A fresh loader (the real one, not the spied one above) and a fresh body
  // each time: the loader keeps the body it loaded for the module's life, and
  // a mock keeps the module it made.
  async function freshLoader() {
    vi.resetModules();
    vi.doUnmock("@/components/agent/mascot/lazy-visitor-body");
    vi.doMock("@/components/agent/mascot/visitor-body", visitorBody);
    // The announcer too: the fresh loader reads a fresh announcer's context.
    const { LiveAnnouncerProvider } = await import("@/components/a11y/live-announcer");
    return {
      ...(await import("@/components/agent/mascot/lazy-visitor-body")),
      LiveAnnouncerProvider,
    };
  }

  it("holds the body's place with a named placeholder until it arrives, then draws it at once", async () => {
    const { LazyVisitorBody, VISITOR_BODY_LOADING } = await freshLoader();
    let release = () => {};
    h.gate = new Promise<void>((resolve) => (release = resolve));
    const first = render(<LazyVisitorBody ai={false} onNavigate={() => {}} />);

    // The panel keeps its size: the placeholder fills the body's place.
    const loading = screen.getByText(VISITOR_BODY_LOADING);
    expect(loading).toHaveClass("sr-only");
    expect(loading.parentElement).toHaveAttribute("aria-busy", "true");
    expect(loading.parentElement).toHaveClass("h-full");
    expect(screen.queryByTestId("visitor-body")).toBeNull();

    release();
    expect(await screen.findByTestId("visitor-body")).toHaveTextContent("Tool finder");
    expect(screen.queryByText(VISITOR_BODY_LOADING)).toBeNull();

    // Opened again: drawn in the same render, with no placeholder first.
    first.unmount();
    render(<LazyVisitorBody ai onNavigate={() => {}} note={<p>A note</p>} />);
    expect(screen.getByTestId("visitor-body")).toHaveTextContent("Visitor panel");
    expect(screen.getByText("A note")).toBeInTheDocument();
    expect(h.imports).toBe(1);
  });

  it("shares one import between the prefetch and the panel", async () => {
    const { LazyVisitorBody, loadVisitorBody } = await freshLoader();
    const prefetched = loadVisitorBody();
    expect(loadVisitorBody()).toBe(prefetched);
    await prefetched;
    render(<LazyVisitorBody ai={false} onNavigate={() => {}} />);
    expect(screen.getByTestId("visitor-body")).toBeInTheDocument();
    expect(h.imports).toBe(1);
  });

  it("says so in narration when the body can't load, and Try again imports it again", async () => {
    const { LazyVisitorBody, LiveAnnouncerProvider, VISITOR_BODY_LOAD_NOTE } = await freshLoader();
    h.fail = true;
    render(
      <LiveAnnouncerProvider>
        <LazyVisitorBody ai={false} onNavigate={() => {}} />
      </LiveAnnouncerProvider>
    );

    const note = await screen.findByText(VISITOR_BODY_LOAD_NOTE);
    // The narrator's line, with the danger line; never an Amr line.
    const caption = note.closest(".comic-caption");
    expect(caption).toHaveAttribute("data-voice", "narration");
    expect(caption).toHaveAttribute("data-tone", "error");
    expect(VISITOR_BODY_LOAD_NOTE).not.toMatch(/\b(I|me|my)\b/i);
    await waitFor(() =>
      expect(screen.getByTestId("live-assertive")).toHaveTextContent(VISITOR_BODY_LOAD_NOTE)
    );

    h.fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("visitor-body")).toBeInTheDocument();
    // The caption goes (the announcer keeps its last line, unseen).
    expect(document.querySelector(".comic-caption")).toBeNull();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(h.imports).toBe(2);
  });

  it("keeps focus in the panel when Try again goes: on the name plate, then the next Try again", async () => {
    const { LazyVisitorBody, LiveAnnouncerProvider } = await freshLoader();
    h.fail = true;
    render(
      <LiveAnnouncerProvider>
        <h2 id={AMR_PANEL_TITLE_ID} tabIndex={-1}>
          Amr
        </h2>
        <LazyVisitorBody ai={false} onNavigate={() => {}} />
      </LiveAnnouncerProvider>
    );
    const plate = screen.getByRole("heading", { name: "Amr" });

    // Pressed with focus on it: the button goes, focus waits on the plate.
    const first = await screen.findByRole("button", { name: "Try again" });
    first.focus();
    fireEvent.click(first);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(plate).toHaveFocus();

    // It fails again: the new Try again takes focus back.
    const second = await screen.findByRole("button", { name: "Try again" });
    expect(second).not.toBe(first);
    await waitFor(() => expect(second).toHaveFocus());

    // It loads: focus stays on the plate, never the page.
    h.fail = false;
    fireEvent.click(second);
    expect(await screen.findByTestId("visitor-body")).toBeInTheDocument();
    expect(plate).toHaveFocus();
    expect(document.activeElement).not.toBe(document.body);
    expect(h.imports).toBe(3);
  });

  it("leaves focus alone after a failed retry when the visitor has moved it on", async () => {
    const { LazyVisitorBody } = await freshLoader();
    h.fail = true;
    let release = () => {};
    render(
      <>
        <h2 id={AMR_PANEL_TITLE_ID} tabIndex={-1}>
          Amr
        </h2>
        <input aria-label="Elsewhere" />
        <LazyVisitorBody ai={false} onNavigate={() => {}} />
      </>
    );
    const first = await screen.findByRole("button", { name: "Try again" });
    // The retry is held back, so focus can move on before it fails.
    h.gate = new Promise<void>((resolve) => (release = resolve));
    first.focus();
    fireEvent.click(first);
    const elsewhere = screen.getByLabelText("Elsewhere");
    elsewhere.focus();

    release();
    await screen.findByRole("button", { name: "Try again" });
    expect(elsewhere).toHaveFocus();
  });
});
