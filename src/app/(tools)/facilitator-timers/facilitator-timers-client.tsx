"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Hourglass } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { startPresenting, usePresentation } from "@/components/presentation/presentation-mode";
import { ActionRow } from "@/components/shared/action-row";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import {
  ExampleNotice,
  LoadExampleButton,
  hasExampleItems,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { generateFacilitatorTimersPrompts } from "@/lib/ai-prompts/facilitator-timers";
import { flashTitle, playChime, vibrate } from "@/lib/celebrate/chime";
import { cheer } from "@/lib/celebrate/cheer";
import type { AgendaSegmentDraft } from "@/lib/facilitator-timers/agenda";
import {
  FT_HREF,
  autoAdvances,
  backAtFromMinutes,
  breakEndsAt,
  breakRun,
  clockTime,
  costElapsedMs,
  crazy8sSteps,
  currentStep,
  dockPaused,
  lengthText,
  newRun,
  pauseCostClock,
  pomodoroSteps,
  runIsLive,
  startCostClock,
  stepsSeconds,
  type CostClock,
  type Crazy8sSettings,
  type PomodoroSettings,
  type TimerRun,
} from "@/lib/facilitator-timers/model";
import {
  DRAFT_MAX_SEGMENTS,
  advanceTimerRun,
  hydrateCostTicker,
  hydrateFacilitatorSettings,
  hydrateFtSession,
  normalizeAgendaDraft,
  normalizeCost,
  normalizeSettings,
  pauseTimerRun,
  resumeTimerRun,
  startTimerRun,
  stopTimerRun,
  syncBreakBackAt,
  useCostTicker,
  useFacilitatorSettings,
  useFtSession,
  type AgendaDraftState,
  type DraftSegment,
  type FacilitatorSettings,
} from "@/lib/facilitator-timers/store";
import { FACILITATOR_TIMERS_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { useVisibilityTick } from "@/lib/hooks/use-visibility-tick";
import { useTeamRoster } from "@/lib/team/use-team-roster";
import {
  timerRemaining,
  useDockTimer,
  useRingsOwnAlarm,
  useSaysOwnTimesUp,
  type DockedTimer,
} from "@/lib/timer/dock-timer";
import { removeWithUndo, undoable } from "@/lib/utils/undoable";
import {
  AGENDA_IDS,
  MAX_AGENDA_MINUTES,
  agendaLabel,
  namedAgendaFrom,
  newSavedAgendaId,
  newSegmentId,
  normalizeNamedAgendas,
} from "@/app/(tools)/ceremony-timer/agenda";
import { useTimerSettings } from "@/app/(tools)/ceremony-timer/store";
import { AgendaPlanner, type SavedToTimer } from "./agenda-planner";
import { CostCard } from "./cost-card";
import { buildExample } from "./example";
import type { BreakValues, CostValues } from "./forms";
import { toMarkdown } from "./markdown";
import { FocusSoundsCard, SoundboardCard } from "./sounds-card";
import { TimerPanel } from "./timer-panel";
import { TimerSetup } from "./timer-setup";

const TOOL = "facilitator-timers";

const setSettings = (patch: Partial<FacilitatorSettings>) => useFacilitatorSettings.setState(patch);

function setAgenda(fn: (a: AgendaDraftState) => AgendaDraftState) {
  useFacilitatorSettings.setState((s) => ({ agenda: fn(normalizeAgendaDraft(s.agenda)) }));
}

/** "“Retro · Gather data” is on the docked timer…": who holds the dock. */
function holderText(holder: DockedTimer): string {
  return `“${holder.label}” is on the docked timer. Stop or finish it there first: a ceremony's clock is never replaced.`;
}

const samePomodoro = (a: PomodoroSettings, b: PomodoroSettings) =>
  a.workMinutes === b.workMinutes && a.breakMinutes === b.breakMinutes && a.rounds === b.rounds;
const sameCrazy8s = (a: Crazy8sSettings, b: Crazy8sSettings) =>
  a.rounds === b.rounds && a.roundSeconds === b.roundSeconds;

export function FacilitatorTimersClient() {
  const raw = useFacilitatorSettings(
    useShallow((s) => ({
      pomodoro: s.pomodoro,
      breakMinutes: s.breakMinutes,
      crazy8s: s.crazy8s,
      chime: s.chime,
      focusSound: s.focusSound,
      focusVolume: s.focusVolume,
      soundboardWhilePresenting: s.soundboardWhilePresenting,
      agenda: s.agenda,
    }))
  );
  const settings = useMemo(() => normalizeSettings(raw), [raw]);
  const storedRun = useFtSession((s) => s.run);
  const dockTimer = useDockTimer((s) => s.timer);
  const costRaw = useCostTicker(
    useShallow((s) => ({
      attendees: s.attendees,
      hourlyRate: s.hourlyRate,
      currency: s.currency,
      clock: s.clock,
    }))
  );
  const cost = useMemo(() => normalizeCost(costRaw), [costRaw]);
  const ctNamed = useTimerSettings((s) => s.named);
  const presenting = usePresentation((s) => s.presenting);
  const roster = useTeamRoster();
  const { log } = useHistoryLogger(TOOL);
  const announce = useAnnounce();
  const [now, setNow] = useState(() => Date.now());
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedToTimer | null>(null);

  // Loaded on mount, so the server render and the first client render agree.
  useEffect(() => {
    hydrateFacilitatorSettings();
    hydrateFtSession();
    hydrateCostTicker();
    // The Ceremony Timer's agendas, before anything is saved into them.
    if (!useTimerSettings.persist.hasHydrated()) void useTimerSettings.persist.rehydrate();
    // A run whose clock was stopped on another page is over.
    const { run } = useFtSession.getState();
    if (run && !runIsLive(run, useDockTimer.getState().timer)) useFtSession.setState({ run: null });
    setNow(Date.now());
    setReady(true);
  }, []);

  const ours = dockTimer?.href === FT_HREF ? dockTimer : null;
  const other = dockTimer && dockTimer.href !== FT_HREF ? dockTimer : null;
  const run = ready && storedRun && runIsLive(storedRun, dockTimer) ? storedRun : null;
  const remaining = ours ? timerRemaining(ours, now) : 0;
  const running = Boolean(ours && ours.endsAt !== null && remaining > 0);
  const costRunning = Boolean(cost.clock && cost.clock.since !== null);

  useVisibilityTick(running || costRunning || run?.kind === "break", 1000, () =>
    setNow(Date.now())
  );
  // A pause, resume or new step shows at once, not on the next tick; a
  // break resumed on the pill moves its time to be back with the clock.
  useEffect(() => {
    setNow(Date.now());
    syncBreakBackAt(dockTimer);
  }, [dockTimer]);
  // The tick stops while the tab is hidden; this wakes the page when the
  // step ends anyway, so the cue, the flashing title and the next round
  // still come on time for a facilitator in another window.
  useEffect(() => {
    const endsAt = ours?.endsAt ?? null;
    if (endsAt === null) return;
    const wait = endsAt - Date.now();
    if (wait <= 0) return;
    const t = setTimeout(() => setNow(Date.now()), wait + 50);
    return () => clearTimeout(t);
  }, [ours?.endsAt]);

  // ---------------------------------------------------------------------------
  // Time's up: once per step, on the tick that reaches zero with the page open
  // ---------------------------------------------------------------------------

  // While a run is on, this page says and rings its own time's up (under
  // its own chime switch), so the shell's docked timer stays quiet here.
  const ownsTimesUp = run && !run.finished ? FT_HREF : null;
  useSaysOwnTimesUp(ownsTimesUp);
  useRingsOwnAlarm(ownsTimesUp);

  const lastRef = useRef<{ run: TimerRun; left: number } | null>(null);
  const chime = settings.chime;
  useEffect(() => {
    if (!run || run.finished) {
      lastRef.current = null;
      return;
    }
    const prev = lastRef.current;
    lastRef.current = { run, left: remaining };
    if (!prev || prev.run !== run || !(prev.left > 0 && remaining <= 0)) return;

    // Said here, once and assertively: the docked timer leaves it to this page.
    const step = currentStep(run);
    flashTitle("Time's up");
    if (run.kind === "break") {
      if (chime) {
        playChime(3);
        vibrate();
      }
      announce("Break's over: welcome back.", "assertive");
      log(FACILITATOR_TIMERS_ACTIONS.TIMER_FINISHED, {
        timer: "break",
        seconds: step?.seconds ?? 0,
      });
      return;
    }
    if (!autoAdvances(run)) return;
    const result = advanceTimerRun(Date.now());
    if (!result) return;
    if (!result.ok) {
      setStatus(holderText(result.holder));
      return;
    }
    if (result.run.finished) {
      if (chime) {
        playChime(3);
        vibrate();
      }
      announce(`${run.title} done.`, "assertive");
      log(FACILITATOR_TIMERS_ACTIONS.TIMER_FINISHED, {
        timer: run.kind,
        seconds: stepsSeconds(run.steps),
      });
      cheer(TOOL, "done");
    } else {
      // The cue for the next round: one beep (with the chime on), and said aloud.
      if (chime) {
        playChime(1);
        vibrate([150]);
      }
      const next = currentStep(result.run);
      if (next) announce(`${next.label}: ${lengthText(next.seconds)}.`, "assertive");
    }
  }, [run, remaining, chime, announce, log]);

  // ---------------------------------------------------------------------------
  // Keyboard focus: a start, a step or a stop changes the controls, and focus
  // would otherwise drop to the page. Applied once React has drawn the change.
  // ---------------------------------------------------------------------------

  const controlsRef = useRef<HTMLButtonElement>(null);
  const setupRef = useRef<HTMLDivElement>(null);
  const focusNext = useRef<"controls" | "setup" | null>(null);
  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    const el =
      target === "controls"
        ? controlsRef.current
        : setupRef.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]');
    if (!el) return;
    focusNext.current = null;
    el.focus();
  });

  // ---------------------------------------------------------------------------
  // Starting and running a timer
  // ---------------------------------------------------------------------------

  const busy: string | null =
    run && !run.finished
      ? `${run.title} is on. Stop it to start another timer.`
      : other
        ? holderText(other)
        : null;

  /** Start `next` on the dock; says why when it can't (the setup card shows `busy` already). */
  const begin = (next: TimerRun): boolean => {
    if (busy) {
      announce(busy);
      return false;
    }
    const claim = startTimerRun(next, Date.now());
    if (!claim.ok) {
      const why = holderText(claim.holder);
      setStatus(why);
      announce(why);
      return false;
    }
    setStatus(null);
    setNow(Date.now());
    focusNext.current = "controls";
    return true;
  };

  const startPomodoro = (s: PomodoroSettings) => {
    if (!samePomodoro(s, settings.pomodoro)) {
      setSettings({ pomodoro: s });
      log(FACILITATOR_TIMERS_ACTIONS.SETTINGS_SAVED, { timer: "pomodoro" });
    }
    const steps = pomodoroSteps(s);
    if (!begin(newRun("pomodoro", steps))) return;
    log(FACILITATOR_TIMERS_ACTIONS.TIMER_STARTED, {
      timer: "pomodoro",
      seconds: stepsSeconds(steps),
    });
    announce(`Pomodoro started: ${steps[0].label}, ${lengthText(steps[0].seconds)}.`);
  };

  const startCrazy8s = (s: Crazy8sSettings) => {
    if (!sameCrazy8s(s, settings.crazy8s)) {
      setSettings({ crazy8s: s });
      log(FACILITATOR_TIMERS_ACTIONS.SETTINGS_SAVED, { timer: "crazy-8s" });
    }
    const steps = crazy8sSteps(s);
    if (!begin(newRun("crazy-8s", steps))) return;
    log(FACILITATOR_TIMERS_ACTIONS.TIMER_STARTED, {
      timer: "crazy-8s",
      seconds: stepsSeconds(steps),
    });
    announce(`Crazy 8s started: ${steps[0].label}, ${lengthText(steps[0].seconds)}.`);
  };

  const startBreak = (values: BreakValues) => {
    const t = Date.now();
    const { minutes } = values;
    // Minutes count from the press, not from when the form last drew.
    const backAt = minutes !== undefined ? backAtFromMinutes(minutes, t) : values.backAt;
    if (minutes !== undefined && minutes !== settings.breakMinutes) {
      setSettings({ breakMinutes: minutes });
    }
    if (!begin(breakRun(backAt, t))) return;
    log(FACILITATOR_TIMERS_ACTIONS.BREAK_STARTED, {
      minutes: Math.round((backAt - t) / 60000),
    });
    announce(`Break until ${clockTime(backAt)}.`);
  };

  const pause = () => {
    if (!run) return;
    pauseTimerRun(Date.now());
    log(FACILITATOR_TIMERS_ACTIONS.TIMER_PAUSED, { timer: run.kind });
  };
  const resume = () => {
    if (!run) return;
    resumeTimerRun(Date.now());
    log(FACILITATOR_TIMERS_ACTIONS.TIMER_STARTED, { timer: run.kind, resumed: true });
  };
  /** Next step by hand (a round cut short, or one whose time ran out while away). */
  const next = () => {
    if (!run) return;
    const result = advanceTimerRun(Date.now());
    if (!result) return;
    if (!result.ok) {
      setStatus(holderText(result.holder));
      return;
    }
    setNow(Date.now());
    focusNext.current = "controls";
    if (result.run.finished) {
      announce(`${run.title} done.`);
      log(FACILITATOR_TIMERS_ACTIONS.TIMER_FINISHED, {
        timer: run.kind,
        seconds: stepsSeconds(run.steps),
      });
      cheer(TOOL, "done");
    } else {
      const step = currentStep(result.run);
      if (step) announce(`${step.label}: ${lengthText(step.seconds)}.`);
    }
  };
  const stop = () => {
    const title = run?.title;
    stopTimerRun();
    setStatus(null);
    focusNext.current = "setup";
    if (title) announce(`${title} stopped.`);
  };
  const present = () => {
    // "Show on the big screen" goes once presenting: focus its timer's controls.
    focusNext.current = "controls";
    startPresenting();
  };

  // ---------------------------------------------------------------------------
  // The meeting cost ticker
  // ---------------------------------------------------------------------------

  const startCost = (v: CostValues) => {
    const t = Date.now();
    const before = useCostTicker.getState().clock;
    useCostTicker.setState({ ...v, clock: startCostClock(before, t) });
    if (!before || before.since === null)
      log(FACILITATOR_TIMERS_ACTIONS.TIMER_STARTED, { timer: "cost" });
    setNow(t);
  };
  const pauseCost = () => {
    const { clock } = useCostTicker.getState();
    if (!clock) return;
    useCostTicker.setState({ clock: pauseCostClock(clock, Date.now()) });
    log(FACILITATOR_TIMERS_ACTIONS.TIMER_PAUSED, { timer: "cost" });
  };
  const resumeCost = () => {
    const { clock } = useCostTicker.getState();
    useCostTicker.setState({ clock: startCostClock(clock, Date.now()) });
    log(FACILITATOR_TIMERS_ACTIONS.TIMER_STARTED, { timer: "cost", resumed: true });
    setNow(Date.now());
  };
  // Undo puts back the clock this render showed.
  const shownClock: CostClock | null = cost.clock;
  const resetCost = () => useCostTicker.setState({ clock: null });
  const undoResetCost = () => useCostTicker.setState({ clock: shownClock });

  // ---------------------------------------------------------------------------
  // The agenda draft, for the Ceremony Timer
  // ---------------------------------------------------------------------------

  const agenda = settings.agenda;
  const named = useMemo(() => normalizeNamedAgendas(ctNamed), [ctNamed]);
  const takenNames = useMemo(
    () => [...AGENDA_IDS.map(agendaLabel), ...named.map((a) => a.name)],
    [named]
  );

  /** Add suggested segments, as many as the draft has room for, with Undo; how many were added. */
  const acceptSegments = (items: AgendaSegmentDraft[]): number => {
    const current = normalizeAgendaDraft(useFacilitatorSettings.getState().agenda);
    const fit = items.slice(0, Math.max(0, DRAFT_MAX_SEGMENTS - current.segments.length));
    if (fit.length === 0) return 0;
    const ids = current.segments.map((s) => s.id);
    const added: DraftSegment[] = fit.map((s) => {
      const id = newSegmentId(ids);
      ids.push(id);
      return { id, label: s.label, minutes: s.minutes, hint: s.hint };
    });
    const addedIds = new Set(added.map((s) => s.id));
    undoable({
      label: added.length === 1 ? `Added “${added[0].label}”` : `Added ${added.length} segments`,
      apply: () =>
        setAgenda((a) => ({
          ...a,
          segments: [...a.segments, ...added].slice(0, DRAFT_MAX_SEGMENTS),
        })),
      // Takes out exactly what this added, whatever else changed since.
      revert: () =>
        setAgenda((a) => ({ ...a, segments: a.segments.filter((s) => !addedIds.has(s.id)) })),
    });
    return added.length;
  };
  const removeSegment = (segment: DraftSegment) =>
    removeWithUndo<DraftSegment>({
      label: `Removed “${segment.label}”`,
      update: (fn) => setAgenda((a) => ({ ...a, segments: fn(a.segments) })),
      match: (s) => s.id === segment.id,
    });
  const moveSegment = (id: string, delta: -1 | 1) =>
    setAgenda((a) => {
      const from = a.segments.findIndex((s) => s.id === id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= a.segments.length) return a;
      const segments = a.segments.slice();
      [segments[from], segments[to]] = [segments[to], segments[from]];
      return { ...a, segments };
    });
  const shownSegments = agenda.segments;
  const clearDraft = () => setAgenda((a) => ({ ...a, segments: [] }));
  const undoClearDraft = () =>
    setAgenda((a) => ({
      ...a,
      segments: [...shownSegments, ...a.segments].slice(0, DRAFT_MAX_SEGMENTS),
    }));

  /** Save the draft as one of the Ceremony Timer's agendas, under `name`. */
  const saveToTimer = (name: string) => {
    // The planner's form says so first; the Ceremony Timer edits nothing longer.
    if (agenda.segments.reduce((sum, s) => sum + s.minutes, 0) > MAX_AGENDA_MINUTES) return;
    if (!useTimerSettings.persist.hasHydrated()) void useTimerSettings.persist.rehydrate();
    const id = newSavedAgendaId();
    const copy = namedAgendaFrom(
      id,
      name,
      agenda.segments.map((s) => ({
        id: s.id,
        label: s.label,
        seconds: Math.round(s.minutes * 60),
        speakers: false,
        hint: s.hint,
      }))
    );
    useTimerSettings.setState((s) => ({ named: [...normalizeNamedAgendas(s.named), copy] }));
    setSaved({ id, name: copy.name });
    announce(`Saved “${copy.name}” to the Ceremony Timer.`);
  };

  // ---------------------------------------------------------------------------
  // Example
  // ---------------------------------------------------------------------------

  const untouched = agenda.segments.length === 0 && !agenda.goal;
  const loadExample = () => setAgenda(() => buildExample());
  const clearExample = () =>
    setAgenda((a) => {
      const segments = a.segments.filter((s) => !isExampleId(s.id));
      return segments.length === 0 ? { goal: "", minutes: null, segments } : { ...a, segments };
    });

  // ---------------------------------------------------------------------------
  // Export and prompts
  // ---------------------------------------------------------------------------

  // The docked timer is every step's clock, a break's too: a pause there (or
  // on the pill on another page) pauses the countdown here, and the time to
  // be back moves with it.
  const left = remaining;
  const backAt = run ? breakEndsAt(run, ours, now) : undefined;
  const paused = Boolean(run && !run.finished && dockPaused(ours));
  const costSeconds = cost.clock ? Math.floor(costElapsedMs(cost.clock, now) / 1000) : 0;
  const markdown = useMemo(
    () =>
      toMarkdown({
        settings,
        run: run && backAt !== undefined ? { ...run, backAt } : run,
        remainingSeconds: left,
        paused,
        cost:
          cost.attendees !== null && costSeconds > 0
            ? { attendees: cost.attendees, seconds: costSeconds }
            : null,
        agenda,
      }),
    [settings, run, backAt, left, paused, cost.attendees, costSeconds, agenda]
  );
  const promptConfig = useMemo(
    () => ({
      toolName: "Facilitator Timers",
      prompts: generateFacilitatorTimersPrompts({
        goal: agenda.goal,
        minutes: agenda.minutes,
        segments: agenda.segments,
        pomodoro: settings.pomodoro,
      }),
    }),
    [agenda, settings.pomodoro]
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const timer = run && (
    <TimerPanel
      run={run}
      dock={ours}
      remaining={left}
      backAt={backAt}
      now={now}
      big={presenting}
      controlsRef={controlsRef}
      onPause={pause}
      onResume={resume}
      onNext={next}
      onStop={stop}
      onPresent={present}
    />
  );
  const costCard = (
    <CostCard
      key={ready ? "ready" : "loading"}
      ticker={cost}
      now={now}
      rosterCount={roster.filter((m) => m.name?.trim()).length}
      big={presenting}
      onStart={startCost}
      onPause={pauseCost}
      onResume={resumeCost}
      onReset={resetCost}
      onUndoReset={undoResetCost}
    />
  );
  const soundboard = (
    <SoundboardCard
      whilePresenting={settings.soundboardWhilePresenting}
      onWhilePresenting={(on) => setSettings({ soundboardWhilePresenting: on })}
    />
  );

  // Presenting with something on: only what the room needs to see, large.
  // The rest stays mounted, hidden, so a focus sound keeps playing and the
  // forms keep what was typed.
  const stage = presenting && Boolean(run || cost.clock);
  const offStage = stage ? "hidden" : undefined;

  return (
    <ToolPageWrapper
      toolId="facilitator-timers"
      title="Facilitator Timers"
      description="Pomodoro, break screens, Crazy 8s and a meeting cost ticker."
      category="Ceremonies"
    >
      {!stage && hasExampleItems(agenda.segments) && <ExampleNotice onClear={clearExample} />}
      <ActionRow className={offStage}>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton filename="facilitator-timers" markdown={markdown} />
      </ActionRow>
      <div
        className={stage ? "flex flex-col gap-6" : "grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]"}
      >
        <div className="flex min-w-0 flex-col gap-6">
          {timer ??
            (!stage && (
              <EmptyState
                icon={Hourglass}
                action={untouched ? <LoadExampleButton onLoad={loadExample} /> : undefined}
              >
                {untouched
                  ? "No timer on yet. Start a Pomodoro, a break or Crazy 8s below, or load an example: the agenda of a 90-minute design workshop."
                  : "No timer on yet. Start a Pomodoro, a break or Crazy 8s below."}
              </EmptyState>
            ))}
          {status && (
            <p className="text-sm text-warning" role="status">
              {status}
            </p>
          )}
          <div ref={setupRef} className={offStage}>
            <TimerSetup
              // The forms start from the saved lengths once they have loaded.
              key={ready ? "ready" : "loading"}
              pomodoro={settings.pomodoro}
              crazy8s={settings.crazy8s}
              breakMinutes={settings.breakMinutes}
              chime={settings.chime}
              onChime={(on) => setSettings({ chime: on })}
              blocked={busy}
              onStartPomodoro={startPomodoro}
              onStartCrazy8s={startCrazy8s}
              onStartBreak={startBreak}
            />
          </div>
          <div className={stage && !cost.clock ? "hidden" : undefined}>{costCard}</div>
          <div className={offStage}>
            <AgendaPlanner
              key={ready ? "ready" : "loading"}
              agenda={agenda}
              takenNames={takenNames}
              namedCount={named.length}
              saved={saved}
              onRequest={(goal, minutes) =>
                setAgenda((a) => ({ ...a, goal, minutes: minutes ?? a.minutes }))
              }
              onAccept={acceptSegments}
              onRemove={removeSegment}
              onMove={moveSegment}
              onClear={clearDraft}
              onUndoClear={undoClearDraft}
              onSave={saveToTimer}
            />
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <div className={offStage}>
            <FocusSoundsCard
              sound={settings.focusSound}
              volume={settings.focusVolume}
              onSound={(focusSound) => setSettings({ focusSound })}
              onVolume={(focusVolume) => setSettings({ focusVolume })}
            />
          </div>
          {soundboard}
        </div>
      </div>
    </ToolPageWrapper>
  );
}
