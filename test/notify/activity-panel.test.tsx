import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

/**
 * The Activity panel and its entry points: rows grouped by day, the
 * progress card, read-on-close, "Gamification off" hiding gamification
 * rows, the Trophies footer, the avatar dot and the user-menu rows.
 * Phone vs desktop is picked by stubbing matchMedia.
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
vi.mock("@/lib/utils/toast", () => ({
  toast: Object.assign(vi.fn(), {
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
  }),
}));

import { ActivityPanel } from "@/components/notify/activity-panel";
import { ActivityDot } from "@/components/notify/activity-dot";
import { UserMenu } from "@/components/auth/user-menu";
import { XpBar } from "@/components/gamification/xp-bar";
import { useInboxStore } from "@/lib/notify/inbox-store";
import { useActivityUiStore } from "@/lib/stores/activity-ui-store";
import { useNotificationPrefsStore } from "@/lib/stores/notification-prefs-store";
import { useVDnaStore } from "@/lib/stores/vdna-store";
import { PHONE_MEDIA_QUERY } from "@/lib/layout/breakpoints";
import type { InboxInput } from "@/lib/notify/inbox";

beforeAll(() => {
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
});

afterAll(() => {
  vi.unstubAllGlobals();
});

function add(input: Partial<InboxInput> & { title: string }) {
  act(() => {
    useInboxStore.getState().add({ kind: "achievement", icon: "Award", ...input });
  });
}

function openPanel() {
  act(() => useActivityUiStore.getState().openActivity());
}

beforeEach(() => {
  localStorage.clear();
  h.phone = false;
  act(() => {
    useInboxStore.setState({ items: [], seeded: true });
    useActivityUiStore.setState({ activityOpen: false, trophyOpen: false });
    useNotificationPrefsStore.setState(useNotificationPrefsStore.getInitialState(), true);
    useVDnaStore.setState({ xp: 0, prestige: 0, dailyChallenges: [] });
  });
});

describe("ActivityPanel", () => {
  it("shows an empty state and the progress card", () => {
    render(<ActivityPanel />);
    openPanel();
    expect(screen.getByText(/Nothing yet/)).toBeInTheDocument();
    const progress = screen.getByRole("region", { name: "Your progress" });
    expect(within(progress).getByText("Level 1")).toBeInTheDocument();
    expect(within(progress).getByText(/XP to Level 2 · Today 0\/300/)).toBeInTheDocument();
  });

  it("groups rows Today / This week / Earlier, with XP and children", () => {
    const now = Date.now();
    add({ title: "Retro Regular", xp: 50, gamification: true });
    add({
      title: "Level 8",
      kind: "level-up",
      at: new Date(now - 2 * 86_400_000).toISOString(),
      children: [{ title: "Retro Regular" }],
    });
    add({ title: "Old one", at: new Date(now - 10 * 86_400_000).toISOString() });
    render(<ActivityPanel />);
    openPanel();
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByText("This week")).toBeInTheDocument();
    expect(screen.getByText("Earlier")).toBeInTheDocument();
    expect(screen.getByText("+50 XP")).toBeInTheDocument();
    expect(screen.getAllByTestId("activity-row")).toHaveLength(3);
  });

  it("marks what it showed as read when it closes (desktop popover, Escape)", () => {
    add({ title: "A" });
    add({ title: "B" });
    render(<ActivityPanel />);
    openPanel();
    expect(screen.getByTestId("activity-popover")).toBeInTheDocument();
    expect(useInboxStore.getState().items.every((i) => !i.read)).toBe(true);
    fireEvent.keyDown(screen.getByTestId("activity-popover"), { key: "Escape" });
    expect(useActivityUiStore.getState().activityOpen).toBe(false);
    expect(useInboxStore.getState().items.every((i) => i.read)).toBe(true);
  });

  it("on phones is a bottom sheet that stops at Amr's band; closing marks read", () => {
    h.phone = true;
    add({ title: "A" });
    render(<ActivityPanel />);
    openPanel();
    const sheet = screen.getByTestId("activity-sheet");
    expect(sheet.style.bottom).toBe("var(--amr-band-bottom, 0px)");
    expect(screen.getByTestId("activity-overlay").style.bottom).toBe("var(--amr-band-bottom, 0px)");
    expect(sheet.className).toContain("max-h-[80dvh]");
    fireEvent.click(screen.getByRole("button", { name: "Close Activity" }));
    expect(useInboxStore.getState().items[0].read).toBe(true);
  });

  it("keeps rows unread while it stays open; Mark all read works", () => {
    add({ title: "A" });
    render(<ActivityPanel />);
    openPanel();
    expect(useInboxStore.getState().items[0].read).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /Mark all read/ }));
    expect(useInboxStore.getState().items[0].read).toBe(true);
  });

  it("'Gamification off' hides gamification rows and the progress card", () => {
    add({ title: "Badge row", gamification: true });
    add({ title: "Plain note", kind: "note" });
    act(() => useNotificationPrefsStore.getState().setGamificationEnabled(false));
    render(<ActivityPanel />);
    openPanel();
    expect(screen.queryByText("Badge row")).not.toBeInTheDocument();
    expect(screen.getByText("Plain note")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Your progress" })).not.toBeInTheDocument();
  });

  it("the Trophies footer swaps the panel for the trophy case", () => {
    render(<ActivityPanel />);
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: /Trophies & challenges/ }));
    expect(useActivityUiStore.getState()).toMatchObject({ activityOpen: false, trophyOpen: true });
  });
});

describe("ActivityDot", () => {
  it("shows for unread rows only", () => {
    render(<ActivityDot />);
    expect(screen.queryByTestId("activity-dot")).not.toBeInTheDocument();
    add({ title: "A" });
    expect(screen.getByTestId("activity-dot")).toBeInTheDocument();
    act(() => useInboxStore.getState().markAllRead());
    expect(screen.queryByTestId("activity-dot")).not.toBeInTheDocument();
  });

  it("ignores gamification rows when gamification is off", () => {
    act(() => useNotificationPrefsStore.getState().setGamificationEnabled(false));
    render(<ActivityDot />);
    add({ title: "A", gamification: true });
    expect(screen.queryByTestId("activity-dot")).not.toBeInTheDocument();
  });
});

describe("entry points", () => {
  it("the XP bar opens Activity", () => {
    render(<XpBar />);
    fireEvent.click(screen.getByRole("button", { name: /Open Activity/ }));
    expect(useActivityUiStore.getState().activityOpen).toBe(true);
  });

  it("the user menu has progress, Activity with a count, Trophies and Pause celebrations", () => {
    add({ title: "A" });
    add({ title: "B" });
    render(<UserMenu />);
    const trigger = screen.getByRole("button", { name: "Visitor menu" });
    expect(within(trigger).getByTestId("activity-dot")).toBeInTheDocument();
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(screen.getByTestId("menu-progress")).toHaveTextContent("Level 1");
    expect(screen.getByLabelText("2 unread")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Activity"));
    expect(useActivityUiStore.getState().activityOpen).toBe(true);

    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(screen.getByText("Pause celebrations · 1 h"));
    expect(useNotificationPrefsStore.getState().celebrationsPausedUntil).toBeGreaterThan(
      Date.now()
    );
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(screen.getByText("Resume celebrations"));
    expect(useNotificationPrefsStore.getState().celebrationsPausedUntil).toBeNull();

    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(screen.getByText("Trophies & challenges"));
    expect(useActivityUiStore.getState().trophyOpen).toBe(true);
  });
});
