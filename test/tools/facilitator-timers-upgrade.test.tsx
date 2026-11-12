import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";

/**
 * Facilitator Timers (tools plan, phase 1, P1.7): Pomodoro, a "Back at"
 * break screen and Crazy 8s on the docked timer with the shared alarm; the
 * meeting cost ticker that keeps its numbers in this tab; focus sounds and
 * a soundboard made in the browser; and an agenda drafted from the
 * meeting's goal (AI, or the nearest template) that goes to the Ceremony
 * Timer's saved agendas. Plus the contract: example, export, Undo,
 * validation before anything starts.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/facilitator-timers",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
const toastSpy = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn() }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
const exported = vi.hoisted(() => ({ markdown: "" }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => {
    exported.markdown = markdown ?? "";
    return null;
  },
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));
const logs = vi.hoisted(() => ({ calls: [] as [string, Record<string, unknown> | undefined][] }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload?: Record<string, unknown>) => logs.calls.push([action, payload]),
  }),
}));
const alarm = vi.hoisted(() => ({ playChime: vi.fn(), vibrate: vi.fn(), flashTitle: vi.fn() }));
vi.mock("@/lib/celebrate/chime", () => alarm);
const cheers = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock("@/lib/celebrate/cheer", () => ({
  cheer: (...args: unknown[]) => cheers.calls.push(args),
}));
const audio = vi.hoisted(() => ({
  played: [] as string[],
  focus: [] as { sound: string; volume: number; stopped: boolean; volumes: number[] }[],
}));
vi.mock("@/lib/facilitator-timers/sounds", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/facilitator-timers/sounds")>();
  return {
    ...actual,
    canPlaySounds: () => true,
    playSoundboard: (s: string) => {
      audio.played.push(s);
      return true;
    },
    startFocusSound: (sound: string, volume: number) => {
      const entry = { sound, volume, stopped: false, volumes: [] as number[] };
      audio.focus.push(entry);
      return {
        sound,
        setVolume: (v: number) => entry.volumes.push(v),
        stop: () => {
          entry.stopped = true;
        },
      };
    },
  };
});

import { FacilitatorTimersClient } from "@/app/(tools)/facilitator-timers/facilitator-timers-client";
import { buildExample } from "@/app/(tools)/facilitator-timers/example";
import { toMarkdown } from "@/app/(tools)/facilitator-timers/markdown";
import {
  validateAgendaRequest,
  validateBreak,
  validateCost,
  validatePomodoro,
} from "@/app/(tools)/facilitator-timers/forms";
import { usePresentation } from "@/components/presentation/presentation-mode";
import { useTimerSettings } from "@/app/(tools)/ceremony-timer/store";
import { breakRun, newRun, pomodoroSteps, stepDock } from "@/lib/facilitator-timers/model";
import {
  COST_INITIAL,
  FT_SETTINGS_INITIAL,
  useCostTicker,
  useFacilitatorSettings,
  useFtSession,
} from "@/lib/facilitator-timers/store";
import { FACILITATOR_TIMERS_ACTIONS } from "@/lib/history/event-actions";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { countdown, useDockTimer } from "@/lib/timer/dock-timer";
import { isExampleId } from "@/lib/utils/example-id";

const T0 = new Date(2026, 10, 12, 10, 0, 0).getTime(); // 10:00 local

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <FacilitatorTimersClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const field = (name: RegExp) => screen.getByRole("spinbutton", { name });
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
const tick = (seconds: number) =>
  act(() => {
    vi.advanceTimersByTime(seconds * 1000);
  });
const timerText = () => screen.getByRole("timer").textContent;
/** The step that's on, as the timer names it ("Focus 1 of 4: 25:00 left"). */
const onStep = () => screen.getByRole("timer").getAttribute("aria-label")?.split(":")[0];
const logged = (action: string) => logs.calls.filter(([a]) => a === action);
const pickTimer = (name: string) =>
  fireEvent.click(
    within(screen.getByRole("radiogroup", { name: "Timer" })).getByRole("radio", { name })
  );
const lastToast = () => {
  const [label, opts] = toastSpy.mock.calls[toastSpy.mock.calls.length - 1];
  return { label: label as string, undo: () => act(() => opts.action.onClick()) };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  toastSpy.mockReset();
  Object.values(alarm).forEach((f) => f.mockReset());
  logs.calls = [];
  cheers.calls = [];
  audio.played = [];
  audio.focus = [];
  exported.markdown = "";
  localStorage.clear();
  sessionStorage.clear();
  useDockTimer.setState({ timer: null });
  useFtSession.setState({ run: null });
  useCostTicker.setState({ ...COST_INITIAL });
  useFacilitatorSettings.setState({ ...FT_SETTINGS_INITIAL });
  useTimerSettings.setState({ named: [] });
  useWorkspaceStore.setState({ teamMembers: [] });
  act(() => usePresentation.getState().set(false));
});
afterEach(() => {
  vi.useRealTimers();
});

/* -------------------------------------------------------------------------- */
/*  First visit and the example                                                */
/* -------------------------------------------------------------------------- */

describe("first visit", () => {
  it("starts empty with an example to load, and the example clears to the blank page", () => {
    renderPage();
    expect(screen.getByText(/^No timer on yet/)).toBeInTheDocument();
    click("Load an example");
    expect(screen.getByText("Example data.")).toBeInTheDocument();
    const draft = screen.getByRole("list", { name: "Agenda draft" });
    expect(within(draft).getAllByRole("listitem")).toHaveLength(7);
    expect(exported.markdown).toContain("## Agenda draft: Sketch ideas for a simpler sign-up flow");
    expect(exported.markdown).toContain("**Total: 90 minutes.**");
    click("Clear example");
    expect(useFacilitatorSettings.getState().agenda).toEqual({
      goal: "",
      minutes: null,
      segments: [],
    });
    expect(screen.getByRole("button", { name: "Load an example" })).toBeInTheDocument();
  }, 15_000);

  it("builds the example from example ids, with no money in it", () => {
    const example = buildExample();
    expect(example.segments.every((s) => isExampleId(s.id))).toBe(true);
    expect(example.segments.reduce((s, x) => s + x.minutes, 0)).toBe(90);
    expect(JSON.stringify(example)).not.toMatch(/rate|cost|salary/i);
  });

  it("keeps sounds and the chime off until someone turns them on", () => {
    renderPage();
    expect(screen.getByRole("switch", { name: "Chime when time is up" })).toHaveAttribute(
      "aria-checked",
      "false"
    );
    expect(
      screen.getByRole("switch", { name: "Show the soundboard while presenting" })
    ).toHaveAttribute("aria-checked", "false");
    expect(audio.focus).toEqual([]);
    expect(audio.played).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/*  Pomodoro                                                                   */
/* -------------------------------------------------------------------------- */

describe("Pomodoro", () => {
  it("starts on the docked timer with the saved lengths and logs the start", () => {
    renderPage();
    click("Start Pomodoro");
    expect(useDockTimer.getState().timer).toMatchObject({
      label: "Pomodoro · Focus 1 of 4",
      href: "/facilitator-timers",
      totalSeconds: 1500,
    });
    expect(onStep()).toBe("Focus 1 of 4");
    expect(timerText()).toBe("25:00");
    expect(screen.getByText("Next: Short break 1 of 3, 5 min")).toBeInTheDocument();
    expect(logged(FACILITATOR_TIMERS_ACTIONS.TIMER_STARTED)).toEqual([
      ["timer_started", { timer: "pomodoro", seconds: 6900 }],
    ]);
    expect(logged(FACILITATOR_TIMERS_ACTIONS.SETTINGS_SAVED)).toEqual([]);
  });

  it("checks the lengths before anything starts", () => {
    renderPage();
    type(field(/^Focus minutes/), "");
    type(field(/^Rounds/), "40");
    click("Start Pomodoro");
    expect(screen.getByText("Enter the focus minutes.")).toBeInTheDocument();
    expect(screen.getByText("Enter a whole number from 1 to 12.")).toBeInTheDocument();
    expect(useDockTimer.getState().timer).toBeNull();
    expect(validatePomodoro({ workMinutes: "2.5", breakMinutes: "5", rounds: "2" })).toMatchObject({
      ok: false,
      errors: { workMinutes: "Enter a whole number from 1 to 120." },
    });
  });

  it("keeps new lengths for next time", () => {
    renderPage();
    type(field(/^Focus minutes/), "50");
    type(field(/^Break minutes/), "10");
    type(field(/^Rounds/), "2");
    click("Start Pomodoro");
    expect(useFacilitatorSettings.getState().pomodoro).toEqual({
      workMinutes: 50,
      breakMinutes: 10,
      rounds: 2,
    });
    expect(logged(FACILITATOR_TIMERS_ACTIONS.SETTINGS_SAVED)).toHaveLength(1);
    expect(timerText()).toBe("50:00");
  });

  it("moves on by itself at zero with the cue, and finishes with Amr's cheer", () => {
    useFacilitatorSettings.setState({
      chime: true,
      pomodoro: { workMinutes: 1, breakMinutes: 1, rounds: 2 },
    });
    renderPage();
    click("Start Pomodoro");
    tick(60);
    expect(onStep()).toBe("Short break 1 of 1");
    expect(useDockTimer.getState().timer).toMatchObject({ label: "Pomodoro · Short break 1 of 1" });
    expect(alarm.playChime).toHaveBeenLastCalledWith(1);
    expect(alarm.flashTitle).toHaveBeenCalledWith("Time's up");
    tick(60);
    expect(onStep()).toBe("Focus 2 of 2");
    tick(60);
    expect(screen.getByText(/^Pomodoro done: all 3 steps/)).toBeInTheDocument();
    expect(useDockTimer.getState().timer).toBeNull();
    expect(alarm.playChime).toHaveBeenLastCalledWith(3);
    expect(alarm.vibrate).toHaveBeenCalled();
    expect(logged(FACILITATOR_TIMERS_ACTIONS.TIMER_FINISHED)).toEqual([
      ["timer_finished", { timer: "pomodoro", seconds: 180 }],
    ]);
    expect(cheers.calls).toEqual([["facilitator-timers", "done"]]);
    click("Close");
    expect(screen.getByText(/^No timer on yet/)).toBeInTheDocument();
  });

  it("still cues the next round on time while the tab is hidden", () => {
    useFacilitatorSettings.setState({ pomodoro: { workMinutes: 1, breakMinutes: 1, rounds: 2 } });
    renderPage();
    click("Start Pomodoro");
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    tick(61);
    expect(alarm.flashTitle).toHaveBeenCalledWith("Time's up");
    expect(useDockTimer.getState().timer).toMatchObject({ label: "Pomodoro · Short break 1 of 1" });
    visibility.mockRestore();
  });

  it("stays quiet at zero when the chime is off, but still says so", () => {
    useFacilitatorSettings.setState({ pomodoro: { workMinutes: 1, breakMinutes: 1, rounds: 2 } });
    renderPage();
    click("Start Pomodoro");
    tick(60);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(alarm.playChime).not.toHaveBeenCalled();
    expect(alarm.flashTitle).toHaveBeenCalledTimes(1);
    // Politely: the shell's docked timer says "time's up" assertively first.
    expect(screen.getByTestId("live-polite")).toHaveTextContent("Short break 1 of 1: 1 min.");
    expect(screen.getByTestId("live-assertive")).not.toHaveTextContent("Short break");
  });

  it("keeps focus on its first control as a step runs out and the next one starts", () => {
    useFacilitatorSettings.setState({ pomodoro: { workMinutes: 1, breakMinutes: 1, rounds: 2 } });
    renderPage();
    click("Start Pomodoro");
    const pause = screen.getByRole("button", { name: "Pause" });
    expect(pause).toHaveFocus();
    tick(60);
    expect(onStep()).toBe("Short break 1 of 1");
    expect(screen.getByRole("button", { name: "Pause" })).toBe(pause);
    expect(pause).toHaveFocus();
    click("Stop");
    expect(
      within(screen.getByRole("radiogroup", { name: "Timer" })).getByRole("radio", {
        name: "Pomodoro",
      })
    ).toHaveFocus();
  });

  it("moves focus to the timer's controls when it goes on the big screen", () => {
    renderPage();
    click("Start Pomodoro");
    click("Show on the big screen");
    expect(screen.getByRole("button", { name: "Pause" })).toHaveFocus();
  });

  it("pauses and resumes on the dock, and Stop frees it", () => {
    renderPage();
    click("Start Pomodoro");
    tick(30);
    click("Pause");
    expect(useDockTimer.getState().timer).toMatchObject({ endsAt: null, pausedRemaining: 1470 });
    tick(120);
    expect(timerText()).toBe("24:30");
    expect(logged(FACILITATOR_TIMERS_ACTIONS.TIMER_PAUSED)).toEqual([
      ["timer_paused", { timer: "pomodoro" }],
    ]);
    click("Resume");
    tick(30);
    expect(timerText()).toBe("24:00");
    click("Next step");
    expect(onStep()).toBe("Short break 1 of 3");
    click("Stop");
    expect(useDockTimer.getState().timer).toBeNull();
    expect(useFtSession.getState().run).toBeNull();
  }, 15_000);

  it("never takes the dock from a ceremony, and says who holds it", () => {
    useDockTimer.setState({
      timer: {
        ...countdown("Retro · Gather data", "/ceremony-timer", 1800),
        endsAt: T0 + 1_800_000,
      },
    });
    renderPage();
    expect(screen.getByText(/^“Retro · Gather data” is on the docked timer/)).toBeInTheDocument();
    click("Start Pomodoro");
    expect(useDockTimer.getState().timer?.href).toBe("/ceremony-timer");
    expect(useFtSession.getState().run).toBeNull();
  });

  it("starts nothing else while a timer is on", () => {
    renderPage();
    click("Start Pomodoro");
    pickTimer("Crazy 8s");
    click("Start Crazy 8s");
    expect(useDockTimer.getState().timer?.label).toBe("Pomodoro · Focus 1 of 4");
    expect(screen.getByText("Pomodoro is on. Stop it to start another timer.")).toHaveAttribute(
      "role",
      "status"
    );
  });

  it("waits on return when a step ran out while the page was closed", () => {
    const run = newRun("pomodoro", pomodoroSteps({ workMinutes: 25, breakMinutes: 5, rounds: 2 }));
    useFtSession.setState({ run });
    useDockTimer.setState({ timer: { ...stepDock(run, T0)!, endsAt: null, pausedRemaining: 0 } });
    renderPage();
    expect(timerText()).toBe("Time's up");
    expect(useDockTimer.getState().timer?.label).toBe("Pomodoro · Focus 1 of 2");
    click("Start short break 1 of 1");
    expect(useDockTimer.getState().timer).toMatchObject({ label: "Pomodoro · Short break 1 of 1" });
  });

  it("drops a run whose clock was stopped on another page", () => {
    useFtSession.setState({ run: newRun("pomodoro", pomodoroSteps(FT_SETTINGS_INITIAL.pomodoro)) });
    renderPage();
    expect(useFtSession.getState().run).toBeNull();
    expect(screen.getByText(/^No timer on yet/)).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/*  Breaks and Crazy 8s                                                        */
/* -------------------------------------------------------------------------- */

describe("the break screen", () => {
  it("counts down to the time to be back and keeps the minutes for next time", () => {
    renderPage();
    pickTimer("Break");
    type(field(/^Break minutes/), "15");
    click("Start the break");
    expect(screen.getByText("Back at 10:15")).toBeInTheDocument();
    expect(timerText()).toBe("15:00");
    expect(useFacilitatorSettings.getState().breakMinutes).toBe(15);
    expect(logged(FACILITATOR_TIMERS_ACTIONS.BREAK_STARTED)).toEqual([
      ["break_started", { minutes: 15 }],
    ]);
    expect(useDockTimer.getState().timer).toMatchObject({ label: "Break", endsAt: T0 + 900_000 });
  });

  it("takes a clock time, refusing one that has passed", () => {
    renderPage();
    pickTimer("Break");
    fireEvent.click(screen.getByRole("radio", { name: "Time to be back" }));
    const back = screen.getByLabelText(/^Back at/);
    type(back, "09:30");
    click("Start the break");
    expect(screen.getByText("09:30 has passed. Enter a time later today.")).toBeInTheDocument();
    type(back, "10:45");
    click("Start the break");
    expect(screen.getByText("Back at 10:45")).toBeInTheDocument();
    expect(timerText()).toBe("45:00");
  });

  it("says welcome back at the time, counts the minutes over, and ends on End break", () => {
    useFacilitatorSettings.setState({ chime: true });
    renderPage();
    pickTimer("Break");
    type(field(/^Break minutes/), "1");
    click("Start the break");
    tick(60);
    expect(screen.getByText("Time's up: welcome back.")).toBeInTheDocument();
    expect(alarm.playChime).toHaveBeenCalledWith(3);
    expect(logged(FACILITATOR_TIMERS_ACTIONS.TIMER_FINISHED)).toEqual([
      ["timer_finished", { timer: "break", seconds: 60 }],
    ]);
    tick(30);
    expect(timerText()).toBe("+0:30");
    click("End break");
    expect(useDockTimer.getState().timer).toBeNull();
  });

  it("pauses on its clock: the countdown and the dock stop, and the return time moves on resume", () => {
    useFacilitatorSettings.setState({ chime: true });
    renderPage();
    pickTimer("Break");
    type(field(/^Break minutes/), "10");
    click("Start the break");
    tick(60);
    click("Pause");
    expect(useDockTimer.getState().timer).toMatchObject({ endsAt: null, pausedRemaining: 540 });
    tick(120);
    expect(timerText()).toBe("09:00");
    expect(screen.getByText("Break paused")).toBeInTheDocument();
    expect(exported.markdown).toContain("- Break: paused, 9 min left.");
    // Back at 10:10 when it started; two minutes paused make it 10:12.
    click("Resume");
    expect(screen.getByText("Back at 10:12")).toBeInTheDocument();
    expect(useFtSession.getState().run?.backAt).toBe(T0 + 12 * 60_000);
    tick(539);
    expect(timerText()).toBe("00:01");
    expect(logged(FACILITATOR_TIMERS_ACTIONS.TIMER_FINISHED)).toEqual([]);
    tick(1);
    expect(screen.getByText("Time's up: welcome back.")).toBeInTheDocument();
    expect(alarm.flashTitle).toHaveBeenCalledWith("Time's up");
    expect(alarm.playChime).toHaveBeenCalledWith(3);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByTestId("live-polite")).toHaveTextContent("Break's over: welcome back.");
    expect(logged(FACILITATOR_TIMERS_ACTIONS.TIMER_FINISHED)).toEqual([
      ["timer_finished", { timer: "break", seconds: 600 }],
    ]);
    tick(29.9);
    expect(timerText()).toBe("+0:30");
  });

  it("follows a pause and resume on the pill on another page", () => {
    useFtSession.setState({ run: breakRun(T0 + 600_000, T0) });
    useDockTimer.setState({ timer: stepDock(breakRun(T0 + 600_000, T0), T0) });
    renderPage();
    tick(60);
    act(() => useDockTimer.getState().pause());
    tick(300);
    expect(timerText()).toBe("09:00");
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
    act(() => useDockTimer.getState().resume());
    expect(screen.getByText("Back at 10:15")).toBeInTheDocument();
    expect(useFtSession.getState().run?.backAt).toBe(T0 + 15 * 60_000);
  });

  it("fills the big screen with the break while presenting", () => {
    useFtSession.setState({ run: breakRun(T0 + 600_000, T0) });
    useDockTimer.setState({ timer: stepDock(breakRun(T0 + 600_000, T0), T0) });
    renderPage();
    click("Show on the big screen");
    expect(usePresentation.getState().presenting).toBe(true);
    expect(screen.getByText("Back at 10:10")).toHaveClass("text-5xl");
    expect(
      screen.getByRole("radiogroup", { name: "Timer", hidden: true }).closest(".hidden")
    ).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Show on the big screen" })).toBeNull();
  });
});

describe("Crazy 8s", () => {
  it("gives each sketch its minute, with a cue as the next one starts", () => {
    useFacilitatorSettings.setState({ chime: true });
    renderPage();
    pickTimer("Crazy 8s");
    expect(screen.getByText(/^8 sketches, 1 min each \(8 min\)/)).toBeInTheDocument();
    click("Start Crazy 8s");
    expect(onStep()).toBe("Sketch 1 of 8");
    tick(60);
    expect(onStep()).toBe("Sketch 2 of 8");
    expect(alarm.playChime).toHaveBeenCalledWith(1);
    for (let sketch = 2; sketch <= 8; sketch++) tick(60);
    expect(screen.getByText(/^Crazy 8s done: all 8 steps/)).toBeInTheDocument();
    expect(alarm.playChime).toHaveBeenCalledTimes(8);
  });
});

/* -------------------------------------------------------------------------- */
/*  The meeting cost ticker                                                    */
/* -------------------------------------------------------------------------- */

describe("the meeting cost ticker", () => {
  it("needs people, a rate and a currency: nothing is filled in", () => {
    renderPage();
    click("Start the ticker");
    expect(screen.getByText("Enter the number of people.")).toBeInTheDocument();
    expect(screen.getByText("Enter a rough hourly rate.")).toBeInTheDocument();
    expect(screen.getByText("Enter a currency, such as EUR.")).toBeInTheDocument();
    expect(useCostTicker.getState().clock).toBeNull();
    expect(validateCost({ attendees: "3", hourlyRate: "0", currency: "EUR" })).toMatchObject({
      ok: false,
    });
  });

  it("counts the team from the roster", () => {
    useWorkspaceStore.setState({
      teamMembers: [
        { id: "m1", name: "Priya" },
        { id: "m2", name: "Diego" },
        { id: "m3", name: "Mei" },
      ] as never,
    });
    renderPage();
    click("Count the team (3)");
    expect(field(/^People/)).toHaveValue(3);
  });

  it("grows while the meeting runs, keeps its numbers in this tab, and exports no money", () => {
    renderPage();
    type(field(/^People/), "6");
    type(field(/^Rough hourly rate/), "60");
    type(screen.getByRole("textbox", { name: /^Currency/ }), "EUR");
    click("Start the ticker");
    tick(90);
    const amount = screen.getAllByRole("timer").find((t) => t.textContent?.includes("€"));
    expect(amount?.textContent).toBe("€9.00");
    expect(screen.getByText(/€6\.00 a minute/)).toBeInTheDocument();
    expect(logged(FACILITATOR_TIMERS_ACTIONS.TIMER_STARTED)).toEqual([
      ["timer_started", { timer: "cost" }],
    ]);
    // The rate lives in this tab's sessionStorage, never in the synced store.
    expect(JSON.stringify(localStorage)).not.toContain("hourlyRate");
    expect(sessionStorage.getItem("agile-toolkit:facilitator-timers:cost")).toContain("60");
    expect(exported.markdown).toContain("6 people for 1 min 30 s: 0.2 person-hours.");
    expect(exported.markdown).not.toMatch(/€|EUR|60/);
  });

  it("keeps focus on the ticker and the form as they swap", () => {
    renderPage();
    type(field(/^People/), "6");
    type(field(/^Rough hourly rate/), "60");
    type(screen.getByRole("textbox", { name: /^Currency/ }), "EUR");
    click("Start the ticker");
    expect(screen.getByRole("button", { name: "Pause" })).toHaveFocus();
    click("Change the numbers");
    expect(field(/^People/)).toHaveFocus();
    click("Cancel");
    expect(screen.getByRole("button", { name: "Change the numbers" })).toHaveFocus();
    click("Change the numbers");
    click("Save and carry on");
    expect(screen.getByRole("button", { name: "Pause" })).toHaveFocus();
  }, 15_000);

  it("sizes the presented amount to the screen, so a long one fits a phone", () => {
    useCostTicker.setState({
      attendees: 12,
      hourlyRate: 900,
      currency: "EGP",
      clock: { baseMs: 3_600_000, since: null },
    });
    renderPage();
    act(() => usePresentation.getState().set(true));
    const amount = screen.getAllByRole("timer").find((t) => t.textContent?.includes("EGP"));
    expect(amount?.textContent).toMatch(/^EGP\s10,800$/);
    expect(amount?.className).toContain("text-[clamp(");
    expect(amount?.className).toContain("max-w-full");
    expect(amount?.className).not.toMatch(/\btext-5xl\b/);
  });

  it("pauses, carries on, and resets with Undo", () => {
    renderPage();
    type(field(/^People/), "4");
    type(field(/^Rough hourly rate/), "30");
    type(screen.getByRole("textbox", { name: /^Currency/ }), "credits");
    click("Start the ticker");
    tick(60);
    click("Pause");
    tick(600);
    const amount = () =>
      screen.getAllByRole("timer").find((t) => /credits/.test(t.textContent ?? ""));
    expect(amount()?.textContent).toBe("2.00 credits");
    click("Resume");
    tick(60);
    expect(amount()?.textContent).toBe("4.00 credits");
    click("Reset");
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Reset ticker" })
    );
    expect(useCostTicker.getState().clock).toBeNull();
    expect(useCostTicker.getState().hourlyRate).toBe(30);
    lastToast().undo();
    expect(useCostTicker.getState().clock).not.toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/*  Sounds                                                                     */
/* -------------------------------------------------------------------------- */

describe("focus sounds and the soundboard", () => {
  it("plays a focus sound only on Play, follows the volume, and stops when the page closes", () => {
    const { unmount } = renderPage();
    fireEvent.click(screen.getByRole("radio", { name: "Low hum" }));
    click("Play low hum");
    expect(audio.focus).toEqual([expect.objectContaining({ sound: "hum", volume: 0.5 })]);
    fireEvent.change(screen.getByRole("slider", { name: "Volume" }), { target: { value: "20" } });
    expect(audio.focus[0].volumes).toEqual([0.2]);
    expect(useFacilitatorSettings.getState()).toMatchObject({
      focusSound: "hum",
      focusVolume: 0.2,
    });
    fireEvent.click(screen.getByRole("radio", { name: "Slow waves" }));
    expect(audio.focus.map((f) => [f.sound, f.stopped])).toEqual([
      ["hum", true],
      ["waves", false],
    ]);
    unmount();
    expect(audio.focus[1].stopped).toBe(true);
  });

  it("keeps the focus sound playing while presenting a timer", () => {
    renderPage();
    click("Play soft rain");
    click("Start Pomodoro");
    act(() => usePresentation.getState().set(true));
    expect(audio.focus[0].stopped).toBe(false);
  });

  it("plays the soundboard on a press, asks Amr to cheer, and can follow into Present mode", () => {
    renderPage();
    const board = screen.getByRole("group", { name: "Soundboard" });
    fireEvent.click(within(board).getByRole("button", { name: "Gong" }));
    fireEvent.click(within(board).getByRole("button", { name: "Applause" }));
    expect(audio.played).toEqual(["gong", "applause"]);
    fireEvent.click(within(board).getByRole("button", { name: "Amr cheer" }));
    expect(cheers.calls).toEqual([["facilitator-timers", "result", { sound: true }]]);
    fireEvent.click(screen.getByRole("switch", { name: "Show the soundboard while presenting" }));
    expect(useFacilitatorSettings.getState().soundboardWhilePresenting).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/*  The agenda draft                                                           */
/* -------------------------------------------------------------------------- */

describe("drafting an agenda for the Ceremony Timer", () => {
  const draftRetro = () => {
    type(
      screen.getByRole("textbox", { name: /^What is the meeting for/ }),
      "Our sprint retrospective"
    );
    type(screen.getByRole("spinbutton", { name: /^Minutes/ }), "60");
    click("Suggest from a template");
  };

  it("says what it needs before it suggests anything", () => {
    renderPage();
    click("Suggest from a template");
    expect(
      screen.getAllByText("Say what the meeting is for and how many minutes it has first.").length
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/^Suggested:/)).toBeNull();
    expect(validateAgendaRequest({ goal: "Plan", minutes: "481" })).toMatchObject({
      ok: false,
      errors: { minutes: "Enter a whole number from 5 to 480." },
    });
  });

  it("suggests the nearest template without AI and adds only what the person adds", () => {
    renderPage();
    draftRetro();
    expect(screen.getByText("Suggested: Sprint Retrospective")).toBeInTheDocument();
    expect(screen.getByText(/^Suggested without AI/)).toBeInTheDocument();
    expect(useFacilitatorSettings.getState().agenda.segments).toEqual([]);
    fireEvent.click(screen.getAllByRole("button", { name: /^Add/ })[0]);
    expect(useFacilitatorSettings.getState().agenda.segments.map((s) => s.label)).toEqual([
      "Set the stage",
    ]);
    click(/^Add all/);
    expect(useFacilitatorSettings.getState().agenda.segments.map((s) => s.minutes)).toEqual([
      7, 20, 13, 13, 7,
    ]);
    expect(useFacilitatorSettings.getState().agenda).toMatchObject({
      goal: "Our sprint retrospective",
      minutes: 60,
    });
  });

  it("fills the goal and minutes from the example, and leaving the goal keeps it", () => {
    renderPage();
    click("Load an example");
    const goal = screen.getByRole("textbox", { name: /^What is the meeting for/ });
    expect(goal).toHaveValue("Sketch ideas for a simpler sign-up flow");
    expect(screen.getByRole("spinbutton", { name: /^Minutes/ })).toHaveValue(90);
    fireEvent.focus(goal);
    fireEvent.blur(goal);
    expect(useFacilitatorSettings.getState().agenda).toMatchObject({
      goal: "Sketch ideas for a simpler sign-up flow",
      minutes: 90,
    });
    click("Clear example");
    expect(goal).toHaveValue("");
    // A goal typed here is kept when the field is left.
    type(goal, "  Plan the release  ");
    fireEvent.blur(goal);
    expect(useFacilitatorSettings.getState().agenda.goal).toBe("Plan the release");
  });

  it("adds a suggestion with Undo, and Add all with Undo takes out only what it added", () => {
    renderPage();
    draftRetro();
    fireEvent.click(screen.getByRole("button", { name: "Add: Set the stage · 7 min" }));
    expect(lastToast().label).toBe("Added “Set the stage”");
    lastToast().undo();
    expect(useFacilitatorSettings.getState().agenda.segments).toEqual([]);
    useFacilitatorSettings.setState((s) => ({
      agenda: {
        ...s.agenda,
        segments: [{ id: "own-1", label: "Check-in", minutes: 5, hint: "" }],
      },
    }));
    click(/^Add all/);
    expect(lastToast().label).toBe("Added 4 segments");
    expect(useFacilitatorSettings.getState().agenda.segments).toHaveLength(5);
    lastToast().undo();
    expect(useFacilitatorSettings.getState().agenda.segments.map((s) => s.label)).toEqual([
      "Check-in",
    ]);
  });

  it("never offers a suggestion twice near the 12-segment limit, and says when the draft is full", () => {
    const own = Array.from({ length: 9 }, (_, i) => ({
      id: `own-${i + 1}`,
      label: `Part ${i + 1}`,
      minutes: 5,
      hint: "",
    }));
    useFacilitatorSettings.setState({
      agenda: { goal: "Our sprint retrospective", minutes: 60, segments: own },
    });
    renderPage();
    click("Suggest from a template");
    const adds = () =>
      screen.queryAllByRole("button", { name: /^Add: / }).map((b) => b.getAttribute("aria-label"));
    expect(adds()).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "Add: Set the stage · 7 min" }));
    expect(adds()).not.toContain("Add: Set the stage · 7 min");
    expect(adds()).toHaveLength(4);
    click(/^Add all/);
    const labels = useFacilitatorSettings.getState().agenda.segments.map((s) => s.label);
    expect(labels).toHaveLength(12);
    expect(labels.slice(9)).toEqual(["Set the stage", "Gather data", "Generate insights"]);
    const full = screen.getByText(/^The draft is full/);
    expect(full).toHaveFocus();
    // The rest wait, hidden, until there is room again.
    expect(screen.getByTestId("ai-suggestions").closest(".hidden")).not.toBeNull();
    click("Remove Part 1");
    expect(screen.getByTestId("ai-suggestions").closest(".hidden")).toBeNull();
    expect(adds()).toEqual(["Add: Decide what to do · 13 min", "Add: Close · 7 min"]);
  }, 15_000);

  it("keeps focus in the draft when a segment is removed or moved", () => {
    useFacilitatorSettings.setState({ agenda: buildExample() });
    renderPage();
    const labels = useFacilitatorSettings.getState().agenda.segments.map((s) => s.label);
    click(`Remove ${labels[1]}`);
    expect(screen.getByRole("button", { name: `Remove ${labels[2]}` })).toHaveFocus();
    click(`Move ${labels[2]} down`);
    expect(screen.getByRole("button", { name: `Move ${labels[2]} down` })).toHaveFocus();
    // At the top, the up arrow is switched off: focus goes to its down arrow.
    click(`Move ${labels[3]} up`);
    expect(screen.getByRole("button", { name: `Move ${labels[3]} up` })).toBeDisabled();
    expect(screen.getByRole("button", { name: `Move ${labels[3]} down` })).toHaveFocus();
  }, 15_000);

  it("won't save a draft longer than the Ceremony Timer runs", () => {
    useFacilitatorSettings.setState({
      agenda: {
        goal: "An offsite",
        minutes: 480,
        segments: [
          { id: "day-1", label: "Morning", minutes: 300, hint: "" },
          { id: "day-2", label: "Afternoon", minutes: 300, hint: "" },
        ],
      },
    });
    renderPage();
    type(screen.getByRole("textbox", { name: /^Agenda name/ }), "Offsite");
    click("Save to the Ceremony Timer");
    expect(
      screen.getByText(
        "The Ceremony Timer runs agendas of up to 480 minutes. Remove or shorten a segment first."
      )
    ).toBeInTheDocument();
    expect(useTimerSettings.getState().named).toEqual([]);
  });

  it("reorders and removes draft segments, with Undo", () => {
    useFacilitatorSettings.setState({ agenda: buildExample() });
    renderPage();
    click("Move Crazy 8s up");
    expect(useFacilitatorSettings.getState().agenda.segments[1].label).toBe("Crazy 8s");
    click("Remove Break");
    expect(useFacilitatorSettings.getState().agenda.segments.map((s) => s.label)).not.toContain(
      "Break"
    );
    expect(lastToast().label).toBe("Removed “Break”");
    lastToast().undo();
    expect(useFacilitatorSettings.getState().agenda.segments[4].label).toBe("Break");
    click("Clear draft");
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Clear draft" })
    );
    expect(useFacilitatorSettings.getState().agenda.segments).toEqual([]);
    lastToast().undo();
    expect(useFacilitatorSettings.getState().agenda.segments).toHaveLength(7);
  }, 15_000);

  it("saves the draft to the Ceremony Timer under a new name, with a link to run it", () => {
    useFacilitatorSettings.setState({ agenda: buildExample() });
    renderPage();
    const name = screen.getByRole("textbox", { name: /^Agenda name/ });
    type(name, "sprint retrospective");
    click("Save to the Ceremony Timer");
    expect(screen.getByText("“Sprint Retrospective” is already an agenda.")).toBeInTheDocument();
    type(name, "Sign-up workshop");
    click("Save to the Ceremony Timer");
    const [saved] = useTimerSettings.getState().named;
    expect(saved).toMatchObject({ name: "Sign-up workshop" });
    expect(saved.segments.map((s) => s.minutes)).toEqual([5, 15, 10, 20, 10, 20, 10]);
    expect(screen.getByRole("link", { name: "Run it in the Ceremony Timer" })).toHaveAttribute(
      "href",
      `/ceremony-timer?agenda=${saved.id}`
    );
  });
});

/* -------------------------------------------------------------------------- */
/*  Pure pieces                                                                */
/* -------------------------------------------------------------------------- */

describe("the export and the forms", () => {
  it("exports the plans, the timer on, the meeting's person-hours and the draft", () => {
    const run = breakRun(T0 + 600_000, T0);
    const md = toMarkdown(
      {
        settings: FT_SETTINGS_INITIAL,
        run,
        remainingSeconds: 300,
        cost: { attendees: 5, seconds: 1800 },
        agenda: buildExample(),
      },
      new Date(T0)
    );
    expect(md).toContain("# Facilitator Timers — 12 Nov 2026");
    expect(md).toContain("- **Pomodoro:** 4 × 25 min focus with 5 min breaks (1 h 55 min)");
    expect(md).toContain("- Break: back at 10:10 (5 min left).");
    expect(md).toContain("- 5 people for 30 min: 2.5 person-hours.");
    expect(md).toContain(
      "| 3 | Crazy 8s | 10 | Eight quick sketches each, alone and in silence. |"
    );
  });

  it("checks a break before it starts", () => {
    expect(validateBreak({ mode: "minutes", minutes: "", clock: "" }, T0)).toEqual({
      ok: false,
      errors: { minutes: "Enter the minutes." },
    });
    expect(validateBreak({ mode: "clock", minutes: "", clock: "" }, T0)).toEqual({
      ok: false,
      errors: { clock: "Enter the time to be back." },
    });
    expect(validateBreak({ mode: "minutes", minutes: "10", clock: "" }, T0)).toEqual({
      ok: true,
      values: { backAt: T0 + 600_000, minutes: 10 },
    });
  });
});
