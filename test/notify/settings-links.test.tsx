import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

/**
 * Every way to reach Settings › Notifications: the Notifications row in
 * both user menus (the phone's only route), the gear in the Activity panel
 * (desktop popover and phone sheet), and the trophy case link that replaced
 * its silent-mode switch. The header drops the XP bar's slot when it's off.
 */

const h = vi.hoisted(() => ({
  phone: false,
  auth: { status: "anonymous", user: null, profile: null } as Record<string, unknown>,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/auth/auth-provider", () => ({
  useAuth: () => h.auth,
  useAuthOptional: () => h.auth,
}));
vi.mock("@/lib/gamification/supabase-sync", () => ({
  scheduleProfileSync: vi.fn(),
  cancelProfileSync: vi.fn(),
  fetchLeaderboard: vi.fn(async () => []),
}));
vi.mock("@/lib/utils/toast", () => ({
  toast: Object.assign(vi.fn(), {
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
  }),
}));

import { UserMenu } from "@/components/auth/user-menu";
import { ActivityPanel } from "@/components/notify/activity-panel";
import { TrophyCase } from "@/components/gamification/trophy-case";
import { useActivityUiStore } from "@/lib/stores/activity-ui-store";
import { useInboxStore } from "@/lib/notify/inbox-store";
import { useNotificationPrefsStore } from "@/lib/stores/notification-prefs-store";
import { useVDnaStore } from "@/lib/stores/vdna-store";
import { PHONE_MEDIA_QUERY } from "@/lib/layout/breakpoints";

beforeAll(async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
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
  await useVDnaStore.persist.rehydrate();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  localStorage.clear();
  h.phone = false;
  h.auth = { status: "anonymous", user: null, profile: null };
  act(() => {
    useInboxStore.setState({ items: [], seeded: true });
    useActivityUiStore.setState({ activityOpen: false, trophyOpen: false });
    useNotificationPrefsStore.setState(useNotificationPrefsStore.getInitialState(), true);
    useVDnaStore.setState({ xp: 0, prestige: 0, dailyChallenges: [], weeklyChallenges: [] });
  });
});

function openMenu(name: RegExp) {
  fireEvent.keyDown(screen.getByRole("button", { name }), { key: "Enter" });
}

describe("Notifications entry points", () => {
  it("the visitor menu links to Settings › Notifications, after Trophies", () => {
    render(<UserMenu />);
    openMenu(/Visitor menu/);
    const row = screen.getByRole("menuitem", { name: "Notifications" });
    expect(row).toHaveAttribute("href", "/settings/notifications");
    const labels = screen.getAllByRole("menuitem").map((m) => m.textContent?.trim());
    const trophies = labels.indexOf("Trophies & challenges");
    expect(trophies).toBeGreaterThanOrEqual(0);
    expect(labels[trophies + 1]).toBe("Notifications");
    expect(labels[trophies + 2]).toBe("Pause celebrations · 1 h");
  });

  it("the owner menu has the same row", () => {
    h.auth = {
      status: "authenticated",
      user: { id: "owner-1", email: "owner@example.com" },
      profile: null,
    };
    render(<UserMenu />);
    openMenu(/Account menu for/);
    expect(screen.getByRole("menuitem", { name: "Notifications" })).toHaveAttribute(
      "href",
      "/settings/notifications"
    );
  });

  it("keeps the row when gamification is off (the way back to switch it on)", () => {
    useNotificationPrefsStore.setState({ gamificationEnabled: false });
    render(<UserMenu />);
    openMenu(/Visitor menu/);
    expect(screen.queryByText("Trophies & challenges")).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Notifications" })).toBeInTheDocument();
  });

  it("the Activity popover's gear opens settings and closes the panel", () => {
    render(<ActivityPanel />);
    act(() => useActivityUiStore.getState().openActivity());
    const popover = screen.getByTestId("activity-popover");
    const gear = within(popover).getByRole("link", { name: "Notification settings" });
    expect(gear).toHaveAttribute("href", "/settings/notifications");
    fireEvent.click(gear);
    expect(useActivityUiStore.getState().activityOpen).toBe(false);
  });

  it("the phone sheet has the gear too", () => {
    h.phone = true;
    render(<ActivityPanel />);
    act(() => useActivityUiStore.getState().openActivity());
    const sheet = screen.getByTestId("activity-sheet");
    expect(within(sheet).getByRole("link", { name: "Notification settings" })).toHaveAttribute(
      "href",
      "/settings/notifications"
    );
  });

  it("the trophy case links to settings instead of a silent-mode switch", () => {
    const onOpenChange = vi.fn();
    render(<TrophyCase open onOpenChange={onOpenChange} />);
    expect(screen.queryByText("Silent mode")).not.toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Notifications & celebrations/ });
    expect(link).toHaveAttribute("href", "/settings/notifications");
    fireEvent.click(link);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
