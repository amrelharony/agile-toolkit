import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * The trophy case on phones and larger screens (PR K):
 *  - below `sm` it is a full-height sheet that stops at Amr's bands, so he
 *    stays visible; on larger screens it stays the centred dialog;
 *  - the leaderboard and recent-events rows use an `auto_1fr_auto` grid
 *    that fits a 320 px phone;
 *  - prestige asks through an alert dialog, never `window.confirm`;
 *  - silent mode is gone: a link goes to Settings › Notifications;
 *  - the dead `trophy-button.tsx` is deleted.
 */

const h = vi.hoisted(() => ({
  phone: false,
  prestige: vi.fn(),
  auth: null as { status: string; user: { id: string } | null } | null,
  fetchLeaderboard: vi.fn(async () => [] as unknown[]),
}));

vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => h.auth }));
vi.mock("@/lib/gamification/supabase-sync", () => ({
  scheduleProfileSync: vi.fn(),
  cancelProfileSync: vi.fn(),
  fetchLeaderboard: h.fetchLeaderboard,
}));
vi.mock("@/lib/realtime/supabase-client", () => ({ isRealtimeAvailable: () => true }));
vi.mock("@/lib/gamification/engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/gamification/engine")>()),
  prestige: h.prestige,
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    onClick,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    onClick?: () => void;
    className?: string;
  }) => (
    <a href={href} onClick={onClick} className={className}>
      {children}
    </a>
  ),
}));

import { PRESTIGE_CONFIRM, TrophyCase } from "@/components/gamification/trophy-case";
import { useVDnaStore } from "@/lib/stores/vdna-store";
import { PHONE_MEDIA_QUERY } from "@/lib/layout/breakpoints";
import { MAX_LEVEL } from "@/lib/gamification/xp-curve";

/** A matchMedia that answers the phone query from `h.phone`. */
function stubMatchMedia() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === PHONE_MEDIA_QUERY ? h.phone : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

/** Enough XP at prestige 0 to sit at the level cap (prestige is offered). */
function atMaxLevel() {
  useVDnaStore.setState({ xp: 50_000_000, prestige: 0, level: MAX_LEVEL });
}

beforeAll(async () => {
  await useVDnaStore.persist.rehydrate();
});

beforeEach(() => {
  h.phone = false;
  h.auth = null;
  h.prestige.mockClear();
  h.fetchLeaderboard.mockClear();
  stubMatchMedia();
  useVDnaStore.setState({
    xp: 0,
    prestige: 0,
    level: 1,
    unlocked: [],
    recentEvents: [],
    dailyChallenges: [],
    weeklyChallenges: [],
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("trophy case frame", () => {
  it("is the centred dialog on larger screens", () => {
    render(<TrophyCase open onOpenChange={() => {}} />);
    expect(screen.getByTestId("trophy-dialog")).toBeTruthy();
    expect(screen.queryByTestId("trophy-sheet")).toBeNull();
    expect(screen.getByRole("dialog", { name: /Trophy Case/ })).toBeTruthy();
  });

  it("is a full-height sheet on phones that stops at Amr's bands", () => {
    h.phone = true;
    render(<TrophyCase open onOpenChange={() => {}} />);
    const sheet = screen.getByTestId("trophy-sheet");
    expect(screen.queryByTestId("trophy-dialog")).toBeNull();
    expect(sheet.getAttribute("role")).toBe("dialog");
    expect(sheet.style.top).toContain("--amr-band-top");
    expect(sheet.style.bottom).toContain("--amr-band-bottom");
    // Full height between the bands: no max-height cap, no centring.
    expect(sheet.className).not.toMatch(/max-h-/);
    expect(sheet.className).toMatch(/inset-x-0/);
    // The overlay leaves both bands clear too, so Amr isn't dimmed.
    const overlay = screen.getByTestId("trophy-overlay");
    expect(overlay.style.top).toContain("--amr-band-top");
    expect(overlay.style.bottom).toContain("--amr-band-bottom");
    expect(overlay.className).not.toMatch(/inset-0/);
  });

  it("the phone sheet has a titled header and a 44 px close button", () => {
    h.phone = true;
    const onOpenChange = vi.fn();
    render(<TrophyCase open onOpenChange={onOpenChange} />);
    expect(screen.getByRole("dialog", { name: /Trophy Case/ })).toBeTruthy();
    const close = screen.getByRole("button", { name: "Close Trophy Case" });
    expect(close.className).toMatch(/h-11 w-11/);
    fireEvent.click(close);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("the stats wrap to two columns on phones", () => {
    h.phone = true;
    render(<TrophyCase open onOpenChange={() => {}} />);
    const streak = screen.getByText("Streak").closest("div.grid") as HTMLElement;
    expect(streak.className).toMatch(/grid-cols-2/);
    expect(streak.className).toMatch(/sm:grid-cols-4/);
  });
});

describe("trophy case rows", () => {
  it("recent events use an auto_1fr_auto grid", () => {
    useVDnaStore.setState({
      recentEvents: [
        {
          amount: 40,
          source: "outcome",
          multiplier: 1,
          comboDepth: 0,
          total: 40,
          at: "2026-11-08T10:00:00.000Z",
          meta: { toolId: "retro", eventName: "retro-finished" },
        },
      ],
    });
    render(<TrophyCase open onOpenChange={() => {}} />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Activity/ }), { button: 0 });
    const row = screen.getByTestId("trophy-event-row");
    expect(row.className).toMatch(/grid-cols-\[auto_1fr_auto\]/);
    expect(row.textContent).toContain("+40");
    expect(row.textContent).toContain("retro:retro-finished");
  });

  it("leaderboard rows use an auto_1fr_auto grid", async () => {
    h.auth = { status: "authenticated", user: { id: "u1" } };
    h.fetchLeaderboard.mockResolvedValueOnce([
      { visitor_id: "abcdef123", display_name: "Sam", prestige: 2, level: 14, xp: 4321 },
    ]);
    render(<TrophyCase open onOpenChange={() => {}} />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Leaderboard/ }), { button: 0 });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Load" }));
    });
    const row = await screen.findByTestId("leaderboard-row");
    expect(row.className).toMatch(/grid-cols-\[auto_1fr_auto\]/);
    expect(row.textContent).toContain("Sam");
    expect(row.textContent).toContain("L14");
  });
});

describe("prestige confirmation", () => {
  it("asks in an alert dialog, never window.confirm", () => {
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmSpy);
    atMaxLevel();
    render(<TrophyCase open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Prestige \(reset run/ }));
    const alert = screen.getByRole("alertdialog", { name: PRESTIGE_CONFIRM.title });
    expect(within(alert).getByText(PRESTIGE_CONFIRM.description)).toBeTruthy();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(h.prestige).not.toHaveBeenCalled();
  });

  it("Cancel keeps the run", () => {
    atMaxLevel();
    render(<TrophyCase open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Prestige \(reset run/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(h.prestige).not.toHaveBeenCalled();
  });

  it("confirming prestiges once and closes the alert", () => {
    atMaxLevel();
    render(<TrophyCase open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Prestige \(reset run/ }));
    const alert = screen.getByRole("alertdialog");
    fireEvent.click(within(alert).getByRole("button", { name: PRESTIGE_CONFIRM.confirm }));
    expect(h.prestige).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("works from the phone sheet too", () => {
    h.phone = true;
    atMaxLevel();
    render(<TrophyCase open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Prestige \(reset run/ }));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: PRESTIGE_CONFIRM.confirm,
      })
    );
    expect(h.prestige).toHaveBeenCalledTimes(1);
  });

  it("is not offered below the level cap", () => {
    render(<TrophyCase open onOpenChange={() => {}} />);
    expect(screen.queryByRole("button", { name: /Prestige \(reset run/ })).toBeNull();
  });
});

describe("cleanup", () => {
  it("has no silent-mode switch, only the Notifications link", () => {
    const onOpenChange = vi.fn();
    render(<TrophyCase open onOpenChange={onOpenChange} />);
    expect(screen.queryByText(/silent/i)).toBeNull();
    const link = screen.getByRole("link", { name: /Notifications & celebrations/ });
    expect(link.getAttribute("href")).toBe("/settings/notifications");
    fireEvent.click(link);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("the trophy case source no longer calls window.confirm", () => {
    const src = readFileSync(
      join(process.cwd(), "src/components/gamification/trophy-case.tsx"),
      "utf8"
    );
    expect(src).not.toMatch(/\bconfirm\(/);
  });

  it("trophy-button.tsx is deleted", () => {
    expect(existsSync(join(process.cwd(), "src/components/gamification/trophy-button.tsx"))).toBe(
      false
    );
  });

  it("the vdna store no longer carries silentMode", () => {
    const state = useVDnaStore.getState() as unknown as Record<string, unknown>;
    expect("silentMode" in state).toBe(false);
    expect("setSilentMode" in state).toBe(false);
  });
});
