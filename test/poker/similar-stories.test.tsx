import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import type { AuthContextValue } from "@/lib/auth/types";
import type { Session } from "@/app/(tools)/planning-poker/types";
import type { Story } from "@/lib/stores/workspace-types";

/**
 * Planning Poker's "Like this one": finished stories like the one being
 * estimated, with their points, shown only to the host and only after
 * Reveal (before it, a size on screen would anchor the votes), never in a
 * visitor room (the page passes nothing there). With nothing alike it
 * falls back to the guide's reference stories; "Find similar without AI"
 * answers with the task's fallback; with nothing to compare, no panel.
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
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {} }));
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
import type { SimilarSource } from "@/components/stories/similar-stories";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { initialState, useEstimationGuideStore } from "@/app/(tools)/estimation-guide/store";

const HOST = "host-1";
const FIB = ["1", "2", "3", "5", "8", "13", "21", "?", "∞"];

const done = (id: string, title: string, points: number): Story => ({
  id,
  title,
  points,
  status: "done",
});

const STORIES: Story[] = [
  done("s1", "Card refunds for marketplace orders", 5),
  done("s2", "Refund a voucher payment", 3),
  done("s3", "Export the monthly sales report", 2),
];

const seats = (...votes: (string | null)[]) => [
  { id: HOST, name: "Scrum Master", vote: votes[0] ?? null },
  ...votes.slice(1).map((vote, i) => ({ id: `p${i}`, name: `Dev ${i + 1}`, vote })),
];

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    roomCode: "ABC234",
    sessionName: "Sprint Planning",
    scale: FIB,
    scaleType: "fibonacci",
    host: "Scrum Master",
    hostId: HOST,
    participants: seats("3", "5"),
    stories: [{ id: "p-1", title: "Refund a card payment", finalEstimate: null }],
    currentStoryIdx: 0,
    revealed: true,
    ...overrides,
  };
}

function Harness({
  initial,
  similar,
  isHost = true,
}: {
  initial: Session;
  similar?: SimilarSource;
  isHost?: boolean;
}) {
  const [session, setSession] = useState(initial);
  return (
    <SessionScreen
      session={session}
      onUpdateSession={(updater) => setSession((s) => updater(s))}
      localParticipantId={isHost ? HOST : "p0"}
      isHost={isHost}
      onLeave={() => {}}
      similar={similar}
    />
  );
}

const panel = () => screen.queryByRole("region", { name: "Like this one" });
const items = () =>
  within(panel()!)
    .getAllByRole("listitem")
    .map((li) => li.textContent);

beforeEach(() => {
  h.auth = null;
  window.localStorage.clear();
  useWorkspaceStore.setState({ stories: [], pokerEstimationLogs: [] });
  useEstimationGuideStore.setState({ ...initialState, referenceStoryIds: {} });
});

describe("where it shows", () => {
  it("is absent before Reveal, so no size anchors the votes", () => {
    render(<Harness initial={makeSession({ revealed: false })} similar={{ stories: STORIES }} />);
    expect(panel()).toBeNull();
  });

  it("shows the host the finished stories like this one after Reveal", () => {
    render(<Harness initial={makeSession()} similar={{ stories: STORIES }} />);
    expect(items()).toEqual([
      "Refund a voucher payment · 3 ptsBoth mention: payment, refund",
      "Card refunds for marketplace orders · 5 ptsBoth mention: card, refund",
    ]);
    expect(panel()).toHaveTextContent("Middle of these: 4 pts.");
  });

  it("is never on a guest's screen", () => {
    render(<Harness initial={makeSession()} similar={{ stories: STORIES }} isHost={false} />);
    expect(panel()).toBeNull();
  });

  it("is gone without a source, as a visitor room passes none", () => {
    render(<Harness initial={makeSession()} />);
    expect(panel()).toBeNull();
  });

  it("has no panel with nothing to compare with", () => {
    render(<Harness initial={makeSession()} similar={{ stories: [] }} />);
    expect(panel()).toBeNull();
  });

  it("is gone once the story has an estimate", () => {
    render(
      <Harness
        initial={makeSession({
          stories: [{ id: "p-1", title: "Refund a card payment", finalEstimate: "5" }],
        })}
        similar={{ stories: STORIES }}
      />
    );
    expect(panel()).toBeNull();
  });
});

describe("the fallbacks", () => {
  it("falls back to the guide's reference stories when nothing reads alike", () => {
    const similar: SimilarSource = {
      stories: [],
      references: {
        cards: ["3", "5"],
        lookup: (card) =>
          card === "3"
            ? { stories: [{ title: "Login page" }] }
            : { stories: [{ title: "Checkout", example: true }] },
      },
    };
    render(<Harness initial={makeSession()} similar={similar} />);
    expect(panel()).toHaveTextContent("No finished story reads like this one yet.");
    expect(items()).toEqual(["3 · Login page", "5 · Checkout (example)"]);
    // Nothing to ask about: no done stories to pick from.
    expect(within(panel()!).queryByRole("button")).toBeNull();
  });

  it("finds similar without AI, marked as such, and goes back to the word match", () => {
    render(<Harness initial={makeSession()} similar={{ stories: STORIES }} />);
    fireEvent.click(screen.getByRole("button", { name: "Find similar without AI" }));
    expect(panel()).toHaveTextContent("Found without AI, by shared words.");
    expect(items()).toEqual([
      "Refund a voucher payment · 3 ptsShares: payment, refund",
      "Card refunds for marketplace orders · 5 ptsShares: card, refund",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Show the word match again" }));
    expect(panel()).not.toHaveTextContent("Found without AI");
    expect(items()[0]).toMatch(/Both mention/);
  });

  it("offers Amr the stories even when no word matches", () => {
    render(
      <Harness
        initial={makeSession({
          stories: [{ id: "p-1", title: "Dark mode toggle", finalEstimate: null }],
        })}
        similar={{ stories: STORIES }}
      />
    );
    expect(panel()).toHaveTextContent("No finished story reads like this one yet.");
    fireEvent.click(screen.getByRole("button", { name: "Find similar without AI" }));
    expect(panel()).toHaveTextContent("No finished story is like this one.");
  });
});

describe("on the page", () => {
  it("shows the workspace's finished stories after Reveal in a browser-only session", () => {
    h.auth = { status: "anonymous", user: null };
    useWorkspaceStore.setState({ stories: STORIES });
    render(<PlanningPokerClient />);
    fireEvent.click(screen.getByRole("button", { name: "Start Session" }));
    fireEvent.change(screen.getByPlaceholderText("Story title…"), {
      target: { value: "Refund a card payment" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add story" }));
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "Your vote" })).getByRole("radio", {
        name: "5",
      })
    );
    expect(panel()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Reveal/ }));
    expect(items()[0]).toBe("Refund a voucher payment · 3 ptsBoth mention: payment, refund");
  });
});
