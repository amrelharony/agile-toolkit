import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { AuthContextValue } from "@/lib/auth/types";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { HandoffLink, StoryMap } from "@/lib/stores/workspace-types";

/**
 * Planning Poker's queue in the UI: the lobby shows how many stories other
 * tools queued and can start a session with them, the host can add stories
 * queued later, and accepting an estimate writes it back to the Story Mapper
 * card. A guest's screen has neither control.
 */

const h = vi.hoisted(() => ({
  auth: null as Partial<AuthContextValue> | null,
}));

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuthOptional: () => h.auth,
}));
vi.mock("@/lib/realtime/supabase-client", () => ({
  isRealtimeAvailable: () => false,
  getSupabaseClient: () => null,
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {} }));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { apply: () => void }) => a.apply(),
}));
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
import { SessionScreen } from "@/app/(tools)/planning-poker/session-screen";
import type { Session } from "@/app/(tools)/planning-poker/types";
import { sendHandoff } from "@/lib/handoffs/send";
import { STORY_MAP_ID } from "@/lib/handoffs/poker-writeback";
import { POKER_LOG_ID } from "@/lib/handoffs/targets/poker-queue";

const ws = () => useWorkspaceStore.getState();
const queue = () => ws().pokerEstimationLogs?.find((d) => d.id === POKER_LOG_ID)?.queue ?? [];
const card = (id: string) =>
  ws()
    .storyMaps?.find((m) => m.id === STORY_MAP_ID)
    ?.slices.flatMap((sl) => Object.values(sl.cards).flat())
    .find((c) => c.id === id);

function storyMap(): StoryMap {
  return {
    id: STORY_MAP_ID,
    steps: [{ id: "st1", name: "Browse" }],
    slices: [
      {
        id: "sl1",
        name: "MVP",
        cards: {
          st1: [
            { id: "c1", title: "Search products", description: "", color: "#00f0ff" },
            { id: "c2", title: "Filter by price", description: "", color: "#00f0ff" },
          ],
        },
      },
    ],
  };
}

function queueCard(id: string, title: string) {
  let links: HandoffLink[] = [];
  sendHandoff(
    "poker-queue",
    { title, sourceRef: { tool: "story-mapper", id, doc: STORY_MAP_ID } },
    { getLinks: () => links, setLinks: (u) => (links = u(links)) }
  );
}

beforeEach(() => {
  // A visitor: a browser-only session, so no Realtime channel is needed.
  h.auth = { status: "anonymous", user: null };
  window.localStorage.clear();
  useWorkspaceStore.setState({ storyMaps: [storyMap()], pokerEstimationLogs: [] });
});

function voteRevealAccept(value: string) {
  fireEvent.click(
    within(screen.getByRole("radiogroup", { name: "Your vote" })).getByRole("radio", {
      name: value,
    })
  );
  fireEvent.click(screen.getByRole("button", { name: /^Reveal/ }));
  const label = screen.getByText("Accept estimate:");
  fireEvent.click(within(label.parentElement as HTMLElement).getByRole("button", { name: value }));
}

describe("Planning Poker lobby queue", () => {
  it("shows nothing when the queue is empty", () => {
    render(<PlanningPokerClient />);
    expect(screen.queryByText(/queued for estimation/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Start with the queue" })).toBeNull();
  });

  it("starts a session with the queued stories, and the estimate goes back to the card", () => {
    queueCard("c1", "Search products");
    render(<PlanningPokerClient />);
    expect(screen.getByText("1 story queued for estimation")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start with the queue" }));
    expect(screen.getByRole("heading", { name: "Search products" })).toBeInTheDocument();
    expect(queue()[0].sessionStoryId).toEqual(expect.any(String));

    voteRevealAccept("5");
    expect(card("c1")?.estimate).toBe("5");
    expect(queue()).toEqual([]);
    expect(card("c2")?.estimate).toBeUndefined();
  });

  it("adds stories queued after the session started", () => {
    render(<PlanningPokerClient />);
    fireEvent.click(screen.getByRole("button", { name: "Start Session" }));
    expect(screen.queryByRole("button", { name: /Add queued stories/ })).toBeNull();

    act(() => queueCard("c2", "Filter by price"));
    fireEvent.click(screen.getByRole("button", { name: "Add queued stories (1)" }));
    expect(screen.getByRole("heading", { name: "Filter by price" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add queued stories/ })).toBeNull();

    voteRevealAccept("8");
    expect(card("c2")?.estimate).toBe("8");
  });

  it("leaves a story the host typed in alone", () => {
    queueCard("c1", "Search products");
    render(<PlanningPokerClient />);
    fireEvent.click(screen.getByRole("button", { name: "Start Session" }));
    fireEvent.change(screen.getByPlaceholderText("Story title…"), {
      target: { value: "Search products" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add story" }));

    voteRevealAccept("3");
    // Same title, but not the queued story: nothing is written back.
    expect(card("c1")?.estimate).toBeUndefined();
    expect(queue()).toHaveLength(1);
  });
});

describe("a guest's session screen", () => {
  it("has no queue button and can't accept an estimate", () => {
    const onAddQueued = vi.fn();
    const onEstimateAccepted = vi.fn();
    const session: Session = {
      roomCode: "ABC234",
      sessionName: "Sprint Planning",
      scale: ["1", "2", "3", "5", "8"],
      scaleType: "fibonacci",
      host: "Host",
      hostId: "host-1",
      participants: [
        { id: "host-1", name: "Host", vote: "5" },
        { id: "guest-1", name: "Guest", vote: "5" },
      ],
      stories: [{ id: "s1", title: "Search products", finalEstimate: null }],
      currentStoryIdx: 0,
      revealed: true,
    };
    render(
      <SessionScreen
        session={session}
        onUpdateSession={() => {}}
        localParticipantId="guest-1"
        isHost={false}
        onLeave={() => {}}
        queuedCount={3}
        onAddQueued={onAddQueued}
        onEstimateAccepted={onEstimateAccepted}
      />
    );
    expect(screen.queryByRole("button", { name: /Add queued stories/ })).toBeNull();
    expect(screen.queryByText("Accept estimate:")).toBeNull();
    expect(onEstimateAccepted).not.toHaveBeenCalled();
  });
});
