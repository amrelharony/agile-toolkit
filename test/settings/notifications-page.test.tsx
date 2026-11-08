import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

/**
 * Settings › Notifications: every section writes to its store, Focus shows
 * when it ends, haptics hide where the device can't vibrate, and the
 * Activity / Tips buttons act on the inbox and the muted keys. The clock is
 * moved with a Date subclass (not fake timers).
 */

const h = vi.hoisted(() => ({ preview: vi.fn(), toast: vi.fn() }));

vi.mock("@/lib/notify/moment-scheduler", () => ({ previewMoment: h.preview }));
vi.mock("@/lib/utils/toast", () => ({
  toast: Object.assign(h.toast, {
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

import NotificationsPage, { metadata } from "@/app/settings/notifications/page";
import {
  NotificationsClient,
  focusStatus,
  formatClock,
} from "@/app/settings/notifications/notifications-client";
import { useNotificationPrefsStore } from "@/lib/stores/notification-prefs-store";
import { useHapticsStore } from "@/lib/stores/haptics-store";
import { useSonificationStore } from "@/lib/stores/sonification-store";
import { useInboxStore } from "@/lib/notify/inbox-store";
import { FOCUS_UNTIL_OFF } from "@/lib/notify/prefs";

const RealDate = Date;
let nowMs = new RealDate(2026, 10, 8, 14, 0).getTime();
class ShiftedDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(nowMs);
    else super(...(args as [number]));
  }
  static now() {
    return nowMs;
  }
}

const originalVibrate = Object.getOwnPropertyDescriptor(navigator, "vibrate");

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("Date", ShiftedDate);
  nowMs = new RealDate(2026, 10, 8, 14, 0).getTime();
  h.preview.mockReset();
  h.toast.mockReset();
  useNotificationPrefsStore.setState(useNotificationPrefsStore.getInitialState(), true);
  useHapticsStore.setState(useHapticsStore.getInitialState(), true);
  useSonificationStore.setState(useSonificationStore.getInitialState(), true);
  useInboxStore.setState({ items: [], seeded: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalVibrate) Object.defineProperty(navigator, "vibrate", originalVibrate);
  else delete (navigator as { vibrate?: unknown }).vibrate;
});

function setVibrate(on: boolean) {
  if (on) {
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      writable: true,
      value: vi.fn(() => true),
    });
  } else {
    delete (navigator as { vibrate?: unknown }).vibrate;
  }
}

async function renderPage() {
  render(<NotificationsClient />);
  // Controls stay disabled until the stores have been read.
  await waitFor(() =>
    expect(screen.getByRole("switch", { name: "Interface sounds" })).not.toBeDisabled()
  );
}

function section(name: string) {
  return screen.getByRole("region", { name });
}

describe("Settings › Notifications page", () => {
  it("has a title, an intro and every section in one column", () => {
    setVibrate(true);
    render(<NotificationsPage />);
    expect(metadata.title).toBe("Notifications");
    expect(screen.getByRole("heading", { level: 1, name: "Notifications" })).toBeInTheDocument();
    const names = screen.getAllByRole("region").map((r) => r.getAttribute("aria-labelledby"));
    expect(names).toEqual([
      "celebrations-heading",
      "progress-heading",
      "confirmations-heading",
      "sound-heading",
      "haptics-heading",
      "quiet-time-heading",
      "tips-heading",
      "activity-heading",
    ]);
    // One column: a single vertical stack, no grid columns.
    const root = screen.getByTestId("notifications-settings");
    expect(root.className).toMatch(/space-y-6/);
    expect(root.className).not.toMatch(/grid-cols/);
  });

  it("disables controls until the stores are read, then enables them", async () => {
    render(<NotificationsClient />);
    expect(screen.getByRole("switch", { name: "Interface sounds" })).toBeDisabled();
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Interface sounds" })).not.toBeDisabled()
    );
  });

  it("celebrations: Balanced by default, picks a level and previews a moment", async () => {
    await renderPage();
    const group = within(section("Celebrations")).getByRole("radiogroup", {
      name: "Celebrations",
    });
    expect(within(group).getByRole("radio", { name: "Balanced" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    fireEvent.click(within(group).getByRole("radio", { name: "Quiet" }));
    expect(useNotificationPrefsStore.getState().celebrationLevel).toBe("quiet");
    expect(screen.getByText(/Amr never stops you for them/)).toBeInTheDocument();
    fireEvent.click(within(group).getByRole("radio", { name: "Lively" }));
    expect(useNotificationPrefsStore.getState().celebrationLevel).toBe("lively");

    fireEvent.click(screen.getByRole("button", { name: "Preview a moment" }));
    expect(h.preview).toHaveBeenCalledTimes(1);
  });

  it("shows a level saved by a newer build as the default without overwriting it", async () => {
    useNotificationPrefsStore.setState({ celebrationLevel: "off" });
    await renderPage();
    expect(screen.getByRole("radio", { name: "Balanced" })).toHaveAttribute("aria-checked", "true");
    expect(useNotificationPrefsStore.getState().celebrationLevel).toBe("off");
  });

  it("progress: gamification off pauses and disables the XP bar switch", async () => {
    await renderPage();
    const gam = screen.getByRole("switch", { name: "XP, levels and badges" });
    const bar = screen.getByRole("switch", { name: "Show the XP bar" });
    expect(gam).toHaveAttribute("aria-checked", "true");
    fireEvent.click(bar);
    expect(useNotificationPrefsStore.getState().showXpBar).toBe(false);
    fireEvent.click(gam);
    expect(useNotificationPrefsStore.getState().gamificationEnabled).toBe(false);
    expect(bar).toBeDisabled();
    expect(gam).toHaveAccessibleDescription(/streak keeps going and your totals are kept/);
  });

  it("confirmations: Copied / Exported as pop-ups is off by default and switches on", async () => {
    await renderPage();
    const sw = screen.getByRole("switch", { name: /Copied.*Exported.*pop-ups/ });
    expect(sw).toHaveAttribute("aria-checked", "false");
    fireEvent.click(sw);
    expect(useNotificationPrefsStore.getState().confirmationsAsToasts).toBe(true);
  });

  it("sound: off by default; the style picker needs sound on", async () => {
    await renderPage();
    const sw = screen.getByRole("switch", { name: "Interface sounds" });
    const minimal = screen.getByRole("radio", { name: "Minimal" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(minimal).toBeDisabled();
    fireEvent.click(sw);
    expect(useSonificationStore.getState().enabled).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Minimal" }));
    expect(useSonificationStore.getState().mode).toBe("minimal");
  });

  it("haptics: hidden where the device can't vibrate", async () => {
    setVibrate(false);
    await renderPage();
    expect(screen.queryByRole("region", { name: "Vibration" })).not.toBeInTheDocument();
  });

  it("haptics: Essential by default, per category, Off hides the categories", async () => {
    setVibrate(true);
    await renderPage();
    const region = section("Vibration");
    const modes = within(region).getByRole("radiogroup", { name: "Vibration" });
    expect(within(modes).getByRole("radio", { name: "Essential" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    const popups = within(region).getByRole("switch", { name: "Pop-ups" });
    expect(popups).toHaveAttribute("aria-checked", "false");
    fireEvent.click(within(region).getByRole("switch", { name: "Errors" }));
    expect(useHapticsStore.getState().perCategory.error).toBe(false);

    fireEvent.click(within(modes).getByRole("radio", { name: "Full" }));
    expect(useHapticsStore.getState().mode).toBe("full");
    fireEvent.click(within(modes).getByRole("radio", { name: "Off" }));
    expect(useHapticsStore.getState().mode).toBe("off");
    expect(within(region).queryByRole("switch", { name: "Errors" })).not.toBeInTheDocument();
  });

  it("haptics: a disabled store shows as Off, and choosing a mode turns it back on", async () => {
    setVibrate(true);
    useHapticsStore.setState({ enabled: false, mode: "full" });
    await renderPage();
    const modes = within(section("Vibration")).getByRole("radiogroup", { name: "Vibration" });
    expect(within(modes).getByRole("radio", { name: "Off" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    fireEvent.click(within(modes).getByRole("radio", { name: "Essential" }));
    expect(useHapticsStore.getState()).toMatchObject({ enabled: true, mode: "essential" });
  });

  it("Focus: 30 min shows when it ends; until off; End Focus", async () => {
    await renderPage();
    expect(screen.getByTestId("focus-status")).toHaveTextContent("Off");
    fireEvent.click(screen.getByRole("button", { name: "30 min" }));
    expect(useNotificationPrefsStore.getState().focusUntil).toBe(nowMs + 30 * 60_000);
    expect(screen.getByTestId("focus-status")).toHaveTextContent("Until 14:30");

    fireEvent.click(screen.getByRole("button", { name: "Until I turn it off" }));
    expect(useNotificationPrefsStore.getState().focusUntil).toBe(FOCUS_UNTIL_OFF);
    expect(screen.getByTestId("focus-status")).toHaveTextContent("Until you turn it off");

    fireEvent.click(screen.getByRole("button", { name: "End Focus" }));
    expect(useNotificationPrefsStore.getState().focusUntil).toBeNull();
    expect(screen.getByTestId("focus-status")).toHaveTextContent("Off");
    expect(screen.queryByRole("button", { name: "End Focus" })).not.toBeInTheDocument();
  });

  it("Focus that already ended reads Off", async () => {
    useNotificationPrefsStore.setState({ focusUntil: nowMs - 1 });
    await renderPage();
    expect(screen.getByTestId("focus-status")).toHaveTextContent("Off");
  });

  it("quiet hours: off by default, 22:00–08:00; edits wrap past midnight", async () => {
    await renderPage();
    const sw = screen.getByRole("switch", { name: "Quiet hours" });
    const from = screen.getByLabelText("From") as HTMLInputElement;
    const to = screen.getByLabelText("To") as HTMLInputElement;
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(from.value).toBe("22:00");
    expect(to.value).toBe("08:00");
    expect(from).toBeDisabled();
    fireEvent.click(sw);
    expect(from).not.toBeDisabled();
    fireEvent.change(from, { target: { value: "23:30" } });
    fireEvent.change(to, { target: { value: "06:15" } });
    // A half-typed value is ignored by the store.
    fireEvent.change(to, { target: { value: "" } });
    expect(useNotificationPrefsStore.getState().quietHours).toEqual({
      enabled: true,
      start: "23:30",
      end: "06:15",
    });
    expect(screen.getByText("Always quiet in live ceremonies and while presenting.")).toBeVisible();
  });

  it("tips: Show hidden tips again clears the muted keys", async () => {
    useNotificationPrefsStore.setState({ mutedKeys: ["info:A", "success:B"] });
    await renderPage();
    expect(screen.getByText(/2 tips are hidden/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show hidden tips again" }));
    expect(useNotificationPrefsStore.getState().mutedKeys).toEqual([]);
    expect(screen.getByRole("button", { name: "Show hidden tips again" })).toBeDisabled();
  });

  it("activity: Mark all read, then Clear with Undo", async () => {
    act(() => {
      useInboxStore.getState().add({ kind: "achievement", icon: "Award", title: "A" });
      useInboxStore.getState().add({ kind: "achievement", icon: "Award", title: "B" });
    });
    await renderPage();
    const region = section("Activity");
    expect(within(region).getByText(/2 items, 2 unread/)).toBeInTheDocument();
    fireEvent.click(within(region).getByRole("button", { name: "Mark all read" }));
    expect(useInboxStore.getState().items.every((i) => i.read)).toBe(true);
    expect(within(region).getByRole("button", { name: "Mark all read" })).toBeDisabled();

    const before = useInboxStore.getState().items;
    fireEvent.click(within(region).getByRole("button", { name: "Clear" }));
    expect(useInboxStore.getState().items).toEqual([]);
    expect(within(region).getByText("Activity is empty.")).toBeInTheDocument();
    // The Undo toast puts every row back.
    expect(h.toast).toHaveBeenCalledWith(
      "Activity cleared",
      expect.objectContaining({ kind: "undo" })
    );
    const opts = h.toast.mock.calls[0][1] as { action: { onClick: () => void } };
    act(() => opts.action.onClick());
    expect(useInboxStore.getState().items).toEqual(before);
  });

  it("activity: with gamification off, its hidden rows are not counted, marked read or cleared", async () => {
    useNotificationPrefsStore.setState({ gamificationEnabled: false });
    act(() => {
      useInboxStore
        .getState()
        .add({ kind: "achievement", icon: "Award", title: "Badge", gamification: true });
      useInboxStore.getState().add({ kind: "kudos", icon: "Heart", title: "Thanks" });
    });
    await renderPage();
    const region = section("Activity");
    expect(within(region).getByText(/1 item, 1 unread/)).toBeInTheDocument();
    fireEvent.click(within(region).getByRole("button", { name: "Mark all read" }));
    const byTitle = (t: string) => useInboxStore.getState().items.find((i) => i.title === t);
    expect(byTitle("Thanks")?.read).toBe(true);
    expect(byTitle("Badge")?.read).toBe(false);

    fireEvent.click(within(region).getByRole("button", { name: "Clear" }));
    expect(within(region).getByText("Activity is empty.")).toBeInTheDocument();
    expect(useInboxStore.getState().items.map((i) => i.title)).toEqual(["Badge"]);
  });

  it("activity: Undo after Clear keeps a row that arrived in between", async () => {
    act(() => {
      useInboxStore.getState().add({ kind: "achievement", icon: "Award", title: "Old" });
    });
    await renderPage();
    const region = section("Activity");
    fireEvent.click(within(region).getByRole("button", { name: "Clear" }));
    nowMs += 1000;
    act(() => {
      useInboxStore.getState().add({ kind: "achievement", icon: "Award", title: "New" });
    });
    const opts = h.toast.mock.calls[0][1] as { action: { onClick: () => void } };
    act(() => opts.action.onClick());
    expect(useInboxStore.getState().items.map((i) => i.title)).toEqual(["New", "Old"]);
  });
});

describe("helpers", () => {
  it("formatClock is 24-hour local time", () => {
    expect(formatClock(new RealDate(2026, 10, 8, 9, 5).getTime())).toBe("09:05");
    expect(formatClock(new RealDate(2026, 10, 8, 23, 59).getTime())).toBe("23:59");
  });

  it("focusStatus", () => {
    const now = new RealDate(2026, 10, 8, 14, 0).getTime();
    expect(focusStatus(null, now)).toBeNull();
    expect(focusStatus(now - 1, now)).toBeNull();
    expect(focusStatus(now + 90 * 60_000, now)).toBe("Until 15:30");
    expect(focusStatus(FOCUS_UNTIL_OFF, now)).toBe("Until you turn it off");
  });
});
