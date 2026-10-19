import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { AuthContextValue } from "@/lib/auth/types";

/**
 * A public visitor gets a solo, browser-only planning-poker session: no
 * Realtime channel, no squad invite button, and copy that says so. The
 * owner's flow is unchanged.
 */

const h = vi.hoisted(() => {
  const makeChannel = () => {
    const channel = {
      on: vi.fn(() => channel),
      // Report SUBSCRIBED straight away so the host's pending session
      // commits (it waits for the room to connect).
      subscribe: vi.fn((cb?: (status: string) => void) => {
        cb?.("SUBSCRIBED");
        return channel;
      }),
      track: vi.fn(async () => "ok"),
      untrack: vi.fn(async () => "ok"),
      unsubscribe: vi.fn(async () => "ok"),
      send: vi.fn(async () => "ok"),
      presenceState: vi.fn(() => ({})),
    };
    return channel;
  };
  return {
    auth: null as Partial<AuthContextValue> | null,
    client: {
      channel: vi.fn<(name: string, opts?: unknown) => ReturnType<typeof makeChannel>>(() =>
        makeChannel()
      ),
      removeChannel: vi.fn(async () => "ok"),
    },
  };
});

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuthOptional: () => h.auth,
}));

vi.mock("@/lib/realtime/supabase-client", () => ({
  isRealtimeAvailable: () => true,
  getSupabaseClient: () => h.client,
}));

// Page chrome and the AI prompt menu are irrelevant here and pull in the
// whole app shell.
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

// Render lobby → session swaps synchronously instead of waiting on exit
// animations. Each motion.<tag> keeps its element (the voting deck is
// buttons), minus the animation-only props.
vi.mock("framer-motion", async () => {
  const React = await import("react");
  const motionProps = new Set([
    "initial",
    "animate",
    "exit",
    "transition",
    "layout",
    "whileHover",
    "whileTap",
  ]);
  const strip = (props: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(props).filter(([key]) => !motionProps.has(key)));
  const cache = new Map<string, unknown>();
  const component = (tag: string) => {
    if (!cache.has(tag)) {
      const C = React.forwardRef<HTMLElement, Record<string, unknown>>((props, ref) =>
        React.createElement(tag, { ...strip(props), ref })
      );
      C.displayName = `Motion(${tag})`;
      cache.set(tag, C);
    }
    return cache.get(tag);
  };
  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
    motion: new Proxy({}, { get: (_target, tag: string) => component(tag) }),
  };
});

import { PlanningPokerClient } from "@/app/(tools)/planning-poker/planning-poker-client";
import { LOCAL_SESSION_KEY } from "@/app/(tools)/planning-poker/local-session";

const owner = { id: "owner-1", email: "owner@example.com" } as AuthContextValue["user"];

beforeEach(() => {
  h.auth = null;
  h.client.channel.mockClear();
  // Local sessions persist to localStorage; start every test from a clean slate.
  window.localStorage.clear();
});

function addStory(title: string) {
  fireEvent.change(screen.getByPlaceholderText("Story title…"), { target: { value: title } });
  fireEvent.click(screen.getByRole("button", { name: "Add story" }));
}

describe("PlanningPokerClient for a public visitor", () => {
  it("explains how to run the session with a team on one screen", () => {
    h.auth = { status: "anonymous", user: null };
    render(<PlanningPokerClient />);
    expect(screen.getByText("Running it with your team")).toBeInTheDocument();
    expect(screen.getByText(/This session runs on your screen/)).toBeInTheDocument();
    expect(screen.queryByText(/Settings → Squads/)).toBeNull();
    expect(screen.queryByText(/workspace owner/)).toBeNull();
  });

  it("runs a browser-only session with no channel and no invite button", () => {
    h.auth = { status: "anonymous", user: null };
    render(<PlanningPokerClient />);
    fireEvent.click(screen.getByRole("button", { name: "Start Session" }));

    expect(screen.getByText("Browser-only")).toBeInTheDocument();
    // A room code nobody can join is noise.
    expect(screen.queryByText(/Room:/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Invite squad" })).toBeNull();
    expect(h.client.channel).not.toHaveBeenCalled();
  });
});

describe("PlanningPokerClient for the owner", () => {
  it("keeps the squad copy, the invite button and the live room", () => {
    h.auth = { status: "authenticated", user: owner };
    render(<PlanningPokerClient />);
    expect(screen.getByText(/Settings → Squads/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start Session" }));
    expect(screen.queryByText("Browser-only")).toBeNull();
    expect(screen.getByText(/Room:/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Invite squad" })).toBeInTheDocument();
    expect(h.client.channel).toHaveBeenCalledWith(
      expect.stringMatching(/^tool:planning-poker:room:/),
      expect.anything()
    );
  });
});

describe("PlanningPokerClient session persistence", () => {
  it("restores a visitor's local session after a remount", () => {
    h.auth = { status: "anonymous", user: null };
    const first = render(<PlanningPokerClient />);
    fireEvent.click(screen.getByRole("button", { name: "Start Session" }));
    addStory("Checkout flow");
    expect(window.localStorage.getItem(LOCAL_SESSION_KEY)).toContain("Checkout flow");
    first.unmount();

    // A refresh or a trip to another tool remounts the client.
    render(<PlanningPokerClient />);
    expect(screen.queryByRole("button", { name: "Start Session" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Checkout flow" })).toBeInTheDocument();
    expect(screen.getByText("Browser-only")).toBeInTheDocument();
    // The host can still vote in the restored session.
    expect(screen.getByRole("radiogroup", { name: "Your vote" })).toBeInTheDocument();
  });

  it("clears the stored session when the visitor confirms Leave", () => {
    h.auth = { status: "anonymous", user: null };
    const first = render(<PlanningPokerClient />);
    fireEvent.click(screen.getByRole("button", { name: "Start Session" }));
    addStory("Checkout flow");

    fireEvent.click(screen.getByRole("button", { name: "Leave Session" }));
    const dialog = screen.getByRole("dialog", { name: "Leave this session?" });
    expect(dialog).toHaveTextContent(/cleared from this browser/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Leave session" }));

    expect(screen.getByRole("button", { name: "Start Session" })).toBeInTheDocument();
    expect(window.localStorage.getItem(LOCAL_SESSION_KEY)).toBeNull();
    first.unmount();

    render(<PlanningPokerClient />);
    expect(screen.getByRole("button", { name: "Start Session" })).toBeInTheDocument();
  });

  it("never stores or restores the owner's live room", () => {
    h.auth = { status: "authenticated", user: owner };
    const first = render(<PlanningPokerClient />);
    fireEvent.click(screen.getByRole("button", { name: "Start Session" }));
    addStory("Checkout flow");
    expect(screen.getByText(/Room:/)).toBeInTheDocument();
    expect(window.localStorage.getItem(LOCAL_SESSION_KEY)).toBeNull();
    first.unmount();

    render(<PlanningPokerClient />);
    expect(screen.getByRole("button", { name: "Start Session" })).toBeInTheDocument();
  });
});
