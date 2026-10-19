import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { AuthContextValue } from "@/lib/auth/types";

/**
 * Planning Poker: leaving a local-only session (a visitor's) clears its
 * stories, so the confirmed Leave offers Undo, which re-opens the session.
 * A live room's leave stays final.
 */

const undo = vi.hoisted(() => ({
  last: null as null | { label: string; apply: () => void; revert: () => void },
}));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { label: string; apply: () => void; revert: () => void }) => {
    undo.last = a;
    a.apply();
  },
}));

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
  undo.last = null;
  h.auth = null;
  h.client.channel.mockClear();
  window.localStorage.clear();
});

function addStory(title: string) {
  fireEvent.change(screen.getByPlaceholderText("Story title…"), { target: { value: title } });
  fireEvent.click(screen.getByRole("button", { name: "Add story" }));
}

function confirmLeave() {
  fireEvent.click(screen.getByRole("button", { name: "Leave Session" }));
  const dialog = screen.getByRole("dialog", { name: "Leave this session?" });
  expect(dialog).toHaveTextContent(/2 stories/);
  expect(dialog).not.toHaveTextContent(/can't be undone/);
  fireEvent.click(within(dialog).getByRole("button", { name: "Leave session" }));
}

describe("Planning Poker leave", () => {
  it("lets a visitor undo leaving, with the stories intact", () => {
    h.auth = { status: "anonymous", user: null };
    render(<PlanningPokerClient />);
    fireEvent.click(screen.getByRole("button", { name: "Start Session" }));
    addStory("Checkout flow");
    addStory("Search filters");
    confirmLeave();

    expect(screen.getByRole("button", { name: "Start Session" })).toBeInTheDocument();
    expect(window.localStorage.getItem(LOCAL_SESSION_KEY)).toBeNull();
    expect(undo.last!.label).toBe("Left “Sprint Planning”");

    act(() => undo.last!.revert());
    expect(screen.queryByRole("button", { name: "Start Session" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Checkout flow" })).toBeInTheDocument();
    expect(screen.getByText("Search filters")).toBeInTheDocument();
    expect(window.localStorage.getItem(LOCAL_SESSION_KEY)).toContain("Search filters");
  });

  it("does not re-open the old session over a newer one", () => {
    h.auth = { status: "anonymous", user: null };
    render(<PlanningPokerClient />);
    fireEvent.click(screen.getByRole("button", { name: "Start Session" }));
    addStory("Checkout flow");
    addStory("Search filters");
    confirmLeave();

    fireEvent.click(screen.getByRole("button", { name: "Start Session" }));
    addStory("Fresh story");
    act(() => undo.last!.revert());
    expect(screen.getByRole("heading", { name: "Fresh story" })).toBeInTheDocument();
    expect(screen.queryByText("Checkout flow")).toBeNull();
  });

  it("leaves the owner's live room for good", () => {
    h.auth = { status: "authenticated", user: owner };
    render(<PlanningPokerClient />);
    fireEvent.click(screen.getByRole("button", { name: "Start Session" }));
    addStory("Checkout flow");
    fireEvent.click(screen.getByRole("button", { name: "Leave Session" }));
    fireEvent.click(screen.getByRole("button", { name: "Leave session" }));

    expect(screen.getByRole("button", { name: "Start Session" })).toBeInTheDocument();
    expect(undo.last).toBeNull();
  });
});
