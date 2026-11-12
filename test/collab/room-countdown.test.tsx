import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";

/**
 * The room countdown on screen: it counts from the end time by itself, and
 * at zero the one countdown with `alarm` says time's up once, rings the
 * shared alarm and counts the overtime up. The host's controls start,
 * pause, extend and stop the timer for everyone; Poker's adds "Reveal the
 * cards at zero".
 */

const alarm = vi.hoisted(() => ({ timesUp: vi.fn() }));
vi.mock("@/lib/celebrate/chime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/celebrate/chime")>()),
  timesUp: alarm.timesUp,
}));

import {
  RoomCountdown,
  RoomCountdownCard,
  RoomTimerControls,
} from "@/components/collab/room-countdown";
import { startRoomTimer, type RoomTimer } from "@/lib/realtime/room-timer";
import { useAlarmPrefs } from "@/lib/celebrate/alarm-prefs";

const NOW = Date.parse("2026-11-12T10:00:00Z");

beforeEach(() => {
  vi.useFakeTimers({
    now: NOW,
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
  alarm.timesUp.mockClear();
  useAlarmPrefs.setState({ sound: false });
});
afterEach(() => vi.useRealTimers());

function withAnnouncer(ui: React.ReactNode) {
  return render(<LiveAnnouncerProvider>{ui}</LiveAnnouncerProvider>);
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("RoomCountdown", () => {
  it("counts down by itself, then says time's up once and counts the overtime", () => {
    const timer = startRoomTimer(3, Date.now(), { label: "Vote" })!;
    withAnnouncer(<RoomCountdown timer={timer} alarm />);
    expect(screen.getByRole("timer", { name: "Vote: 3 seconds left" })).toHaveTextContent("0:03");
    advance(2000);
    expect(screen.getByRole("timer")).toHaveTextContent("0:01");
    expect(alarm.timesUp).not.toHaveBeenCalled();
    advance(1100);
    expect(screen.getByRole("timer")).toHaveTextContent("Time's up");
    expect(alarm.timesUp).toHaveBeenCalledTimes(1);
    expect(alarm.timesUp).toHaveBeenCalledWith({ title: "Vote: time's up" });
    advance(100);
    expect(screen.getByTestId("live-assertive")).toHaveTextContent("Vote: time's up");
    advance(64_900);
    expect(screen.getByText("+1:05 over")).toBeInTheDocument();
    expect(alarm.timesUp).toHaveBeenCalledTimes(1);
  });

  it("doesn't ring for a timer already over when the screen first sees it, or without `alarm`", () => {
    const late = startRoomTimer(60, Date.now() - 120_000)!;
    const { unmount } = withAnnouncer(<RoomCountdown timer={late} alarm />);
    expect(screen.getByRole("timer")).toHaveTextContent("Time's up");
    expect(screen.getByText("+1:00 over")).toBeInTheDocument();
    unmount();
    withAnnouncer(<RoomCountdown timer={startRoomTimer(1, Date.now())} />);
    advance(2000);
    expect(alarm.timesUp).not.toHaveBeenCalled();
  });

  it("shows a paused timer still, and one stopped at zero as time's up without a count", () => {
    const paused: RoomTimer = {
      endsAt: null,
      pausedSeconds: 90,
      totalSeconds: 120,
      label: "",
      autoReveal: false,
    };
    const { rerender } = withAnnouncer(<RoomCountdown timer={paused} />);
    expect(
      screen.getByRole("timer", { name: "paused, 1 minute 30 seconds left" })
    ).toHaveTextContent("1:30");
    expect(screen.getByText("Paused")).toBeInTheDocument();
    rerender(
      <LiveAnnouncerProvider>
        <RoomCountdown timer={{ ...paused, pausedSeconds: 0 }} />
      </LiveAnnouncerProvider>
    );
    expect(screen.getByRole("timer", { name: "time's up" })).toHaveTextContent("Time's up");
    expect(screen.queryByText(/over$/)).toBeNull();
  });

  it("renders nothing without a timer", () => {
    const { container } = withAnnouncer(<RoomCountdownCard timer={null} />);
    expect(container.querySelector("[role=timer]")).toBeNull();
  });
});

function Host({ autoRevealOption = false }: { autoRevealOption?: boolean }) {
  const [timer, setTimer] = useState<RoomTimer | null>(null);
  return (
    <>
      <RoomTimerControls timer={timer} onChange={setTimer} autoRevealOption={autoRevealOption} />
      <output data-testid="state">{JSON.stringify(timer)}</output>
    </>
  );
}

const state = () =>
  JSON.parse(screen.getByTestId("state").textContent ?? "null") as RoomTimer | null;

describe("RoomTimerControls", () => {
  it("starts a timer for everyone, then pauses, resumes, adds a minute and stops", () => {
    withAnnouncer(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Start a 5-minute timer" }));
    expect(state()).toMatchObject({ endsAt: NOW + 300_000, totalSeconds: 300 });
    advance(60_000);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(state()).toMatchObject({ endsAt: null, pausedSeconds: 240 });
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(state()?.endsAt).toBe(Date.now() + 240_000);
    fireEvent.click(screen.getByRole("button", { name: "1 minute more" }));
    expect(state()?.endsAt).toBe(Date.now() + 300_000);
    fireEvent.click(screen.getByRole("button", { name: "Stop timer" }));
    expect(state()).toBeNull();
    expect(screen.getByRole("group", { name: "Start a timer for everyone" })).toBeInTheDocument();
  });

  it("rings on the host's own screen at zero, and offers a minute more instead of Pause", () => {
    withAnnouncer(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Start a 1-minute timer" }));
    advance(61_000);
    expect(alarm.timesUp).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "1 more minute" }));
    expect(state()?.endsAt).toBe(Date.now() + 60_000);
  });

  it("Poker: carries 'Reveal the cards at zero' into the timer and changes it while it runs", () => {
    withAnnouncer(<Host autoRevealOption />);
    const reveal = screen.getByRole("switch", { name: "Reveal the cards at zero" });
    fireEvent.click(reveal);
    fireEvent.click(screen.getByRole("button", { name: "Start a 2-minute timer" }));
    expect(state()?.autoReveal).toBe(true);
    fireEvent.click(screen.getByRole("switch", { name: "Reveal the cards at zero" }));
    expect(state()?.autoReveal).toBe(false);
  });

  it("has the shared chime switch, off until someone turns it on", () => {
    withAnnouncer(<Host />);
    const chime = screen.getByRole("switch", { name: "Chime when time is up" });
    expect(chime).not.toBeChecked();
    fireEvent.click(chime);
    expect(useAlarmPrefs.getState().sound).toBe(true);
  });
});
