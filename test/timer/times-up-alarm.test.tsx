import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";

/**
 * One time's-up alarm for every timer (`timesUp` in lib/celebrate/chime):
 * the room countdowns, the Retro board's timer and a Retro participant's
 * view of it, the step timer and the docked timer. Each rings once at zero
 * and then counts the overtime up. Sound stays off unless the person turns
 * the shared switch on (or the timer's owner asked for it).
 */

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
const alarm = vi.hoisted(() => ({ timesUp: vi.fn() }));
vi.mock("@/lib/celebrate/chime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/celebrate/chime")>()),
  timesUp: alarm.timesUp,
}));

import * as chime from "@/lib/celebrate/chime";
import { useAlarmPrefs } from "@/lib/celebrate/alarm-prefs";
import { DockedTimer } from "@/components/timer/docked-timer";
import { DockOvertime } from "@/components/timer/dock-overtime";
import { DockClock } from "@/app/(tools)/icebreaker/components/dock-clock";
import { StepTimerPanel } from "@/app/(tools)/liberating-structures/components/step-timer-panel";
import { TimerWidget } from "@/app/(tools)/retro/components/timer-widget";
import { dockOvertime, useDockTimer, type DockedTimer as Docked } from "@/lib/timer/dock-timer";
import { startSteps, stepDock } from "@/lib/timer/step-timer";
import { publishTurn, startWalk, STANDUP_PATH } from "@/app/(tools)/standup/walk";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const T0 = Date.parse("2026-11-12T09:00:00Z");

beforeEach(() => {
  vi.useFakeTimers({
    now: T0,
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
  useDockTimer.setState({ timer: null });
  useAlarmPrefs.setState({ sound: false });
  alarm.timesUp.mockClear();
  nav.pathname = "/retro";
});
afterEach(() => vi.useRealTimers());

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("every timer rings the same alarm", () => {
  it.each([
    ["the docked timer", "src/components/timer/docked-timer.tsx"],
    ["the step timer", "src/app/(tools)/liberating-structures/components/step-timer-panel.tsx"],
    ["the Retro board's timer", "src/app/(tools)/retro/components/board.tsx"],
    ["every room countdown", "src/components/collab/room-countdown.tsx"],
  ])("%s calls timesUp from lib/celebrate/chime", (_name, file) => {
    const src = read(file);
    expect(src).toMatch(/import \{[^}]*\btimesUp\b[^}]*\} from "@\/lib\/celebrate\/chime"/);
    expect(src).toMatch(/\btimesUp\(/);
    // Nobody rings their own beeps beside it.
    expect(src).not.toMatch(/\bplayChime\(/);
  });

  it("a Retro participant's countdown and every room's phone view go through the shared countdown", () => {
    expect(read("src/app/(tools)/retro/room/room-controls.tsx")).toMatch(
      /<RoomCountdown timer=\{roomTimer\} alarm/
    );
    expect(read("src/components/collab/room-countdown.tsx")).toMatch(
      /export function RoomCountdownCard[\s\S]*<RoomCountdown timer=\{timer\} alarm/
    );
  });
});

describe("timesUp", () => {
  it("flashes the title, and chimes and buzzes only when sound is on", async () => {
    const real =
      await vi.importActual<typeof import("@/lib/celebrate/chime")>("@/lib/celebrate/chime");
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
    document.title = "Retro";
    real.timesUp();
    expect(document.title).toBe("⏰ Time's up — Agile Toolkit");
    expect(vibrate).not.toHaveBeenCalled();
    useAlarmPrefs.setState({ sound: true });
    real.timesUp({ title: "Vote: time's up" });
    expect(document.title).toBe("⏰ Vote: time's up — Agile Toolkit");
    expect(vibrate).toHaveBeenCalledTimes(1);
    // The caller can say no for this one.
    real.timesUp({ sound: false });
    expect(vibrate).toHaveBeenCalledTimes(1);
    advance(5000);
  });

  it("writes the overtime the same way everywhere", () => {
    expect(chime.overtimeText(0)).toBe("+0:00 over");
    expect(chime.overtimeText(65)).toBe("+1:05 over");
    expect(chime.overtimeText(3725)).toBe("+1:02:05 over");
  });
});

const standup = (o: Partial<Docked> = {}): Docked => ({
  label: "Standup",
  href: "/ceremony-timer",
  totalSeconds: 60,
  endsAt: T0 + 2000,
  pausedRemaining: 60,
  ...o,
});

describe("the docked timer", () => {
  it("stops at zero, remembers when, and counts the overtime", () => {
    useDockTimer.getState().publish(standup());
    useDockTimer.getState().expire(T0 + 1000); // not yet
    expect(useDockTimer.getState().timer?.endsAt).toBe(T0 + 2000);
    useDockTimer.getState().expire(T0 + 2500);
    const t = useDockTimer.getState().timer!;
    expect(t).toMatchObject({ endsAt: null, pausedRemaining: 0, endedAt: T0 + 2000 });
    expect(dockOvertime(t, T0 + 2000 + 75_000)).toBe(75);
    // Nothing to resume once it ran out.
    useDockTimer.getState().resume();
    expect(useDockTimer.getState().timer?.endsAt).toBeNull();
  });

  it("rings once away from its own page, with the owner's chime choice, then counts up", () => {
    useDockTimer.getState().publish(standup({ chime: true }));
    render(
      <LiveAnnouncerProvider>
        <DockedTimer />
      </LiveAnnouncerProvider>
    );
    advance(2100);
    expect(alarm.timesUp).toHaveBeenCalledTimes(1);
    expect(alarm.timesUp).toHaveBeenCalledWith({ sound: true });
    expect(screen.getByRole("timer")).toHaveTextContent("Time's up");
    advance(61_000);
    expect(screen.getByRole("timer")).toHaveTextContent("+1:01 over");
    expect(alarm.timesUp).toHaveBeenCalledTimes(1);
  });

  it("leaves the ringing to the owner's page when that page rings its own", () => {
    nav.pathname = "/ceremony-timer";
    useDockTimer.getState().publish(standup());
    render(
      <LiveAnnouncerProvider>
        <DockedTimer />
      </LiveAnnouncerProvider>
    );
    advance(3000);
    expect(useDockTimer.getState().timer?.endedAt).toBe(T0 + 2000);
    expect(alarm.timesUp).not.toHaveBeenCalled();
  });

  it.each([
    ["Six Hats", "/six-hats"],
    ["Icebreaker", "/icebreaker"],
    ["Premortem", "/premortem"],
  ])("rings on %s's own page, which shows the clock but rings nothing itself", (_name, href) => {
    nav.pathname = href;
    useDockTimer.getState().publish(standup({ href }));
    render(
      <LiveAnnouncerProvider>
        <DockedTimer />
      </LiveAnnouncerProvider>
    );
    advance(2100);
    expect(alarm.timesUp).toHaveBeenCalledTimes(1);
    // The pill itself stays hidden on its own page.
    expect(screen.queryByRole("timer")).toBeNull();
  });

  it("the owner page's clock counts the overtime up beside time's up", () => {
    nav.pathname = "/icebreaker";
    useDockTimer.getState().publish(standup({ href: "/icebreaker", label: "Warm-up" }));
    function Page() {
      const timer = useDockTimer((s) => s.timer);
      return timer ? <DockClock timer={timer} onStop={() => {}} /> : null;
    }
    render(
      <LiveAnnouncerProvider>
        <Page />
        <DockedTimer />
      </LiveAnnouncerProvider>
    );
    advance(2100);
    expect(screen.getByRole("timer", { name: "Warm-up: time's up" })).toHaveTextContent(
      "Time's up+0:00 over"
    );
    advance(65_000);
    expect(screen.getByRole("timer", { name: "Warm-up: time's up" })).toHaveTextContent(
      "+1:05 over"
    );
  });

  it("rings the standup's turn clock on /standup by the title only, never by sound", () => {
    // Even with the shared switch on: a standup turn's end is never a sound.
    useAlarmPrefs.setState({ sound: true });
    nav.pathname = STANDUP_PATH;
    publishTurn(startWalk(["Alice", "Bo"], "2026-11-12", 2, T0));
    expect(useDockTimer.getState().timer).toMatchObject({
      label: "Standup: Alice",
      href: STANDUP_PATH,
      chime: false,
    });
    render(
      <LiveAnnouncerProvider>
        <DockedTimer />
      </LiveAnnouncerProvider>
    );
    advance(2100);
    expect(alarm.timesUp).toHaveBeenCalledTimes(1);
    expect(alarm.timesUp).toHaveBeenCalledWith({ sound: false });
  });

  it("shows no overtime for a timer that hasn't run out, or that nobody saw end", () => {
    const { container, rerender } = render(<DockOvertime timer={standup()} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<DockOvertime timer={standup({ endsAt: null, pausedRemaining: 0 })} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("the step timer", () => {
  it("rings when the step runs out on its page, and counts the overtime until the next step", () => {
    const run = startSteps("/liberating-structures", "1-2-4-All", [
      { id: "a", label: "Alone", seconds: 1 },
      { id: "b", label: "Pairs", seconds: 60 },
    ]);
    useDockTimer.getState().publish(stepDock(run, Date.now()));
    function Panel() {
      const timer = useDockTimer((s) => s.timer);
      return (
        <StepTimerPanel
          run={run}
          timer={timer}
          refFor={() => () => {}}
          onPause={() => {}}
          onResume={() => {}}
          onNext={() => {}}
          onStop={() => {}}
        />
      );
    }
    nav.pathname = "/liberating-structures";
    render(
      <LiveAnnouncerProvider>
        <Panel />
        <DockedTimer />
      </LiveAnnouncerProvider>
    );
    expect(alarm.timesUp).not.toHaveBeenCalled();
    advance(1100);
    advance(10);
    expect(alarm.timesUp).toHaveBeenCalledTimes(1);
    advance(30_000);
    expect(screen.getByRole("timer", { name: "Alone: time's up" })).toHaveTextContent("+0:30 over");
    expect(screen.getByRole("switch", { name: "Chime when time is up" })).not.toBeChecked();
  });
});

describe("the Retro board's timer", () => {
  it("shows time's up and counts the overtime from when it rang", () => {
    render(
      <TimerWidget
        seconds={0}
        running={false}
        overSince={Date.now()}
        onToggle={() => {}}
        onReset={() => {}}
        onChange={() => {}}
      />
    );
    expect(screen.getByText("Time's up")).toBeInTheDocument();
    advance(45_000);
    expect(screen.getByText("+0:45 over")).toBeInTheDocument();
  });

  it("shows the clock as before when nothing ran out", () => {
    render(
      <TimerWidget
        seconds={300}
        running={false}
        onToggle={() => {}}
        onReset={() => {}}
        onChange={() => {}}
      />
    );
    expect(screen.getByText("5:00")).toBeInTheDocument();
    expect(screen.queryByText(/over$/)).toBeNull();
  });
});
