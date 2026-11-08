import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));
vi.mock("@/lib/gamification/supabase-sync", () => ({
  scheduleProfileSync: () => {},
  cancelProfileSync: () => {},
  fetchLeaderboard: async () => [],
}));

import { XpBar } from "@/components/gamification/xp-bar";
import { TrophyCase } from "@/components/gamification/trophy-case";
import { activeAchievements } from "@/lib/gamification/achievements";
import { useVDnaStore } from "@/lib/stores/vdna-store";

/**
 * The XP bar reads the store and nothing else: no combo badge, and no
 * timer polling the engine every 150–500 ms. Retired badges a user holds
 * stay visible in the trophy case ("Classic badges") but don't count
 * toward the totals.
 */

beforeEach(() => {
  useVDnaStore.setState({ xp: 0, prestige: 0, unlocked: [], silentMode: false });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("XpBar", () => {
  it("starts no interval or timeout", () => {
    const interval = vi.spyOn(globalThis, "setInterval");
    const timeout = vi.spyOn(globalThis, "setTimeout");
    const { unmount } = render(<XpBar />);
    expect(screen.getByRole("button", { name: /Level 1,/ })).toBeInTheDocument();
    expect(interval).not.toHaveBeenCalled();
    // React and testing-library may schedule their own timeouts; none come
    // from the XP bar's module.
    const fromBar = timeout.mock.calls.filter(([fn]) => String(fn).includes("getCombo"));
    expect(fromBar).toEqual([]);
    unmount();
  });

  it("updates from the store, not from polling", () => {
    render(<XpBar />);
    expect(screen.getByRole("button", { name: /Level 1,/ })).toBeInTheDocument();
    act(() => {
      useVDnaStore.setState({ xp: 5000 });
    });
    expect(screen.queryByRole("button", { name: /Level 1,/ })).toBeNull();
  });

  it("shows no combo multiplier", () => {
    render(<XpBar />);
    expect(screen.queryByText(/×\d/)).toBeNull();
  });

  it("counts active badges only", () => {
    useVDnaStore.setState({ unlocked: ["first-click", "combo-5", "first-win"] });
    render(<XpBar />);
    expect(screen.getByRole("button", { name: /1 achievements/ })).toBeInTheDocument();
  });

  it("has no polling code left", () => {
    const src = readFileSync(join(process.cwd(), "src/components/gamification/xp-bar.tsx"), "utf8");
    expect(src).not.toMatch(/setInterval|getCombo/);
  });
});

describe("TrophyCase badges", () => {
  it("shows held retired badges under Classic badges, outside the totals", () => {
    useVDnaStore.setState({ unlocked: ["first-click", "first-win"] });
    render(<TrophyCase open onOpenChange={() => {}} />);
    expect(screen.getByText("Classic badges")).toBeInTheDocument();
    expect(screen.getByText("First Contact")).toBeInTheDocument();
    expect(screen.getByText(`1 / ${activeAchievements.length}`)).toBeInTheDocument();
  });

  it("hides retired badges nobody earned", () => {
    render(<TrophyCase open onOpenChange={() => {}} />);
    expect(screen.queryByText("Classic badges")).toBeNull();
    expect(screen.queryByText("First Contact")).toBeNull();
    expect(screen.queryByText("Butterfly Mind")).toBeNull();
  });
});
