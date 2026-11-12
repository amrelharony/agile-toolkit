/**
 * Facilitator Timers' pure model (lib/facilitator-timers/model.ts) and its
 * stores' docked-timer moves (store.ts): the steps each timer runs, the
 * dock as the clock of the step that's on, "Back at 10:45", the cost
 * ticker's maths, and what a stored value can and can't bring back.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FT_HREF,
  autoAdvances,
  backAtFromClock,
  backAtFromMinutes,
  breakEndsAt,
  breakRun,
  clockTime,
  costElapsedMs,
  costPerMinute,
  crazy8sSteps,
  currencyCode,
  currentStep,
  dockLabel,
  dockPaused,
  formatMoney,
  lengthText,
  meetingCost,
  newRun,
  nextStep,
  normalizeCrazy8s,
  normalizePomodoro,
  normalizeRun,
  pauseCostClock,
  personHours,
  personHoursText,
  planText,
  pomodoroSteps,
  runIsLive,
  startCostClock,
  stepDock,
  stepsSeconds,
} from "@/lib/facilitator-timers/model";
import {
  FT_SETTINGS_INITIAL,
  advanceTimerRun,
  normalizeAgendaDraft,
  normalizeCost,
  normalizeSettings,
  pauseTimerRun,
  resumeTimerRun,
  startTimerRun,
  stopTimerRun,
  useFtSession,
} from "@/lib/facilitator-timers/store";
import { countdown, useDockTimer } from "@/lib/timer/dock-timer";

const T0 = new Date(2026, 10, 12, 10, 0, 0).getTime(); // 10:00 local

beforeEach(() => {
  useDockTimer.setState({ timer: null });
  useFtSession.setState({ run: null });
});
afterEach(() => vi.useRealTimers());

describe("the steps each timer runs", () => {
  it("runs Pomodoro as focus blocks with short breaks between, none after the last", () => {
    const steps = pomodoroSteps({ workMinutes: 25, breakMinutes: 5, rounds: 3 });
    expect(steps.map((s) => s.label)).toEqual([
      "Focus 1 of 3",
      "Short break 1 of 2",
      "Focus 2 of 3",
      "Short break 2 of 2",
      "Focus 3 of 3",
    ]);
    expect(steps.map((s) => s.kind)).toEqual(["focus", "rest", "focus", "rest", "focus"]);
    expect(stepsSeconds(steps)).toBe((3 * 25 + 2 * 5) * 60);
    expect(pomodoroSteps({ workMinutes: 50, breakMinutes: 10, rounds: 1 })).toHaveLength(1);
  });

  it("runs Crazy 8s as eight one-minute sketches by default", () => {
    const steps = crazy8sSteps(normalizeCrazy8s(undefined));
    expect(steps).toHaveLength(8);
    expect(steps[7]).toMatchObject({ label: "Sketch 8 of 8", seconds: 60, kind: "sketch" });
  });

  it("keeps stored lengths within the limits", () => {
    expect(normalizePomodoro({ workMinutes: 900, breakMinutes: 0, rounds: "x" })).toEqual({
      workMinutes: 120,
      breakMinutes: 1,
      rounds: 4,
    });
    expect(normalizeCrazy8s({ rounds: 2.6, roundSeconds: 5 })).toEqual({
      rounds: 3,
      roundSeconds: 15,
    });
  });

  it("moves step by step to the finish, and says which ones move on by themselves", () => {
    let run = newRun("crazy-8s", crazy8sSteps({ rounds: 2, roundSeconds: 30 }));
    expect(currentStep(run)?.label).toBe("Sketch 1 of 2");
    run = nextStep(run);
    expect(run.index).toBe(1);
    run = nextStep(run);
    expect(run).toMatchObject({ finished: true, index: 1 });
    expect(currentStep(run)).toBeUndefined();
    expect(nextStep(run)).toBe(run);
    expect(autoAdvances(run)).toBe(true);
    expect(autoAdvances(breakRun(T0 + 60_000, T0))).toBe(false);
  });

  it("describes each plan in a line", () => {
    const settings = {
      pomodoro: { workMinutes: 25, breakMinutes: 5, rounds: 4 },
      crazy8s: { rounds: 8, roundSeconds: 60 },
      breakMinutes: 10,
    };
    expect(planText("pomodoro", settings)).toBe("4 × 25 min focus with 5 min breaks (1 h 55 min)");
    expect(planText("crazy-8s", settings)).toBe("8 sketches, 1 min each (8 min)");
    expect(planText("break", settings)).toBe("A 10 min break");
    expect(lengthText(45)).toBe("45 s");
    expect(lengthText(3600)).toBe("1 h");
  });
});

describe("the dock as the step's clock", () => {
  it("counts the step down from now, labelled with the step", () => {
    const run = newRun("pomodoro", pomodoroSteps({ workMinutes: 25, breakMinutes: 5, rounds: 2 }));
    expect(stepDock(run, T0)).toEqual({
      label: "Pomodoro · Focus 1 of 2",
      href: FT_HREF,
      totalSeconds: 1500,
      endsAt: T0 + 1_500_000,
      pausedRemaining: 1500,
    });
    expect(stepDock({ ...run, finished: true }, T0)).toBeNull();
  });

  it("counts a break down to its return time, under one label", () => {
    const run = breakRun(T0 + 10 * 60_000, T0);
    expect(dockLabel(run)).toBe("Break");
    expect(stepDock(run, T0 + 60_000)).toMatchObject({
      label: "Break",
      endsAt: T0 + 600_000,
      pausedRemaining: 540,
    });
  });

  it("starts on the dock, moves on and frees it at the end", () => {
    const run = newRun("crazy-8s", crazy8sSteps({ rounds: 2, roundSeconds: 60 }));
    expect(startTimerRun(run, T0)).toEqual({ ok: true, run });
    expect(useDockTimer.getState().timer).toMatchObject({ label: "Crazy 8s · Sketch 1 of 2" });
    const second = advanceTimerRun(T0 + 60_000);
    expect(second?.ok && second.run.index).toBe(1);
    expect(useDockTimer.getState().timer).toMatchObject({
      label: "Crazy 8s · Sketch 2 of 2",
      endsAt: T0 + 120_000,
    });
    const done = advanceTimerRun(T0 + 120_000);
    expect(done?.ok && done.run.finished).toBe(true);
    expect(useDockTimer.getState().timer).toBeNull();
    expect(advanceTimerRun(T0)).toBeNull();
  });

  it("never takes the dock from another page's timer", () => {
    const ceremony = {
      ...countdown("Retro · Gather data", "/ceremony-timer", 600),
      endsAt: T0 + 600_000,
    };
    useDockTimer.setState({ timer: ceremony });
    const claim = startTimerRun(
      newRun("pomodoro", pomodoroSteps(FT_SETTINGS_INITIAL.pomodoro)),
      T0
    );
    expect(claim).toEqual({ ok: false, holder: ceremony });
    expect(useDockTimer.getState().timer).toBe(ceremony);
    expect(useFtSession.getState().run).toBeNull();
    stopTimerRun();
    expect(useDockTimer.getState().timer).toBe(ceremony);
  });

  it("knows a run is over once its dock was stopped elsewhere", () => {
    const run = breakRun(T0 + 60_000, T0);
    expect(runIsLive(run, stepDock(run, T0))).toBe(true);
    expect(runIsLive(run, null)).toBe(false);
    expect(runIsLive({ ...run, finished: true }, null)).toBe(true);
    expect(runIsLive(null, null)).toBe(false);
  });

  it("reads back only a run it could have made", () => {
    const run = newRun("pomodoro", pomodoroSteps(FT_SETTINGS_INITIAL.pomodoro));
    expect(normalizeRun(JSON.parse(JSON.stringify({ ...run, index: 99 })))).toMatchObject({
      kind: "pomodoro",
      index: run.steps.length - 1,
    });
    expect(normalizeRun({ ...run, kind: "lunch" })).toBeNull();
    expect(normalizeRun({ ...run, steps: [] })).toBeNull();
    expect(
      normalizeRun({ ...run, steps: [{ id: "x", label: "x", seconds: -5, kind: "focus" }] })
    ).toBeNull();
    expect(
      normalizeRun({ ...run, steps: [{ id: "x", label: "x", seconds: 60, kind: "nap" }] })
    ).toBeNull();
    expect(normalizeRun("junk")).toBeNull();
    const brk = breakRun(T0 + 60_000, T0);
    expect(normalizeRun(brk)?.backAt).toBe(T0 + 60_000);
  });
});

describe("Back at 10:45", () => {
  it("reads a clock time today, or tomorrow when it has just passed", () => {
    expect(backAtFromClock("10:45", T0)).toEqual({ ok: true, at: T0 + 45 * 60_000 });
    expect(clockTime(T0 + 45 * 60_000)).toBe("10:45");
    expect(backAtFromClock("9:30", T0)).toEqual({
      ok: false,
      error: "09:30 has passed. Enter a time later today.",
    });
    expect(backAtFromClock("23:30", T0)).toEqual({
      ok: false,
      error: "Pick a time within the next 12 hours.",
    });
    expect(backAtFromClock("25:00", T0)).toMatchObject({ ok: false });
    expect(backAtFromClock("ten", T0)).toMatchObject({ ok: false });
    expect(backAtFromClock("10:00", T0 + 30_000)).toMatchObject({ ok: false });
    const late = new Date(2026, 10, 12, 23, 50).getTime();
    expect(backAtFromClock("00:10", late)).toEqual({ ok: true, at: late + 20 * 60_000 });
  });

  it("adds minutes to now", () => {
    expect(backAtFromMinutes(10, T0)).toBe(T0 + 600_000);
    expect(breakRun(T0 + 600_000, T0).steps[0].seconds).toBe(600);
  });

  it("ends a break when its clock (the dock) says, so a pause moves the time to be back", () => {
    const run = breakRun(T0 + 600_000, T0);
    const dock = stepDock(run, T0)!;
    expect(breakEndsAt(run, dock, T0)).toBe(T0 + 600_000);
    const paused = { ...dock, endsAt: null, pausedRemaining: 540 };
    expect(dockPaused(paused)).toBe(true);
    // Paused: where it would end if resumed now.
    expect(breakEndsAt(run, paused, T0 + 120_000)).toBe(T0 + 660_000);
    // At zero, or with no dock: the time the run keeps.
    expect(breakEndsAt(run, { ...dock, endsAt: null, pausedRemaining: 0 }, T0)).toBe(T0 + 600_000);
    expect(dockPaused({ ...dock, endsAt: null, pausedRemaining: 0 })).toBe(false);
    expect(breakEndsAt(run, null, T0)).toBe(T0 + 600_000);
    expect(
      breakEndsAt(newRun("pomodoro", pomodoroSteps(FT_SETTINGS_INITIAL.pomodoro)), dock, T0)
    ).toBeUndefined();
  });

  it("moves the run's return time on resume", () => {
    startTimerRun(breakRun(T0 + 600_000, T0), T0);
    pauseTimerRun(T0 + 60_000);
    resumeTimerRun(T0 + 180_000);
    expect(useDockTimer.getState().timer?.endsAt).toBe(T0 + 720_000);
    expect(useFtSession.getState().run?.backAt).toBe(T0 + 720_000);
  });
});

describe("the meeting cost ticker", () => {
  it("multiplies people, rate and time, and counts person-hours without money", () => {
    expect(meetingCost(6, 60, 45 * 60)).toBe(270);
    expect(costPerMinute(6, 60)).toBe(6);
    expect(meetingCost(6, Number.NaN, 60)).toBe(0);
    expect(personHours(6, 45 * 60)).toBe(4.5);
    expect(personHoursText(4.5)).toBe("4.5 person-hours");
    expect(personHoursText(1)).toBe("1 person-hour");
  });

  it("keeps time on the wall clock through pauses", () => {
    let clock = startCostClock(null, T0);
    expect(costElapsedMs(clock, T0 + 60_000)).toBe(60_000);
    clock = pauseCostClock(clock, T0 + 60_000);
    expect(costElapsedMs(clock, T0 + 600_000)).toBe(60_000);
    clock = startCostClock(clock, T0 + 600_000);
    expect(costElapsedMs(clock, T0 + 630_000)).toBe(90_000);
    expect(startCostClock(clock, T0)).toBe(clock);
  });

  it("formats money in the person's currency, or with the word they typed", () => {
    expect(currencyCode(" eur ")).toBe("EUR");
    expect(currencyCode("credits")).toBeNull();
    expect(formatMoney(270, "EUR", "en")).toBe("€270.00");
    expect(formatMoney(1234.5, "USD", "en")).toBe("$1,234.5");
    expect(formatMoney(12.5, "credits", "en")).toBe("12.50 credits");
  });

  it("reads back a ticker without inventing numbers", () => {
    expect(
      normalizeCost({ attendees: 6.4, hourlyRate: -3, currency: " EUR ", clock: { baseMs: 5 } })
    ).toEqual({
      attendees: 6,
      hourlyRate: null,
      currency: "EUR",
      clock: { baseMs: 5, since: null },
    });
    expect(normalizeCost(null)).toEqual({
      attendees: null,
      hourlyRate: null,
      currency: "",
      clock: null,
    });
  });
});

describe("stored settings", () => {
  it("fall back to the defaults, with sound off, and keep only usable draft segments", () => {
    expect(normalizeSettings(null)).toEqual(FT_SETTINGS_INITIAL);
    expect(FT_SETTINGS_INITIAL).toMatchObject({ chime: false, soundboardWhilePresenting: false });
    const s = normalizeSettings({ focusSound: "jazz", focusVolume: 7, chime: "yes" });
    expect(s).toMatchObject({ focusSound: "rain", focusVolume: 1, chime: false });
    expect(
      normalizeAgendaDraft({
        goal: "  Plan  ",
        minutes: 2,
        segments: [
          { id: "seg-a", label: "Open", minutes: 5.2, hint: "x" },
          { id: "seg-a", label: "Twice", minutes: 5 },
          { id: "BAD", label: "Bad id", minutes: 5 },
          { id: "seg-b", label: "", minutes: 5 },
          { id: "seg-c", label: "Long", minutes: 9000 },
        ],
      })
    ).toEqual({
      goal: "Plan",
      minutes: null,
      segments: [{ id: "seg-a", label: "Open", minutes: 5, hint: "x" }],
    });
  });
});
