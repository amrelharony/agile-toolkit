import { describe, it, expect, beforeAll, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

/**
 * The trophy case shows the challenge lists the engine will store: an id
 * that left the pool is swapped out (topped up to 3 from the same seed),
 * and a completed one that left the pool still shows, as "Completed".
 */

vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));
vi.mock("@/lib/gamification/supabase-sync", () => ({
  scheduleProfileSync: vi.fn(),
  cancelProfileSync: vi.fn(),
  fetchLeaderboard: vi.fn(async () => []),
}));

import { TrophyCase } from "@/components/gamification/trophy-case";
import { todaySeedKey } from "@/lib/gamification/challenges";
import { useVDnaStore } from "@/lib/stores/vdna-store";
import type { ChallengeProgress } from "@/lib/gamification/types";

const stored = (id: string, extra: Partial<ChallengeProgress> = {}): ChallengeProgress => ({
  id,
  kind: "daily",
  progress: 0,
  goal: 1,
  xp: 50,
  completed: false,
  seedDate: todaySeedKey(),
  ...extra,
});

beforeAll(async () => {
  await useVDnaStore.persist.rehydrate();
});

describe("trophy case challenges", () => {
  it("swaps out dropped ids and keeps a completed one as a Completed card", () => {
    useVDnaStore.setState({
      dailyChallenges: [
        stored("d-click-10", { goal: 10, progress: 4 }),
        stored("d-hover-50", { goal: 50, progress: 50, completed: true }),
        stored("d-poker", { xp: 60 }),
      ],
      weeklyChallenges: [],
    });
    render(<TrophyCase open onOpenChange={() => {}} />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Challenges/ }), { button: 0 });
    expect(screen.getAllByText("Completed challenge")).toHaveLength(1);
    expect(screen.getByText("50 / 50")).toBeTruthy();
    expect(screen.queryByText("4 / 10")).toBeNull();
    // d-hover-50 (completed) + d-poker + one top-up: three cards.
    expect(screen.getAllByRole("progressbar", { name: / progress$/ })).toHaveLength(3);
  });
});
