import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { useDockTimer, type DockedTimer } from "@/lib/timer/dock-timer";

/**
 * Ceremony Timer upgrade (Phase 3, "Run the sprint"): agendas with segments
 * whose lengths come from the cadence, fair turns that hand leftover time
 * on, overtime that counts up, the docked timer kept in step, an end
 * summary with a verdict, and the contract's draft-then-save, Undo and
 * Markdown export.
 */

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
vi.mock("@/lib/sonification/use-sonification", () => ({ useToolSonification: () => () => {} }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));
const alarm = vi.hoisted(() => ({ playChime: vi.fn(), vibrate: vi.fn(), flashTitle: vi.fn() }));
vi.mock("@/app/(tools)/ceremony-timer/alarm", () => alarm);

import { CeremonyTimerClient } from "@/app/(tools)/ceremony-timer/ceremony-timer-client";
import {
  defaultMinutes,
  durationText,
  minutesText,
  readAgendaParam,
  resolveAgenda,
  shortClock,
  splitSeconds,
  toSaved,
} from "@/app/(tools)/ceremony-timer/agenda";
import {
  draftOf,
  validateAgenda,
  withRowMinutes,
  withTotal,
} from "@/app/(tools)/ceremony-timer/agenda-form";
import {
  activeMs,
  advanceSegment,
  dockFor,
  endTurn,
  pauseRun,
  reconcileWithDock,
  resumeRun,
  runFromLegacyDock,
  runReport,
  runView,
  startRun,
} from "@/app/(tools)/ceremony-timer/run";
import {
  MIN_TURN_SECONDS,
  plannedSlots,
  speakerPlan,
  turnShare,
  type Participant,
  type Turn,
} from "@/app/(tools)/ceremony-timer/speakers";
import {
  normalizeAgendas,
  normalizeSession,
  normalizeSpeakers,
  useTimerSession,
  useTimerSettings,
} from "@/app/(tools)/ceremony-timer/store";
import { shortcutFor } from "@/app/(tools)/ceremony-timer/shortcuts";
import { planVerdict, runVerdict } from "@/app/(tools)/ceremony-timer/verdict";
import { toMarkdown } from "@/app/(tools)/ceremony-timer/markdown";
import { validateSpeaker } from "@/app/(tools)/ceremony-timer/speakers-card";

const T0 = Date.parse("2026-10-24T10:00:00Z");
const HREF = "/ceremony-timer";
const ANN: Participant = { id: "a", name: "Ann" };
const BO: Participant = { id: "b", name: "Bo" };
const CY: Participant = { id: "c", name: "Cy" };
const turn = (p: Participant, seconds: number, share: number, skipped = false): Turn => ({
  speakerId: p.id,
  name: p.name,
  spentMs: seconds * 1000,
  shareSeconds: share,
  skipped,
});
const retro = () => resolveAgenda("retro", null, 14);
const daily = () => resolveAgenda("daily", null, 14);

const renderTimer = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <CeremonyTimerClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );
const timer = () => screen.getByRole("timer").textContent;
const pick = (name: RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const key = (k: string, init: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(document.body, { key: k, ...init });
const tick = (seconds: number) =>
  act(() => {
    vi.advanceTimersByTime(seconds * 1000);
  });

beforeEach(() => {
  toastSpy.mockReset();
  Object.values(alarm).forEach((f) => f.mockReset());
  exported.markdown = "";
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, "", "/ceremony-timer");
  useDockTimer.setState({ timer: null });
  useTimerSession.setState({ agendaId: null, run: null });
  useTimerSettings.setState({ agendas: {}, speakers: [], chime: false });
});
afterEach(() => vi.useRealTimers());

/* -------------------------------------------------------------------------- */
/*  Agendas                                                                    */
/* -------------------------------------------------------------------------- */

describe("splitting an agenda's time", () => {
  it("splits by weight into whole minutes that add up exactly", () => {
    expect(splitSeconds(3600, [1, 3, 2, 2, 1])).toEqual([420, 1200, 780, 780, 420]);
    expect(splitSeconds(5400, [1, 3, 2, 2, 1])).toEqual([600, 1800, 1200, 1200, 600]);
    expect(splitSeconds(720, [1, 2, 4, 5])).toEqual([60, 120, 240, 300]);
  });

  it("falls back to half minutes, then seconds, when minutes don't fit", () => {
    expect(splitSeconds(90, [1, 1])).toEqual([60, 30]);
    expect(splitSeconds(120, [1, 1, 1])).toEqual([60, 30, 30]);
    expect(splitSeconds(61, [1, 1])).toEqual([31, 30]);
  });

  it("handles zero, junk weights and a segment that would round to nothing", () => {
    expect(splitSeconds(0, [1, 2])).toEqual([0, 0]);
    expect(splitSeconds(Number.NaN, [1])).toEqual([0]);
    expect(splitSeconds(600, [0, -1, Number.NaN])).toEqual([240, 180, 180]);
    expect(splitSeconds(300, [1, 100])).toEqual([60, 240]);
    expect(splitSeconds(100, [])).toEqual([]);
    const huge = splitSeconds(480 * 60, [1, 3, 2, 2, 1]);
    expect(huge.reduce((a, b) => a + b, 0)).toBe(480 * 60);
  });

  it("re-scales edited segments in their own proportions", () => {
    expect(splitSeconds(2400, [420, 1200, 780])).toEqual([420, 1200, 780]);
    expect(splitSeconds(4800, [420, 1200, 780])).toEqual([840, 2400, 1560]);
  });
});

describe("agendas from the cadence", () => {
  it("takes each ceremony's timebox from the sprint length", () => {
    expect(defaultMinutes("daily", 14)).toBe(15);
    expect(defaultMinutes("planning", 14)).toBe(240);
    expect(defaultMinutes("review", 14)).toBe(120);
    expect(defaultMinutes("retro", 14)).toBe(90);
    expect(defaultMinutes("retro", 7)).toBe(45);
    expect(defaultMinutes("retro", 28)).toBe(180);
    expect(defaultMinutes("refinement", 7)).toBe(60);
    expect(defaultMinutes("one-two-four-all", 14)).toBe(12);
    expect(defaultMinutes("custom", 14)).toBe(0);
  });

  it("builds the retro's five phases and the planning topics", () => {
    expect(retro().segments.map((s) => [s.label, s.seconds / 60])).toEqual([
      ["Set the stage", 10],
      ["Gather data", 30],
      ["Generate insights", 20],
      ["Decide what to do", 20],
      ["Close", 10],
    ]);
    expect(resolveAgenda("planning", null, 14).segments.map((s) => s.seconds / 60)).toEqual([
      48, 96, 96,
    ]);
    expect(daily().segments).toMatchObject([{ label: "Round the team", speakers: true }]);
    expect(resolveAgenda("custom", null, 14).segments[0].seconds).toBe(0);
  });

  it("applies the team's saved edits by segment id and ignores what it can't use", () => {
    const a = resolveAgenda(
      "retro",
      {
        retro: [
          { id: "gather-data", minutes: 40 },
          { id: "nope", minutes: 5 },
          { id: "close", minutes: -3, label: "   " },
          "junk" as never,
          { id: "decide", minutes: 9000, speakers: true },
        ],
      },
      14
    );
    expect(a.edited).toBe(true);
    expect(a.segments.map((s) => s.seconds / 60)).toEqual([10, 40, 20, 480, 10]);
    expect(a.segments[3].speakers).toBe(true);
    expect(a.segments[4].label).toBe("Close");
    expect(retro().edited).toBe(false);
  });

  it("saves only what differs from the defaults", () => {
    const segs = retro().segments.map((s) =>
      s.id === "gather-data"
        ? { ...s, seconds: 2400 }
        : s.id === "close"
          ? { ...s, label: "Wrap up" }
          : s
    );
    const rows = toSaved("retro", segs, 14);
    expect(rows).toEqual([
      { id: "gather-data", minutes: 40 },
      { id: "close", label: "Wrap up" },
    ]);
    // Untouched lengths keep following the cadence (one-week sprints here).
    expect(resolveAgenda("retro", { retro: rows }, 7).segments.map((s) => s.seconds / 60)).toEqual([
      5, 40, 10, 10, 5,
    ]);
    expect(toSaved("retro", retro().segments, 14)).toEqual([]);
  });

  it("formats lengths and reads ?agenda=", () => {
    expect(durationText(45)).toBe("45 s");
    expect(durationText(390)).toBe("6 min 30 s");
    expect(durationText(900)).toBe("15 min");
    expect(durationText(5400)).toBe("1 h 30 min");
    expect(durationText(14400)).toBe("4 h");
    expect(shortClock(42)).toBe("0:42");
    expect(shortClock(3725)).toBe("1:02:05");
    expect(minutesText(42)).toBe("42 seconds");
    expect(minutesText(60)).toBe("1 minute");
    expect(minutesText(420)).toBe("7 minutes");
    expect(readAgendaParam("?agenda=retro")).toBe("retro");
    expect(readAgendaParam("?agenda=standup")).toBeNull();
    expect(readAgendaParam("")).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/*  Fair turns                                                                 */
/* -------------------------------------------------------------------------- */

describe("fair turns", () => {
  it("splits what's left evenly, never below the floor", () => {
    expect(turnShare(900, 0, 3)).toBe(300);
    expect(turnShare(900, 60, 2)).toBe(420);
    expect(turnShare(900, 860, 2)).toBe(MIN_TURN_SECONDS);
    expect(turnShare(100, 200, 1)).toBe(MIN_TURN_SECONDS);
    expect(turnShare(900, 0, 0)).toBe(0);
  });

  it("gives the rest more when someone finishes early", () => {
    const plan = speakerPlan(900, [ANN, BO, CY], [turn(ANN, 60, 300)], 0);
    expect(plan.current).toMatchObject({ id: "b", shareSeconds: 420 });
    expect(plan.nextShareSeconds).toBe(420);
    expect(plan.slots.map((s) => s.status)).toEqual(["done", "current", "next"]);
  });

  it("shortens the rest live while someone runs over", () => {
    const onTime = speakerPlan(900, [ANN, BO, CY], [], 120);
    expect(onTime).toMatchObject({ overtimeSeconds: 0, nextShareSeconds: 300 });
    const over = speakerPlan(900, [ANN, BO, CY], [], 420);
    expect(over.current).toMatchObject({ shareSeconds: 300, spentSeconds: 420 });
    expect(over).toMatchObject({ overtimeSeconds: 120, nextShareSeconds: 240 });
  });

  it("counts a skip, a newcomer and a speaker who left", () => {
    expect(speakerPlan(900, [ANN, BO], [turn(ANN, 0, 450, true)], 0).current?.shareSeconds).toBe(
      900
    );
    const DEE = { id: "d", name: "Dee" };
    expect(
      speakerPlan(900, [ANN, BO, CY, DEE], [turn(ANN, 60, 225)], 0).current?.shareSeconds
    ).toBe(280);
    const left = speakerPlan(900, [BO, CY], [turn(ANN, 200, 300)], 0);
    expect(left.slots[0]).toMatchObject({ name: "Ann", status: "done", spentSeconds: 200 });
  });

  it("knows when everyone has spoken and when the round can't fit", () => {
    const done = speakerPlan(900, [ANN, BO], [turn(ANN, 100, 450), turn(BO, 100, 400)], 0);
    expect(done).toMatchObject({ current: null, everyoneSpoke: true });
    const tight = speakerPlan(
      60,
      [ANN, BO, CY, { id: "d", name: "D" }, { id: "e", name: "E" }],
      [],
      0
    );
    expect(tight.current?.shareSeconds).toBe(MIN_TURN_SECONDS);
    expect(tight.overbooked).toBe(true);
    expect(speakerPlan(900, [], [], 0)).toMatchObject({ current: null, everyoneSpoke: false });
  });

  it("plans the speaking order with the remainder on the last speaker", () => {
    expect(plannedSlots(600, [ANN, BO, CY], 300)).toEqual([
      { participant: ANN, startSeconds: 300, seconds: 200 },
      { participant: BO, startSeconds: 500, seconds: 200 },
      { participant: CY, startSeconds: 700, seconds: 200 },
    ]);
    expect(plannedSlots(100, [ANN, BO, CY]).map((s) => s.seconds)).toEqual([33, 33, 34]);
    expect(plannedSlots(100, [])).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/*  The run                                                                    */
/* -------------------------------------------------------------------------- */

describe("a run's clock", () => {
  it("counts active time only, through pauses", () => {
    let run = startRun("retro", T0);
    expect(activeMs(run, T0 + 5000)).toBe(5000);
    run = pauseRun(run, T0 + 5000);
    expect(activeMs(run, T0 + 999_000)).toBe(5000);
    run = resumeRun(run, T0 + 10_000);
    expect(activeMs(run, T0 + 12_000)).toBe(7000);
    expect(pauseRun(pauseRun(run, T0 + 12_000), T0 + 20_000).baseMs).toBe(7000);
  });

  it("moves through segments, overtime and drift, to the finish", () => {
    const agenda = retro();
    let run = startRun("retro", T0);
    run = advanceSegment(run, 5, T0 + 700_000);
    const view = runView(run, agenda, [], T0 + 800_000);
    expect(view).toMatchObject({
      index: 1,
      segmentSpent: 100,
      segmentLeft: 1700,
      totalSpent: 800,
      totalLeft: 4600,
      drift: 100,
    });
    expect(view.lines.map((l) => [l.state, l.spentSeconds])).toEqual([
      ["done", 700],
      ["current", 100],
      ["next", 0],
      ["next", 0],
      ["next", 0],
    ]);
    for (let i = 0; i < 4; i++) run = advanceSegment(run, 5, T0 + 800_000);
    expect(run.finished).toBe(true);
    expect(run.since).toBeNull();
    expect(advanceSegment(run, 5, T0 + 900_000)).toBe(run);
    const report = runReport(run, agenda, T0 + 999_000);
    expect(report.actualSeconds).toBe(800);
    expect(report.segments.map((s) => s.actualSeconds)).toEqual([700, 100, 0, 0, 0]);
  });

  it("counts a segment's overtime and the turns in it", () => {
    let run = startRun("daily", T0);
    run = endTurn(run, ANN, 300, false, T0 + 60_000);
    run = endTurn(run, BO, 420, true, T0 + 70_000);
    const view = runView(run, daily(), [ANN, BO, CY], T0 + 960_000);
    expect(view.segmentLeft).toBe(-60);
    expect(view.speakers?.current).toMatchObject({ id: "c", spentSeconds: 890 });
    // Cut off at the finish: the turn is kept, with what it took.
    run = advanceSegment(run, 1, T0 + 960_000, { speaker: CY, shareSeconds: 830 });
    expect(runReport(run, daily(), T0 + 960_000).segments[0].turns).toEqual([
      { name: "Ann", plannedSeconds: 300, actualSeconds: 60, skipped: false },
      { name: "Bo", plannedSeconds: 420, actualSeconds: 10, skipped: true },
      { name: "Cy", plannedSeconds: 830, actualSeconds: 890, skipped: false },
    ]);
  });
});

describe("the docked timer", () => {
  it("shows the segment counting down, or nothing once finished", () => {
    const run = startRun("retro", T0);
    expect(dockFor(run, retro(), HREF, T0 + 100_000)).toEqual({
      label: "Retro · Set the stage",
      href: HREF,
      totalSeconds: 600,
      endsAt: T0 + 600_000,
      pausedRemaining: 500,
    });
    expect(dockFor(pauseRun(run, T0 + 100_000), retro(), HREF, T0 + 200_000)).toMatchObject({
      endsAt: null,
      pausedRemaining: 500,
    });
    expect(dockFor(startRun("daily", T0), daily(), HREF, T0 + 960_000)).toMatchObject({
      label: "Daily Scrum",
      endsAt: T0 + 960_000,
      pausedRemaining: 0,
    });
    expect(dockFor(null, retro(), HREF, T0)).toBeNull();
    expect(dockFor({ ...run, finished: true }, retro(), HREF, T0)).toBeNull();
  });

  it("follows a pause, resume or stop made in the dock", () => {
    const now = T0 + 300_000;
    const run = startRun("daily", T0);
    const dock = (patch: Partial<DockedTimer>): DockedTimer => ({
      label: "Daily Scrum",
      href: HREF,
      totalSeconds: 900,
      endsAt: T0 + 900_000,
      pausedRemaining: 600,
      ...patch,
    });
    // In step: nothing changes.
    expect(reconcileWithDock(run, daily(), dock({}), now)).toBe(run);
    // Paused for a minute in the dock, then resumed.
    const shifted = reconcileWithDock(run, daily(), dock({ endsAt: T0 + 960_000 }), now);
    expect(activeMs(shifted, now)).toBe(240_000);
    expect(shifted.since).toBe(now);
    // Paused in the dock with five minutes left.
    expect(
      reconcileWithDock(run, daily(), dock({ endsAt: null, pausedRemaining: 300 }), now)
    ).toMatchObject({ baseMs: 600_000, since: null });
    // The dock stopping itself at "Time's up": the meeting runs on.
    expect(reconcileWithDock(run, daily(), dock({ endsAt: null, pausedRemaining: 0 }), now)).toBe(
      run
    );
    // Stop in the dock: paused now, record kept.
    expect(reconcileWithDock(run, daily(), null, now)).toMatchObject({
      baseMs: 300_000,
      since: null,
    });
    const finished = { ...run, finished: true };
    expect(reconcileWithDock(finished, daily(), null, now)).toBe(finished);
  });

  it("carries on a countdown from before agendas as a Custom time-box", () => {
    const old: DockedTimer = {
      label: "Standup",
      href: HREF,
      totalSeconds: 900,
      endsAt: T0 + 600_000,
      pausedRemaining: 600,
    };
    const run = runFromLegacyDock(old, T0);
    expect(run).toMatchObject({ agendaId: "custom", baseMs: 300_000, since: T0 });
    expect(runFromLegacyDock({ ...old, endsAt: null, pausedRemaining: 120 }, T0)).toMatchObject({
      baseMs: 780_000,
      since: null,
    });
  });
});

/* -------------------------------------------------------------------------- */
/*  Verdicts and export                                                        */
/* -------------------------------------------------------------------------- */

const retroReport = (actuals: number[], planned = [360, 1200, 720, 900, 420]) => ({
  label: "Sprint Retrospective",
  short: "Retro",
  finished: true,
  plannedSeconds: planned.reduce((a, b) => a + b, 0),
  actualSeconds: actuals.reduce((a, b) => a + b, 0),
  segments: ["Set the stage", "Gather data", "Generate insights", "Decide what to do", "Close"].map(
    (label, i) => ({
      label,
      plannedSeconds: planned[i],
      actualSeconds: actuals[i],
      current: false,
      turns: [],
    })
  ),
});

describe("verdicts", () => {
  it("says how the meeting went and which part ran over most", () => {
    expect(runVerdict(retroReport([300, 1260, 1080, 960, 420]))).toBe(
      "Retro ran 7 minutes over; Generate insights took 18 of 12 minutes."
    );
    expect(runVerdict(retroReport([300, 1000, 700, 800, 400]))).toBe(
      "Retro finished 7 minutes early."
    );
    expect(runVerdict(retroReport([300, 1500, 600, 800, 400]))).toBe(
      "Retro finished on time; Gather data took 25 of 20 minutes."
    );
    expect(
      runVerdict({
        label: "Daily Scrum",
        short: "Daily Scrum",
        finished: true,
        plannedSeconds: 900,
        actualSeconds: 990,
        segments: [
          {
            label: "Round the team",
            plannedSeconds: 900,
            actualSeconds: 990,
            current: false,
            turns: [
              { name: "Ann", plannedSeconds: 300, actualSeconds: 400, skipped: false },
              { name: "Bo", plannedSeconds: 300, actualSeconds: 290, skipped: false },
              { name: "Cy", plannedSeconds: 300, actualSeconds: 0, skipped: true },
            ],
          },
        ],
      })
    ).toBe("Daily Scrum ran 2 minutes over; Ann spoke for 6:40 of 5:00.");
  });

  it("states the plan before the meeting", () => {
    expect(planVerdict(daily(), 5)).toBe("Daily Scrum: 15 min for 5 speakers, 3:00 each.");
    expect(planVerdict(daily(), 0)).toBe(
      "Daily Scrum: 15 min. Add speakers to give each a fair turn."
    );
    const oneMinute = resolveAgenda("daily", { daily: [{ id: "round", minutes: 1 }] }, 14);
    expect(planVerdict(oneMinute, 5)).toBe(
      "Daily Scrum: 5 speakers need at least 2:30, and the time-box is 1 min."
    );
    expect(planVerdict(retro(), 3)).toBe("Sprint Retrospective: 5 segments in 1 h 30 min.");
    expect(planVerdict(resolveAgenda("custom", null, 14), 0)).toBe(
      "Set the length of the time-box to start."
    );
    expect(
      planVerdict(resolveAgenda("custom", { custom: [{ id: "timebox", minutes: 20 }] }, 14), 2)
    ).toBe("Custom time-box: 20 min, one shared time-box.");
  });

  it("exports the agenda before, and planned against actual after", () => {
    const NOW = new Date(2026, 9, 24);
    const before = toMarkdown({ agenda: retro(), speakers: [] }, NOW);
    expect(before).toContain("**Sprint Retrospective:** 1:30:00 time-box");
    expect(before).toContain("| 2 | Gather data | 10:00 | 30:00 |");
    expect(before).toContain("No round of speakers in this agenda.");
    expect(before).toContain("**Sprint Retrospective: 5 segments in 1 h 30 min.**");

    const report = retroReport([300, 1260, 1080, 960, 420]);
    const after = toMarkdown({ agenda: retro(), speakers: [], report }, NOW);
    expect(after).toContain("| # | Segment | Planned | Actual | Difference |");
    expect(after).toContain("| 3 | Generate insights | 12:00 | 18:00 | +06:00 |");
    expect(after).toContain("| 1 | Set the stage | 06:00 | 05:00 | −01:00 |");
    expect(after).toContain("| | **Total** | 1:00:00 | 1:07:00 | +07:00 |");
    expect(after).toContain(
      "**Retro ran 7 minutes over; Generate insights took 18 of 12 minutes.**"
    );

    let run = startRun("daily", T0);
    run = endTurn(run, ANN, 450, false, T0 + 500_000);
    run = advanceSegment(run, 1, T0 + 500_000);
    const md = toMarkdown(
      { agenda: daily(), speakers: [ANN, BO], report: runReport(run, daily(), T0) },
      NOW
    );
    expect(md).toContain("## Turns\n\n| # | Speaker | Share | Spoke |");
    expect(md).toContain("| 1 | Ann | 07:30 | 08:20 |");

    // Mid-meeting, the segment on is "so far" and nothing is over or under yet.
    const live = startRun("retro", T0);
    const mid = toMarkdown(
      { agenda: retro(), speakers: [], report: runReport(live, retro(), T0 + 300_000) },
      NOW
    );
    expect(mid).toContain("| 1 | Set the stage | 10:00 | 05:00 so far | — |");
    expect(mid).toContain("| 2 | Gather data | 30:00 | — | — |");
    expect(mid).toContain("| | **Total** | 1:30:00 | 05:00 so far | — |");
    expect(mid).toContain("**Sprint Retrospective: 5 segments in 1 h 30 min.**");
  });
});

/* -------------------------------------------------------------------------- */
/*  Editing, stores and keys                                                   */
/* -------------------------------------------------------------------------- */

describe("the agenda editor", () => {
  it("keeps the total and the segments in step while typing", () => {
    const draft = draftOf(retro());
    expect(draft.total).toBe("90");
    expect(draft.rows.map((r) => r.minutes)).toEqual(["10", "30", "20", "20", "10"]);
    expect(withTotal(draft, "60").rows.map((r) => r.minutes)).toEqual(["7", "20", "13", "13", "7"]);
    expect(withTotal(draft, "2").rows).toBe(draft.rows);
    expect(withRowMinutes(draft, "gather-data", "40").total).toBe("100");
    expect(withRowMinutes(draft, "gather-data", "").total).toBe("90");
    expect(draftOf(resolveAgenda("custom", null, 14))).toMatchObject({
      total: "",
      rows: [{ minutes: "" }],
    });
  });

  it("rejects blanks and out-of-range lengths instead of defaulting them", () => {
    const base = retro();
    const draft = draftOf(base);
    const blank = {
      ...draft,
      rows: draft.rows.map((r, i) =>
        i === 0 ? { ...r, label: " " } : i === 1 ? { ...r, minutes: "" } : r
      ),
    };
    expect(validateAgenda(blank, base)).toEqual({
      ok: false,
      errors: {
        "label:set-the-stage": "Name this segment.",
        "minutes:gather-data": "Enter the minutes.",
      },
    });
    expect(validateAgenda({ ...draft, total: "2" }, base)).toMatchObject({
      errors: { total: "5 segments need at least 2.5 minutes." },
    });
    expect(validateAgenda(withTotal(draft, "500"), base)).toMatchObject({
      errors: { total: "The agenda can run up to 480 minutes." },
    });
    const tiny = withRowMinutes(draft, "close", "0.2");
    expect(validateAgenda(tiny, base)).toMatchObject({
      errors: { "minutes:close": "Minutes run from 0.5 to 480." },
    });
    const ok = validateAgenda(withTotal(draft, "60"), base);
    expect(ok.ok && ok.values.map((s) => s.seconds)).toEqual([420, 1200, 780, 780, 420]);
    const custom = resolveAgenda("custom", null, 14);
    expect(validateAgenda(draftOf(custom), custom)).toEqual({
      ok: false,
      errors: { "minutes:timebox": "Enter the minutes." },
    });
  });

  it("validates a new speaker's name", () => {
    expect(validateSpeaker({ name: "  " }, [])).toEqual({
      ok: false,
      errors: { name: "Enter a name." },
    });
    expect(validateSpeaker({ name: "ann" }, [ANN])).toEqual({
      ok: false,
      errors: { name: "“Ann” is already in the list." },
    });
    expect(validateSpeaker({ name: " Dee " }, [ANN])).toEqual({ ok: true, values: "Dee" });
  });
});

describe("stored state", () => {
  it("keeps only usable speakers, agendas and runs", () => {
    expect(
      normalizeSpeakers([
        { id: "a", name: " Ann " },
        { id: "a", name: "Same id" },
        { id: "b", name: "ann" },
        { id: "", name: "No id" },
        { id: "c", name: "" },
        null,
        "x",
        { id: "d", name: "Bo" },
      ])
    ).toEqual([
      { id: "a", name: "Ann" },
      { id: "d", name: "Bo" },
    ]);
    expect(normalizeSpeakers("nope")).toEqual([]);
    expect(normalizeAgendas({ retro: [{ id: "close" }], standup: [], daily: "x" })).toEqual({
      retro: [{ id: "close" }],
    });
    expect(normalizeAgendas(null)).toEqual({});

    const run = startRun("daily", T0);
    expect(normalizeSession({ agendaId: "daily", run })).toEqual({ agendaId: "daily", run });
    expect(normalizeSession({ agendaId: "retro", run })).toEqual({ agendaId: "retro", run: null });
    expect(normalizeSession({ agendaId: "daily", run: { ...run, segments: [{}] } }).run).toBeNull();
    expect(normalizeSession("garbage")).toEqual({ agendaId: null, run: null });
    expect(
      normalizeSession({
        agendaId: "daily",
        run: {
          ...run,
          index: 7,
          segments: [{ startMs: 0, turns: [{ speakerId: "a", spentMs: 5 }, 3] }],
        },
      }).run
    ).toMatchObject({
      index: 0,
      segments: [
        { startMs: 0, turnStartMs: 0, turns: [{ speakerId: "a", name: "", skipped: false }] },
      ],
    });
  });
});

describe("keyboard shortcuts", () => {
  const ev = (k: string, target: EventTarget | null, init: Partial<KeyboardEvent> = {}) => ({
    key: k,
    target,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    repeat: false,
    defaultPrevented: false,
    ...init,
  });

  it("maps Space, N, S and Shift+N, and stays out of fields and controls", () => {
    const body = document.body;
    const button = document.createElement("button");
    const input = document.createElement("input");
    expect(shortcutFor(ev(" ", body))).toBe("toggle");
    expect(shortcutFor(ev(" ", button))).toBeNull();
    expect(shortcutFor(ev("n", button))).toBe("next-speaker");
    expect(shortcutFor(ev("N", body, { shiftKey: true }))).toBe("next-segment");
    expect(shortcutFor(ev("s", body))).toBe("skip-speaker");
    expect(shortcutFor(ev("s", body, { ctrlKey: true }))).toBeNull();
    expect(shortcutFor(ev("n", input))).toBeNull();
    expect(shortcutFor(ev("n", body, { repeat: true }))).toBeNull();
    expect(shortcutFor(ev("x", body))).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/*  The page                                                                   */
/* -------------------------------------------------------------------------- */

describe("running a Daily Scrum", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    useTimerSettings.setState({ speakers: [ANN, BO, CY] });
  });

  it("hands leftover time on, counts overtime up, and ends with a verdict", () => {
    renderTimer();
    pick(/^Daily Scrum/);
    expect(screen.getByText("Daily Scrum: 15 min for 3 speakers, 5:00 each.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start timer" })).toHaveAttribute(
      "aria-keyshortcuts",
      "Space"
    );

    key(" ");
    expect(useDockTimer.getState().timer).toMatchObject({
      label: "Daily Scrum",
      totalSeconds: 900,
    });
    tick(60);
    expect(timer()).toBe("14:00");

    // Ann finishes early: Bo and Cy share the rest.
    key("n");
    const order = () => screen.getByRole("list", { name: "Speaking order" });
    expect(within(order()).getByText("spoke 1:00")).toBeInTheDocument();
    expect(within(order()).getByText("7:00 left")).toBeInTheDocument();
    expect(within(order()).getByText("7:00 each")).toBeInTheDocument();

    // Bo runs over: the count goes up and Cy's share shrinks.
    tick(500);
    expect(screen.getAllByText("+1:20 over").length).toBeGreaterThan(0);
    expect(within(order()).getByText("5:40 each")).toBeInTheDocument();

    key("n");
    expect(within(order()).getByText("5:40 left")).toBeInTheDocument();
    key("s");
    expect(within(order()).getByText("skipped")).toBeInTheDocument();
    expect(screen.getByText("Everyone has spoken.")).toBeInTheDocument();

    // Past the time-box: overtime, said in text and announced, no sound by default.
    tick(400);
    // The announcer speaks a moment after the update.
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(timer()).toBe("+1:00");
    expect(screen.getByText("Over time")).toBeInTheDocument();
    expect(screen.getByTestId("live-assertive")).toHaveTextContent("Daily Scrum: time's up");
    expect(alarm.flashTitle).toHaveBeenCalledTimes(1);
    expect(alarm.playChime).not.toHaveBeenCalled();
    expect(alarm.vibrate).not.toHaveBeenCalled();

    key("N", { shiftKey: true });
    expect(
      screen.getByText("Daily Scrum ran 1 minute over; Bo spoke for 8:20 of 7:00.")
    ).toBeInTheDocument();
    expect(useDockTimer.getState().timer).toBeNull();
    expect(exported.markdown).toContain("| 2 | Bo | 07:00 | 08:20 |");
    expect(exported.markdown).toContain("| 3 | Cy | 05:40 | skipped |");
  });

  it("chimes only when the team turned the chime on", () => {
    useTimerSettings.setState({ chime: true });
    renderTimer();
    pick(/^Daily Scrum/);
    expect(screen.getByRole("switch", { name: "Chime when time is up" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    key(" ");
    tick(301);
    expect(alarm.playChime).toHaveBeenCalledWith(1);
    tick(600);
    expect(alarm.playChime).toHaveBeenCalledWith(3);
    expect(alarm.vibrate).toHaveBeenCalledTimes(1);
  });

  it("keeps the meeting when picking another agenda is undone", () => {
    renderTimer();
    pick(/^Daily Scrum/);
    key(" ");
    tick(30);
    pick(/^Sprint Review/);
    expect(useTimerSession.getState()).toMatchObject({ agendaId: "review", run: null });
    const [label, opts] = toastSpy.mock.calls[0];
    expect(label).toBe("Switched to Sprint Review");
    act(() => opts.action.onClick());
    expect(useTimerSession.getState().agendaId).toBe("daily");
    expect(timer()).toBe("14:30");
  });
});

describe("running an agenda", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  it("goes segment by segment to a summary of planned against actual", () => {
    renderTimer();
    pick(/^Sprint Retrospective/);
    const segments = screen.getByRole("list", { name: "Agenda segments" });
    expect(within(segments).getAllByRole("listitem")).toHaveLength(5);

    fireEvent.click(screen.getByRole("button", { name: "Start timer" }));
    tick(720);
    expect(timer()).toBe("+2:00");
    expect(useDockTimer.getState().timer).toMatchObject({ label: "Retro · Set the stage" });

    fireEvent.click(screen.getByRole("button", { name: "Next segment" }));
    expect(screen.getByTestId("live-polite").textContent).toBe("");
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(screen.getByTestId("live-polite")).toHaveTextContent(
      "Segment 2 of 5: Gather data, 30 min."
    );
    expect(
      within(screen.getByRole("list", { name: "Agenda segments" })).getByText("(+2:00)")
    ).toBeInTheDocument();

    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByRole("button", { name: "Next segment" }));
    }
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(
      screen.getByText(
        "Retro finished 78 minutes early, though Set the stage took 12 of 10 minutes."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(/^1 of 5 segments ran over; the meeting took 12:00/)
    ).toBeInTheDocument();
    expect(exported.markdown).toContain("| 1 | Set the stage | 10:00 | 12:00 | +02:00 |");
    expect(useDockTimer.getState().timer).toBeNull();
  });

  it("asks a Custom time-box for its length before it can start", () => {
    vi.useRealTimers();
    renderTimer();
    pick(/^Custom time-box/);
    expect(screen.getByRole("button", { name: "Start timer" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Save agenda" }));
    const minutes = screen.getByRole("spinbutton", { name: /^Minutes/ });
    expect(screen.getByText("Enter the minutes.")).toBeInTheDocument();
    expect(minutes).toHaveFocus();
    fireEvent.change(minutes, { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Save agenda" }));
    expect(timer()).toBe("20:00");
    expect(screen.getByRole("button", { name: "Start timer" })).toBeEnabled();
    expect(useTimerSettings.getState().agendas).toEqual({
      custom: [{ id: "timebox", minutes: 20 }],
    });
  });
});

describe("editing an agenda", () => {
  it("saves a valid draft, re-splitting the total, and resets with confirm and Undo", () => {
    renderTimer();
    pick(/^Sprint Retrospective/);
    fireEvent.click(screen.getByRole("button", { name: "Edit agenda" }));

    const name = screen.getByRole("textbox", { name: /^Segment 1 name/ });
    fireEvent.change(name, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save agenda" }));
    expect(screen.getByText("Name this segment.")).toBeInTheDocument();
    expect(name).toHaveFocus();
    expect(useTimerSettings.getState().agendas).toEqual({});

    fireEvent.change(name, { target: { value: "Check in" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: /^Total minutes/ }), {
      target: { value: "60" },
    });
    expect(
      screen
        .getAllByRole("spinbutton", { name: /^Segment \d minutes/ })
        .map((i) => (i as HTMLInputElement).value)
    ).toEqual(["7", "20", "13", "13", "7"]);
    fireEvent.click(screen.getByRole("button", { name: "Save agenda" }));

    expect(useTimerSettings.getState().agendas.retro).toHaveLength(5);
    expect(screen.getByRole("button", { name: /^Sprint Retrospective/ })).toHaveTextContent("1 h");
    expect(
      within(screen.getByRole("list", { name: "Agenda segments" })).getByText("Check in")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Reset agenda" })
    );
    expect(useTimerSettings.getState().agendas).toEqual({});
    expect(screen.getByRole("button", { name: /^Sprint Retrospective/ })).toHaveTextContent(
      "1 h 30 min"
    );
    const [label, opts] = toastSpy.mock.calls[0];
    expect(label).toBe("Reset the Sprint Retrospective agenda");
    act(() => opts.action.onClick());
    expect(useTimerSettings.getState().agendas.retro).toHaveLength(5);
  });

  it("switches turn-taking on for the segment that's on", () => {
    useTimerSettings.setState({ speakers: [ANN, BO] });
    renderTimer();
    pick(/^Sprint Retrospective/);
    expect(screen.queryByRole("button", { name: "Next speaker" })).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "Speakers take turns in Set the stage" }));
    expect(useTimerSettings.getState().agendas).toEqual({
      retro: [{ id: "set-the-stage", speakers: true }],
    });
    expect(screen.getByRole("button", { name: "Next speaker" })).toHaveAttribute(
      "aria-keyshortcuts",
      "N"
    );
  });
});

describe("speakers", () => {
  it("adds through a validated form and removes with Undo", () => {
    renderTimer();
    const input = screen.getByRole("combobox", { name: "Speaker" });
    fireEvent.click(screen.getByRole("button", { name: "Add speaker" }));
    expect(screen.getByText("Enter a name.")).toBeInTheDocument();
    expect(useTimerSettings.getState().speakers).toEqual([]);

    fireEvent.change(input, { target: { value: "Ann" } });
    fireEvent.click(screen.getByRole("button", { name: "Add speaker" }));
    fireEvent.change(input, { target: { value: "ANN" } });
    fireEvent.click(screen.getByRole("button", { name: "Add speaker" }));
    expect(screen.getByText("“Ann” is already in the list.")).toBeInTheDocument();
    expect(useTimerSettings.getState().speakers).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Remove Ann" }));
    expect(useTimerSettings.getState().speakers).toEqual([]);
    const [label, opts] = toastSpy.mock.calls[0];
    expect(label).toBe("Removed “Ann”");
    act(() => opts.action.onClick());
    expect(useTimerSettings.getState().speakers.map((p) => p.name)).toEqual(["Ann"]);
  });
});

describe("coming back to the page", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0 + 400_000);
  });

  it("picks up a countdown the timer left before agendas", () => {
    useDockTimer.setState({
      timer: {
        label: "Standup",
        href: HREF,
        totalSeconds: 900,
        endsAt: T0 + 1_000_000,
        pausedRemaining: 900,
      },
    });
    renderTimer();
    expect(screen.getByRole("button", { name: /^Custom time-box/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "Pause timer" })).toBeInTheDocument();
    expect(timer()).toBe("10:00");
    // Left as it was: no republish until the facilitator changes something.
    expect(useDockTimer.getState().timer?.label).toBe("Standup");
  });

  it("follows a pause made in the dock", () => {
    useTimerSession.setState({ agendaId: "daily", run: startRun("daily", T0) });
    useDockTimer.setState({
      timer: {
        label: "Daily Scrum",
        href: HREF,
        totalSeconds: 900,
        endsAt: null,
        pausedRemaining: 300,
      },
    });
    renderTimer();
    expect(screen.getByRole("button", { name: "Start timer" })).toBeInTheDocument();
    expect(timer()).toBe("05:00");
  });

  it("opens the agenda a link names", () => {
    window.history.replaceState({}, "", "/ceremony-timer?agenda=one-two-four-all");
    renderTimer();
    expect(screen.getByRole("button", { name: /^1-2-4-All/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(timer()).toBe("01:00");
  });
});

describe("first run", () => {
  it("offers the example from the empty state and keeps it out of the workspace", () => {
    renderTimer();
    expect(
      screen.getByText(
        "Pick an agenda to run a ceremony to time, or load an example: a Daily Scrum for five speakers."
      )
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(useTimerSession.getState()).toMatchObject({ agendaId: "daily", run: null });
    expect(useTimerSettings.getState().speakers.every((p) => p.id.startsWith("example-"))).toBe(
      true
    );
    expect(screen.getByText("Daily Scrum: 15 min for 5 speakers, 3:00 each.")).toBeInTheDocument();
  });
});
