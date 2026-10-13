import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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
// animations.
vi.mock("framer-motion", async () => {
  const React = await import("react");
  const motionProps = new Set(["initial", "animate", "exit", "transition", "layout"]);
  const strip = (props: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(props).filter(([key]) => !motionProps.has(key)));
  const Div = React.forwardRef<HTMLDivElement, Record<string, unknown>>((props, ref) =>
    React.createElement("div", { ...strip(props), ref })
  );
  Div.displayName = "MotionDiv";
  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
    motion: new Proxy({}, { get: () => Div }),
  };
});

import { PlanningPokerClient } from "@/app/(tools)/planning-poker/planning-poker-client";

const owner = { id: "owner-1", email: "owner@example.com" } as AuthContextValue["user"];

beforeEach(() => {
  h.auth = null;
  h.client.channel.mockClear();
});

describe("PlanningPokerClient for a public visitor", () => {
  it("explains that sessions stay in this browser", () => {
    h.auth = { status: "anonymous", user: null };
    render(<PlanningPokerClient />);
    expect(
      screen.getByText(
        "Sessions run in this browser. Multiplayer invites are available to the workspace owner."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/Settings → Squads/)).toBeNull();
  });

  it("runs a browser-only session with no channel and no invite button", () => {
    h.auth = { status: "anonymous", user: null };
    render(<PlanningPokerClient />);
    fireEvent.click(screen.getByRole("button", { name: "Start Session" }));

    expect(screen.getByText("Browser-only")).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "Invite squad" })).toBeInTheDocument();
    expect(h.client.channel).toHaveBeenCalledWith(
      expect.stringMatching(/^tool:planning-poker:room:/),
      expect.anything()
    );
  });
});
