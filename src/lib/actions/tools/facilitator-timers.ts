/**
 * Facilitator Timers — tool-local actions.
 *
 * Category: Ceremonies (tools plan, phase 1, P1.7)
 * Tool:     Pomodoro, a "Back at 10:45" break screen, Crazy 8s rounds, a
 *           meeting cost ticker, focus sounds and a soundboard.
 *
 * Agent surface: tool.facilitator_timers.*
 *
 *   1. list_state   — the timers' lengths and switches, the timer on (in
 *                     this browser tab), the cost ticker's people and time
 *                     (never its rate), and the agenda draft.
 *   2. start_timer  — start a Pomodoro, a break or Crazy 8s on the docked
 *                     timer. It never replaces another page's clock (a
 *                     ceremony's), and only replaces a facilitator timer
 *                     that's on when asked to (`replace`). It reaches no one
 *                     else (no room), so visitors may use it. Timers run in
 *                     the browser: over MCP it says so and starts nothing.
 *   3. meeting_cost — people × an hourly rate × minutes: the cost, per
 *                     minute and in person-hours. Pure; nothing is stored.
 *
 * The settings live in the tool's synced store ("agile-toolkit:facilitator-
 * timers"); the run and the cost ticker in this tab's sessionStorage only.
 * Over MCP list_state reads the synced settings row; there is no tab, so no
 * run or ticker.
 */

import { z } from "zod";
import { registry } from "../registry";
import { readUserStateBlob } from "../user-state-blob";
import {
  FT_HREF,
  LIMITS,
  TIMER_KINDS,
  backAtFromClock,
  backAtFromMinutes,
  breakRun,
  clockTime,
  costElapsedMs,
  costPerMinute,
  crazy8sSteps,
  currentStep,
  formatMoney,
  meetingCost,
  newRun,
  normalizeCrazy8s,
  normalizePomodoro,
  personHours,
  pomodoroSteps,
  runIsLive,
  stepsSeconds,
  type TimerRun,
} from "@/lib/facilitator-timers/model";
import {
  SETTINGS_KEY,
  facilitatorSettings,
  hydrateCostTicker,
  hydrateFacilitatorSettings,
  hydrateFtSession,
  normalizeCost,
  normalizeSettings,
  startTimerRun,
  useCostTicker,
  useFtSession,
  type FacilitatorSettings,
} from "@/lib/facilitator-timers/store";
import { timerRemaining, useDockTimer } from "@/lib/timer/dock-timer";

const TOOL = "tool.facilitator_timers";

/** The synced row as stored: the store's state, or (a local copy) wrapped in `state`. */
function unwrapBlob(raw: unknown): unknown {
  if (raw && typeof raw === "object" && "state" in raw) return (raw as { state: unknown }).state;
  return raw;
}

function settingsSummary(s: FacilitatorSettings) {
  return {
    pomodoro: s.pomodoro,
    breakMinutes: s.breakMinutes,
    crazy8s: s.crazy8s,
    chime: s.chime,
    focusSound: s.focusSound,
    soundboardWhilePresenting: s.soundboardWhilePresenting,
    agendaDraft: {
      goal: s.agenda.goal,
      minutes: s.agenda.minutes,
      segments: s.agenda.segments.map((x) => ({ label: x.label, minutes: x.minutes })),
    },
  };
}

function runSummary(run: TimerRun, now: number) {
  const dock = useDockTimer.getState().timer;
  const ours = dock?.href === FT_HREF ? dock : null;
  const step = currentStep(run);
  return {
    kind: run.kind,
    title: run.title,
    finished: run.finished,
    step: step?.label ?? null,
    stepIndex: run.index,
    steps: run.steps.length,
    remainingSeconds: ours ? timerRemaining(ours, now) : 0,
    paused: Boolean(ours && ours.endsAt === null),
    ...(run.backAt !== undefined ? { backAt: clockTime(run.backAt) } : {}),
  };
}

// ──────── tool.facilitator_timers.list_state ────────
registry.register({
  id: `${TOOL}.list_state`,
  toolId: TOOL,
  name: "list_state",
  category: "read",
  description:
    "Facilitator Timers' state: {pomodoro {workMinutes, breakMinutes, rounds}, breakMinutes, crazy8s {rounds, roundSeconds}, chime, focusSound, soundboardWhilePresenting, agendaDraft {goal, minutes, segments {label, minutes}[]}, running: {kind, title, finished, step, stepIndex, steps, remainingSeconds, paused, backAt?} | null, costTicker: {running, attendees, elapsedSeconds} | null}. The cost ticker's rate is never returned. Over MCP only the saved settings are known (running and costTicker are null).",
  paramsSchema: z.object({}),
  handler: async () => {
    hydrateFacilitatorSettings();
    hydrateFtSession();
    hydrateCostTicker();
    const now = Date.now();
    const { run } = useFtSession.getState();
    const live = run && runIsLive(run, useDockTimer.getState().timer) ? run : null;
    const cost = normalizeCost(useCostTicker.getState());
    return {
      ...settingsSummary(facilitatorSettings()),
      running: live ? runSummary(live, now) : null,
      costTicker:
        cost.clock && cost.attendees !== null
          ? {
              running: cost.clock.since !== null,
              attendees: cost.attendees,
              elapsedSeconds: Math.floor(costElapsedMs(cost.clock, now) / 1000),
            }
          : null,
    };
  },
  mcpHandler: async (_params, ctx) => {
    const raw = await readUserStateBlob(SETTINGS_KEY, ctx.userId);
    return {
      ...settingsSummary(normalizeSettings(unwrapBlob(raw))),
      running: null,
      costTicker: null,
    };
  },
});

// ──────── tool.facilitator_timers.start_timer ────────
const startParams = z.object({
  kind: z.enum(TIMER_KINDS),
  minutes: z
    .number()
    .int()
    .min(LIMITS.breakScreenMinutes.min)
    .max(LIMITS.breakScreenMinutes.max)
    .optional()
    .describe("break: its length in minutes (or give backAt)"),
  backAt: z
    .string()
    .regex(/^\d{1,2}:\d{2}$/)
    .optional()
    .describe('break: the local time to be back, "10:45"'),
  workMinutes: z.number().int().min(LIMITS.workMinutes.min).max(LIMITS.workMinutes.max).optional(),
  breakMinutes: z
    .number()
    .int()
    .min(LIMITS.breakMinutes.min)
    .max(LIMITS.breakMinutes.max)
    .optional(),
  rounds: z.number().int().min(LIMITS.rounds.min).max(LIMITS.rounds.max).optional(),
  sketches: z.number().int().min(LIMITS.sketchRounds.min).max(LIMITS.sketchRounds.max).optional(),
  secondsPerSketch: z
    .number()
    .int()
    .min(LIMITS.roundSeconds.min)
    .max(LIMITS.roundSeconds.max)
    .optional(),
  replace: z.boolean().optional().describe("replace a facilitator timer that's already on"),
});

type StartParams = z.infer<typeof startParams>;

/** The run the params ask for, with the saved lengths for anything not given. */
export function runFromParams(
  p: StartParams,
  s: FacilitatorSettings,
  now: number
): { ok: true; run: TimerRun } | { ok: false; reason: string } {
  if (p.kind === "pomodoro") {
    const settings = normalizePomodoro({
      workMinutes: p.workMinutes ?? s.pomodoro.workMinutes,
      breakMinutes: p.breakMinutes ?? s.pomodoro.breakMinutes,
      rounds: p.rounds ?? s.pomodoro.rounds,
    });
    return { ok: true, run: newRun("pomodoro", pomodoroSteps(settings)) };
  }
  if (p.kind === "crazy-8s") {
    const settings = normalizeCrazy8s({
      rounds: p.sketches ?? s.crazy8s.rounds,
      roundSeconds: p.secondsPerSketch ?? s.crazy8s.roundSeconds,
    });
    return { ok: true, run: newRun("crazy-8s", crazy8sSteps(settings)) };
  }
  if (p.backAt) {
    const at = backAtFromClock(p.backAt, now);
    return at.ok ? { ok: true, run: breakRun(at.at, now) } : { ok: false, reason: at.error };
  }
  return { ok: true, run: breakRun(backAtFromMinutes(p.minutes ?? s.breakMinutes, now), now) };
}

registry.register({
  id: `${TOOL}.start_timer`,
  toolId: TOOL,
  name: "start_timer",
  category: "write",
  requiresConfirmation: false,
  visitor: true,
  description:
    'Start a facilitator timer on the docked timer in this browser tab: kind "pomodoro" (workMinutes, breakMinutes, rounds), "break" (minutes, or backAt "10:45") or "crazy-8s" (sketches, secondsPerSketch); anything not given uses the saved lengths. It never replaces another page\'s timer (a ceremony\'s), and replaces a facilitator timer that\'s on only with replace: true. Returns {started, kind, title, steps, firstStep, totalSeconds, backAt?} or {started: false, reason}.',
  paramsSchema: startParams,
  handler: async (params) => {
    hydrateFacilitatorSettings();
    hydrateFtSession();
    const now = Date.now();
    const { run: current } = useFtSession.getState();
    const dock = useDockTimer.getState().timer;
    if (current && !current.finished && runIsLive(current, dock) && !params.replace) {
      return {
        started: false,
        reason: `${current.title} is on. Pass replace: true to start another instead.`,
      };
    }
    const built = runFromParams(params, facilitatorSettings(), now);
    if (!built.ok) return { started: false, reason: built.reason };
    const claim = startTimerRun(built.run, now);
    if (!claim.ok) {
      return {
        started: false,
        reason: `“${claim.holder.label}” holds the docked timer. Stop or finish it first.`,
      };
    }
    const first = currentStep(claim.run);
    return {
      started: true,
      kind: claim.run.kind,
      title: claim.run.title,
      steps: claim.run.steps.length,
      firstStep: first ? { label: first.label, seconds: first.seconds } : null,
      totalSeconds: stepsSeconds(claim.run.steps),
      ...(claim.run.backAt !== undefined ? { backAt: clockTime(claim.run.backAt) } : {}),
    };
  },
  mcpHandler: async () => ({
    started: false,
    reason:
      "Timers run in the browser tab: open Facilitator Timers (/facilitator-timers) or ask Amr there to start one.",
  }),
});

// ──────── tool.facilitator_timers.meeting_cost ────────
registry.register({
  id: `${TOOL}.meeting_cost`,
  toolId: TOOL,
  name: "meeting_cost",
  category: "read",
  description:
    "What a meeting costs: attendees × hourlyRate (a rough average per person) × minutes. Returns {cost, perMinute, personHours, text}. Pure: nothing is stored, and the rate is only used for this answer.",
  paramsSchema: z.object({
    attendees: z.number().int().min(LIMITS.attendees.min).max(LIMITS.attendees.max),
    hourlyRate: z.number().positive().max(LIMITS.hourlyRate.max),
    minutes: z
      .number()
      .positive()
      .max(24 * 60),
    currency: z.string().trim().max(8).optional(),
  }),
  handler: async ({ attendees, hourlyRate, minutes, currency }) => {
    const seconds = minutes * 60;
    const cost = meetingCost(attendees, hourlyRate, seconds);
    const perMinute = costPerMinute(attendees, hourlyRate);
    const hours = personHours(attendees, seconds);
    const unit = currency ?? "";
    const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;
    return {
      cost: round(cost, 2),
      perMinute: round(perMinute, 2),
      personHours: round(hours, 1),
      text: `${attendees} ${attendees === 1 ? "person" : "people"} for ${round(minutes, 1)} min: ${formatMoney(cost, unit, "en")} (${formatMoney(perMinute, unit, "en")} a minute, ${round(hours, 1)} person-hours).`,
    };
  },
});
