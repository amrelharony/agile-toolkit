import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

const nav = vi.hoisted(() => ({ pathname: "/retro" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));
vi.mock("@/components/ui/icon-button", () => ({
  IconButton: ({
    label,
    onClick,
    icon,
  }: {
    label: string;
    onClick: () => void;
    icon: ReactNode;
  }) => (
    <button type="button" aria-label={label} onClick={onClick}>
      {icon}
    </button>
  ),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/lib/sonification/use-sonification", () => ({ useToolSonification: () => () => {} }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

import { DockedTimer } from "@/components/timer/docked-timer";
import { formatClock, timerRemaining, useDockTimer } from "@/lib/timer/dock-timer";
import { CeremonyTimerClient } from "@/app/(tools)/ceremony-timer/ceremony-timer-client";
import { useTimerSession } from "@/app/(tools)/ceremony-timer/store";

const T0 = Date.parse("2026-10-19T09:00:00Z");

beforeEach(() => {
  useDockTimer.setState({ timer: null });
  useTimerSession.setState({ agendaId: null, run: null });
  nav.pathname = "/retro";
});
afterEach(() => vi.useRealTimers());

describe("dock timer store", () => {
  it("counts down from the wall clock and pauses and resumes exactly", () => {
    useDockTimer.getState().publish({
      label: "Standup",
      href: "/ceremony-timer",
      totalSeconds: 900,
      endsAt: T0 + 600_000,
      pausedRemaining: 600,
    });
    const t = () => useDockTimer.getState().timer!;
    expect(timerRemaining(t(), T0 + 30_000)).toBe(570);
    useDockTimer.getState().pause(T0 + 30_000);
    expect(t().endsAt).toBeNull();
    expect(timerRemaining(t(), T0 + 999_999)).toBe(570);
    useDockTimer.getState().resume(T0 + 100_000);
    expect(timerRemaining(t(), T0 + 100_000)).toBe(570);
    expect(formatClock(570)).toBe("09:30");
    expect(formatClock(3725)).toBe("1:02:05");
  });
});

describe("DockedTimer", () => {
  it("shows the running timer on other pages, hides on its own page, and can be paused and stopped", () => {
    useDockTimer.getState().publish({
      label: "Standup",
      href: "/ceremony-timer",
      totalSeconds: 900,
      endsAt: Date.now() + 120_000,
      pausedRemaining: 120,
    });
    const { rerender } = render(<DockedTimer />);
    expect(screen.getByRole("link", { name: /Standup timer: 0[12]:\d\d left/ })).toHaveAttribute(
      "href",
      "/ceremony-timer"
    );
    fireEvent.click(screen.getByRole("button", { name: "Pause the timer" }));
    expect(useDockTimer.getState().timer?.endsAt).toBeNull();
    expect(screen.getByRole("button", { name: "Resume the timer" })).toBeInTheDocument();

    nav.pathname = "/ceremony-timer";
    rerender(<DockedTimer />);
    expect(screen.queryByRole("timer")).toBeNull();

    nav.pathname = "/retro";
    rerender(<DockedTimer />);
    fireEvent.click(screen.getByRole("button", { name: "Stop and close the timer" }));
    expect(useDockTimer.getState().timer).toBeNull();
  });

  it("is held still during a page change: the pill itself carries the mark", () => {
    useDockTimer.getState().publish({
      label: "Standup",
      href: "/ceremony-timer",
      totalSeconds: 900,
      endsAt: Date.now() + 120_000,
      pausedRemaining: 120,
    });
    const { container } = render(<DockedTimer />);
    const pill = container.firstElementChild;
    expect(pill).toHaveAttribute("data-vt-hold", "dock-timer");
    expect(pill).toContainElement(screen.getByRole("timer"));
    expect(container.querySelectorAll("[data-vt-hold]")).toHaveLength(1);
  });

  it("says time's up instead of counting below zero", () => {
    useDockTimer.getState().publish({
      label: "Retro",
      href: "/ceremony-timer",
      totalSeconds: 60,
      endsAt: Date.now() - 1000,
      pausedRemaining: 0,
    });
    render(<DockedTimer />);
    expect(screen.getByRole("timer")).toHaveTextContent("Time's up");
    expect(useDockTimer.getState().timer?.endsAt).toBeNull();
  });
});

describe("Ceremony Timer and the dock", () => {
  it("publishes a started timer and picks it back up after navigating away and back", async () => {
    nav.pathname = "/ceremony-timer";
    const first = render(<CeremonyTimerClient />);
    fireEvent.click(screen.getByRole("button", { name: /^Daily Scrum/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start timer" }));
    });
    const published = useDockTimer.getState().timer;
    expect(published).toMatchObject({
      label: "Daily Scrum",
      href: "/ceremony-timer",
      totalSeconds: 900,
    });
    expect(published?.endsAt).toBeGreaterThan(Date.now());
    first.unmount();

    render(<CeremonyTimerClient />);
    // Restored running: the control offers Pause, not Start.
    expect(await screen.findByRole("button", { name: "Pause timer" })).toBeInTheDocument();
  });

  it("clears the dock when the timer is started over", async () => {
    nav.pathname = "/ceremony-timer";
    render(<CeremonyTimerClient />);
    fireEvent.click(screen.getByRole("button", { name: /^Daily Scrum/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start timer" }));
    });
    expect(useDockTimer.getState().timer).not.toBeNull();
    // Start over confirms first (the time spent so far is lost), then clears.
    fireEvent.click(screen.getByRole("button", { name: "Start over" }));
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", { name: "Start over" })
      );
    });
    expect(useDockTimer.getState().timer).toBeNull();
  });
});
