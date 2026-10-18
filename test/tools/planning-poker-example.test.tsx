import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { AuthContextValue } from "@/lib/auth/types";

/**
 * Planning Poker: "Load an example" opens a local-only refinement session
 * (never a Realtime room), "Clear example" drops only the example's
 * stories and teammates, and the Markdown export lists the estimates with
 * the votes behind them, including a re-voted story's first round.
 */

const exported = vi.hoisted(() => ({ markdown: undefined as string | undefined }));
const history = vi.hoisted(() => ({ log: vi.fn() }));
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

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => {
    exported.markdown = markdown;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log }),
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
import { LOCAL_SESSION_KEY } from "@/app/(tools)/planning-poker/local-session";
import { toMarkdown } from "@/app/(tools)/planning-poker/markdown";
import { buildExample } from "@/app/(tools)/planning-poker/example";
import { isValidSession, type Session } from "@/app/(tools)/planning-poker/types";

const NOW = new Date(2026, 9, 18);
const owner = { id: "owner-1", email: "owner@example.com" } as AuthContextValue["user"];

function session(overrides: Partial<Session> = {}): Session {
  return {
    roomCode: "ABC234",
    sessionName: "Sprint Planning",
    scale: ["1", "2", "3", "5", "8", "13", "21", "?", "∞"],
    scaleType: "fibonacci",
    host: "Scrum Master",
    hostId: "me",
    participants: [{ id: "me", name: "Scrum Master", vote: null }],
    stories: [],
    currentStoryIdx: 0,
    revealed: false,
    ...overrides,
  };
}

const stored = () => window.localStorage.getItem(LOCAL_SESSION_KEY);

beforeEach(() => {
  exported.markdown = undefined;
  history.log.mockClear();
  undo.last = null;
  h.auth = null;
  h.client.channel.mockClear();
  window.localStorage.clear();
});

describe("Planning Poker toMarkdown", () => {
  it("lists every story with its estimate and votes, then the total", () => {
    const lines = toMarkdown(buildExample("me"), NOW).split("\n");
    expect(lines[0]).toBe("# Planning Poker — 18 Oct 2026 (Checkout app: Sprint 14 refinement)");
    expect(lines).toContain("Fibonacci scale, 6 participants.");
    expect(lines).toContain("## Estimates");
    expect(lines).toContain("| Story | Estimate | Votes |");
    expect(lines).toContain("| Show saved cards at checkout | 3 | 3, 3, 3, 3, 5 |");
    // A re-voted story shows the round that settled it…
    expect(lines).toContain("| Retry failed card payments | 8 | 5, 8, 8, 8, 8 |");
    // …the revealed round on the table shows its votes before anyone agrees…
    expect(lines).toContain("| Add a digital wallet button | — | 3, 5, 5, 5, ? |");
    // …and a story nobody has voted on yet is blank.
    expect(lines).toContain("| Address lookup by ZIP code | — | — |");
    expect(lines).toContain("**Total: 13 points** (3 of 5 stories estimated)");
    expect(lines).toContain("## Re-voted");
    expect(lines).toContain(
      "- **Retry failed card payments**: 2, 3, 3, 8, 13 → 5, 8, 8, 8, 8 (agreed 8)"
    );
    expect(lines.at(-1)).toBe("");
  });

  it("counts T-shirt sizes instead of adding them up", () => {
    const md = toMarkdown(
      session({
        scale: ["XS", "S", "M", "L", "XL", "XXL", "?"],
        scaleType: "tshirt",
        stories: [
          { id: "a", title: "Login", finalEstimate: "M" },
          { id: "b", title: "Search", finalEstimate: "S" },
          { id: "c", title: "Checkout", finalEstimate: "M" },
          { id: "d", title: "Profile", finalEstimate: null },
        ],
      }),
      NOW
    );
    expect(md).toContain("**Estimated:** S ×1, M ×2 (3 of 4 stories estimated)");
    expect(md).not.toContain("## Re-voted");
  });

  it("escapes pipes and collapses newlines in story titles", () => {
    const md = toMarkdown(
      session({ stories: [{ id: "a", title: "Search | filters\nand sort", finalEstimate: "5" }] }),
      NOW
    );
    expect(md).toContain("| Search \\| filters and sort | 5 | — |");
    expect(md).toContain("**Total: 5 points** (1 of 1 story estimated)");
  });

  it("says there's nothing yet without a session or stories", () => {
    expect(toMarkdown(null, NOW)).toBe(
      "# Planning Poker — 18 Oct 2026\n\nNo stories estimated yet.\n"
    );
    expect(toMarkdown(session(), NOW)).toBe(
      "# Planning Poker — 18 Oct 2026 (Sprint Planning)\n\nNo stories estimated yet.\n"
    );
  });
});

describe("Planning Poker example", () => {
  it("is a valid session of five stories, three estimated, one re-voted", () => {
    const ex = buildExample("me");
    expect(isValidSession(ex)).toBe(true);
    expect(ex.stories).toHaveLength(5);
    expect(ex.stories.filter((s) => s.finalEstimate !== null)).toHaveLength(3);
    expect(ex.stories.filter((s) => (s.rounds?.length ?? 0) > 1)).toHaveLength(1);
    expect(ex.roomCode).toMatch(/^example-/);
    expect(ex.stories.every((s) => s.id.startsWith("example-"))).toBe(true);
    // The facilitator is the person at the keyboard; everyone else is example data.
    expect(ex.hostId).toBe("me");
    expect(ex.participants.filter((p) => !p.id.startsWith("example-"))).toEqual([
      { id: "me", name: "Scrum Master", vote: null },
    ]);
  });

  it("keeps a peer's vote history to sane bounds", () => {
    const story = { id: "a", title: "Login", finalEstimate: null };
    const ok = session({ stories: [{ ...story, rounds: [["3", "5"]] }] });
    expect(isValidSession(ok)).toBe(true);
    const tooMany = Array.from({ length: 11 }, () => ["3"]);
    expect(isValidSession(session({ stories: [{ ...story, rounds: tooMany }] }))).toBe(false);
    const badVote = [[3 as unknown as string]];
    expect(isValidSession(session({ stories: [{ ...story, rounds: badVote }] }))).toBe(false);
  });

  it("loads a browser-only session for a visitor and clears back to the lobby", () => {
    h.auth = { status: "anonymous", user: null };
    render(<PlanningPokerClient />);
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));

    expect(screen.getByRole("status")).toHaveTextContent("Example data.");
    expect(
      screen.getByRole("heading", { name: "Add a digital wallet button" })
    ).toBeInTheDocument();
    expect(screen.getByText("Retry failed card payments")).toBeInTheDocument();
    expect(screen.getByText("Near consensus")).toBeInTheDocument();
    expect(screen.getByText("Browser-only")).toBeInTheDocument();
    expect(h.client.channel).not.toHaveBeenCalled();
    expect(history.log).not.toHaveBeenCalled();
    expect(exported.markdown).toContain("**Total: 13 points** (3 of 5 stories estimated)");
    // Stored like any local session, so a refresh keeps it.
    expect(stored()).toContain("Retry failed card payments");

    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(screen.getByRole("button", { name: "Start Session" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
    expect(stored()).toBeNull();
  });

  it("never opens a Realtime room or an invite for the owner, even after Leave and Undo", () => {
    h.auth = { status: "authenticated", user: owner };
    render(<PlanningPokerClient />);
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));

    expect(screen.getByText("Local-only")).toBeInTheDocument();
    expect(screen.queryByText(/Room:/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Invite squad" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Leave Session" }));
    const dialog = screen.getByRole("dialog", { name: "Leave this session?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Leave session" }));
    act(() => undo.last!.revert());

    expect(screen.getByRole("status")).toHaveTextContent("Example data.");
    expect(screen.getByText("Local-only")).toBeInTheDocument();
    expect(h.client.channel).not.toHaveBeenCalled();
  });

  it("keeps the user's own stories when the example is cleared", () => {
    h.auth = { status: "anonymous", user: null };
    render(<PlanningPokerClient />);
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));

    fireEvent.change(screen.getByPlaceholderText("Story title…"), {
      target: { value: "Gift card payments" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add story" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("heading", { name: "Gift card payments" })).toBeInTheDocument();
    expect(screen.queryByText("Retry failed card payments")).toBeNull();
    expect(screen.queryByText("Priya (PM)")).toBeNull();
    const kept = JSON.parse(stored()!) as Session;
    expect(kept.stories.map((s) => s.title)).toEqual(["Gift card payments"]);
    expect(kept.participants.map((p) => p.name)).toEqual(["Scrum Master"]);
    expect(kept.sessionName).toBe("Sprint Planning");
    expect(stored()).not.toContain("example-");
  });

  it("records a re-vote on the story, in the card and the export", () => {
    h.auth = { status: "anonymous", user: null };
    render(<PlanningPokerClient />);
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));

    fireEvent.click(screen.getByRole("button", { name: "Vote Again" }));
    const rounds = screen.getByRole("list", { name: "Voting rounds" });
    expect(rounds).toHaveTextContent("Round 1: 3 · 5 · 5 · 5 · ?");

    fireEvent.click(screen.getByRole("radio", { name: "5" }));
    fireEvent.click(screen.getByRole("button", { name: /Reveal/ }));
    fireEvent.click(screen.getByRole("button", { name: "5" }));

    expect(exported.markdown).toContain("| Add a digital wallet button | 5 | 5 |");
    expect(exported.markdown).toContain("**Total: 18 points** (4 of 5 stories estimated)");
    expect(exported.markdown).toContain(
      "- **Add a digital wallet button**: 3, 5, 5, 5, ? → 5 (agreed 5)"
    );
  });

  it("isn't offered once the user has a session of their own", () => {
    h.auth = { status: "anonymous", user: null };
    const first = render(<PlanningPokerClient />);
    expect(screen.getByRole("button", { name: "Load an example" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start Session" }));
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("Story title…"), {
      target: { value: "Checkout flow" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add story" }));
    first.unmount();

    // A stored session is restored rather than offering the example over it.
    render(<PlanningPokerClient />);
    expect(screen.getByRole("heading", { name: "Checkout flow" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("waits for auth before offering the example", () => {
    h.auth = { status: "loading", user: null };
    render(<PlanningPokerClient />);
    expect(screen.getByRole("button", { name: "Start Session" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();
  });
});
