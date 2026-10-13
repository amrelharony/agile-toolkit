import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// The leaderboard lives in the owner's Supabase project: only the verified
// owner may upsert to it (scheduleProfileSync) or read it. The engine's
// subscriber is captured so the test can feed it effects directly.
const h = vi.hoisted(() => ({
  auth: null as { status: string; user: { id: string } | null } | null,
  subscriber: null as ((effect: { kind: string; payload: unknown }) => void) | null,
  schedule: vi.fn(),
  cancel: vi.fn(),
  fetchLeaderboard: vi.fn(async () => []),
}));

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuthOptional: () => h.auth,
}));
vi.mock("@/lib/gamification/supabase-sync", () => ({
  scheduleProfileSync: h.schedule,
  cancelProfileSync: h.cancel,
  fetchLeaderboard: h.fetchLeaderboard,
}));
vi.mock("@/lib/gamification/engine", () => ({
  subscribe: (fn: (effect: { kind: string; payload: unknown }) => void) => {
    h.subscriber = fn;
    return () => {
      if (h.subscriber === fn) h.subscriber = null;
    };
  },
  installWindowBridge: () => {},
  prestige: () => {},
}));
vi.mock("@/lib/gamification/event-bridge", () => ({ installEventBridge: () => () => {} }));
vi.mock("@/lib/gamification/secrets", () => ({ installSecretDetector: () => () => {} }));
vi.mock("@/lib/gamification/opfs", () => ({ appendXpEvent: () => {} }));

import { GamificationProvider } from "@/lib/gamification/provider";
import { TrophyCase } from "@/components/gamification/trophy-case";

const OWNER = { status: "authenticated", user: { id: "u1" } };
const XP = { kind: "xp", payload: { amount: 5, source: "tool", at: "2026-01-01T00:00:00Z" } };
const LEVEL_UP = { kind: "level-up", payload: { level: 2 } };

beforeEach(() => {
  h.auth = null;
  h.subscriber = null;
  h.schedule.mockClear();
  h.cancel.mockClear();
  h.fetchLeaderboard.mockClear();
});

describe("GamificationProvider — leaderboard sync", () => {
  it("never schedules a profile upsert for a visitor", () => {
    h.auth = { status: "anonymous", user: null };
    render(<GamificationProvider>{null}</GamificationProvider>);
    expect(h.subscriber).not.toBeNull();
    h.subscriber?.(XP);
    h.subscriber?.(LEVEL_UP);
    expect(h.schedule).not.toHaveBeenCalled();
  });

  it("schedules it for the owner", () => {
    h.auth = OWNER;
    render(<GamificationProvider>{null}</GamificationProvider>);
    h.subscriber?.(XP);
    h.subscriber?.(LEVEL_UP);
    expect(h.schedule).toHaveBeenCalledTimes(2);
  });

  it("cancels a pending sync and stops scheduling once the owner signs out", () => {
    h.auth = OWNER;
    const { rerender } = render(<GamificationProvider>{null}</GamificationProvider>);
    h.cancel.mockClear();

    h.auth = { status: "anonymous", user: null };
    rerender(<GamificationProvider>{null}</GamificationProvider>);
    expect(h.cancel).toHaveBeenCalled();

    h.subscriber?.(XP);
    expect(h.schedule).not.toHaveBeenCalled();
  });
});

describe("TrophyCase — leaderboard controls", () => {
  it("hides the share switch and leaderboard tab from visitors", () => {
    h.auth = { status: "anonymous", user: null };
    render(<TrophyCase open onOpenChange={() => {}} />);
    expect(screen.getByRole("tab", { name: /Achievements/ })).toBeInTheDocument();
    expect(screen.queryByText("Share on leaderboard")).toBeNull();
    expect(screen.queryByRole("tab", { name: /Leaderboard/ })).toBeNull();
    expect(h.fetchLeaderboard).not.toHaveBeenCalled();
  });

  it("shows them to the owner", () => {
    h.auth = OWNER;
    render(<TrophyCase open onOpenChange={() => {}} />);
    expect(screen.getByText("Share on leaderboard")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Leaderboard/ })).toBeInTheDocument();
  });
});
