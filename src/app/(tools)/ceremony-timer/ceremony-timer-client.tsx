"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Timer } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ActionRow } from "@/components/shared/action-row";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { ResetButton } from "@/components/shared/reset-button";
import {
  ExampleNotice,
  LoadExampleButton,
  hasExampleItems,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { CEREMONY_TIMER_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { useVisibilityTick } from "@/lib/hooks/use-visibility-tick";
import { useToolSonification } from "@/lib/sonification/use-sonification";
import { useCeremonyCadence } from "@/lib/sprints/use-ceremony-cadence";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { findRosterMember, nameKey } from "@/lib/team/use-team-roster";
import { useDockTimer } from "@/lib/timer/dock-timer";
import { toast } from "@/lib/utils/toast";
import { undoable } from "@/lib/utils/undoable";
import {
  agendaSeconds,
  allAgendas,
  durationText,
  readAgendaParam,
  shortClock,
  toSaved,
  type AgendaId,
  type SavedSegment,
  type Segment,
} from "./agenda";
import { AgendaCard } from "./agenda-card";
import { AgendaPicker } from "./agenda-picker";
import { flashTitle, playChime, vibrate } from "./alarm";
import { buildExample } from "./example";
import { toMarkdown } from "./markdown";
import { rosterParticipantsToAdd } from "./roster";
import {
  advanceSegment,
  dockFor,
  endTurn,
  pauseRun,
  reconcileWithDock,
  restartTurns,
  resumeRun,
  runFromLegacyDock,
  runReport,
  runView,
  startRun,
  type Run,
} from "./run";
import { RunSummary } from "./run-summary";
import { useTimerShortcuts, type Shortcut } from "./shortcuts";
import { SpeakersCard } from "./speakers-card";
import { TimerFace } from "./timer-face";
import type { Participant } from "./speakers";
import {
  followDockWhileAway,
  normalizeAgendas,
  normalizeSpeakers,
  useTimerSession,
  useTimerSettings,
  type TimerSession,
} from "./store";
import { planVerdict, runVerdict } from "./verdict";

const DOCK_HREF = "/ceremony-timer";

/** A name short enough for a one-line toast. */
function shortName(name: string, max = 40): string {
  const t = name.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

const setSession = (patch: Partial<TimerSession>) => useTimerSession.setState(patch);
const setRun = (run: Run | null) => useTimerSession.setState({ run });

function setSpeakers(fn: (list: Participant[]) => Participant[]) {
  useTimerSettings.setState((s) => ({ speakers: fn(normalizeSpeakers(s.speakers)) }));
}

/**
 * A step through the meeting (a turn passed or skipped, the next segment,
 * Finish) with Undo: a slip of the key or the mouse can't be walked back
 * otherwise, and a finished run can't be resumed. Undo puts the step back
 * while the run is still where the step left it, keeping a pause or resume
 * made since; after a later step, that step's own Undo comes first.
 */
function stepWithUndo(label: string, before: Run, after: Run) {
  undoable({
    label,
    apply: () => setRun(after),
    revert: () => {
      const now = useTimerSession.getState().run;
      if (now === after) setRun(before);
      else if (now && !after.finished && now.segments === after.segments) {
        setRun({ ...now, index: before.index, segments: before.segments });
      }
    },
  });
}

/** Save the team's rows for one agenda; none (or an empty list) means the defaults. */
function setSaved(id: AgendaId, rows: SavedSegment[] | undefined) {
  useTimerSettings.setState((s) => {
    const agendas = { ...normalizeAgendas(s.agendas) };
    if (rows && rows.length > 0) agendas[id] = rows;
    else delete agendas[id];
    return { agendas };
  });
}

export function CeremonyTimerClient() {
  const { agendaId, run } = useTimerSession(
    useShallow((s) => ({ agendaId: s.agendaId, run: s.run }))
  );
  const settings = useTimerSettings(
    useShallow((s) => ({ agendas: s.agendas, speakers: s.speakers, chime: s.chime }))
  );
  const [cadence] = useCeremonyCadence();
  const sprintLength = cadence.sprintLengthDays;
  const saved = useMemo(() => normalizeAgendas(settings.agendas), [settings.agendas]);
  const speakers = useMemo(() => normalizeSpeakers(settings.speakers), [settings.speakers]);
  const chime = settings.chime === true;
  const agendas = useMemo(() => allAgendas(saved, sprintLength), [saved, sprintLength]);
  const agenda = useMemo(() => agendas.find((a) => a.id === agendaId) ?? null, [agendas, agendaId]);

  const [now, setNow] = useState(() => Date.now());
  const view = useMemo(
    () => (agenda ? runView(run, agenda, speakers, now) : null),
    [run, agenda, speakers, now]
  );

  const sonify = useToolSonification("ceremony-timer");
  const { log } = useHistoryLogger("ceremony-timer");
  const announce = useAnnounce();

  // ---------------------------------------------------------------------------
  // Loading, and the docked timer
  // ---------------------------------------------------------------------------

  // The run in progress on mount was kept in line with the dock (or came
  // from it), so it is not published back: after a Stop in the dock that
  // would bring the closed pill straight back. The next change publishes.
  const quietRunRef = useRef<Run | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!useTimerSettings.persist.hasHydrated()) void useTimerSettings.persist.rehydrate();
    if (!useTimerSession.persist.hasHydrated()) void useTimerSession.persist.rehydrate();
    // Back on the page: it drives the run again, after reading the dock.
    followDockWhileAway(false, DOCK_HREF);
    const t = Date.now();
    const docked = useDockTimer.getState().timer;
    const ours = docked?.href === DOCK_HREF ? docked : null;
    const session = useTimerSession.getState();

    if (session.run && session.agendaId) {
      const next = reconcileWithDock(session.run, ours, t);
      if (next !== session.run) setRun(next);
      quietRunRef.current = next;
    } else if (ours) {
      // A countdown started before agendas: carry on with it as a Custom
      // time-box of the same length.
      const legacy = runFromLegacyDock(ours, t);
      setSaved("custom", [{ id: "timebox", minutes: ours.totalSeconds / 60 }]);
      setSession({ agendaId: "custom", run: legacy });
      quietRunRef.current = legacy;
    } else {
      // `?agenda=retro` from a link opens that agenda, unless a meeting is on.
      const linked = readAgendaParam(window.location.search);
      if (linked) setSession({ agendaId: linked, run: null });
    }
    setNow(t);
    setReady(true);
    // Leaving the page: what is done in the dock from here on is applied to
    // the run as it happens.
    return () => followDockWhileAway(true, DOCK_HREF);
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (run && run === quietRunRef.current) return;
    quietRunRef.current = null;
    const dock = useDockTimer.getState();
    const next = agenda ? dockFor(run, agenda, DOCK_HREF, Date.now()) : null;
    if (next) dock.publish(next);
    else if (dock.timer?.href === DOCK_HREF) dock.publish(null);
  }, [ready, run, agenda]);

  useVisibilityTick(Boolean(view?.running), 1000, () => setNow(Date.now()));

  // Time's up, the last ten seconds and the minute marks, each once, on the
  // tick that crosses it (a tab that slept through it catches up on return).
  const lastTickRef = useRef<{
    key: string;
    left: number;
    turnId: string | null;
    turnLeft: number;
  } | null>(null);
  useEffect(() => {
    if (!agenda || !view || !run || view.finished) {
      lastTickRef.current = null;
      return;
    }
    const key = `${run.agendaId}:${view.index}`;
    const cur = view.speakers?.current ?? null;
    const turnLeft = cur ? cur.shareSeconds - cur.spentSeconds : 0;
    const left = view.segmentLeft;
    const prev = lastTickRef.current;
    lastTickRef.current = { key, left, turnId: cur?.id ?? null, turnLeft };
    if (!prev || prev.key !== key || !view.running) return;

    if (prev.left > 0 && left <= 0) {
      const what = agenda.segments.length > 1 ? view.segment.label : agenda.short;
      sonify("finish");
      announce(`${what}: time's up`, "assertive");
      flashTitle("Time's up");
      if (chime) {
        playChime(3);
        vibrate();
      }
    } else if (prev.left > 10 && left <= 10) {
      sonify("ten-seconds");
    } else if (left > 0 && left !== prev.left && left % 60 === 0) {
      sonify("minute-mark");
    }
    if (cur && prev.turnId === cur.id && prev.turnLeft > 0 && turnLeft <= 0 && left > 0) {
      announce(`${cur.name}'s time is up`);
      if (chime) playChime(1);
    }
  }, [agenda, view, run, chime, sonify, announce]);

  // ---------------------------------------------------------------------------
  // Running the meeting
  // ---------------------------------------------------------------------------

  const canStart = Boolean(agenda && agendaSeconds(agenda) > 0);

  /**
   * Start, pause or resume. From the Space key it also says so: focus isn't
   * on the button then, so its changed name isn't read out.
   */
  const toggle = (fromKey: boolean): boolean => {
    const current = useTimerSession.getState().run;
    if (!agenda || !view || !canStart || current?.finished) return false;
    const t = Date.now();
    const pausing = Boolean(current && current.since !== null);
    if (!current) {
      setRun(startRun(agenda.id, t));
      sonify("start");
      log(CEREMONY_TIMER_ACTIONS.TIMER_STARTED, {
        agenda: agenda.id,
        remainingSeconds: view.segmentLeft,
      });
    } else if (!pausing) {
      setRun(resumeRun(current, t));
      sonify("start");
      log(CEREMONY_TIMER_ACTIONS.TIMER_STARTED, {
        agenda: agenda.id,
        remainingSeconds: view.segmentLeft,
      });
    } else {
      setRun(pauseRun(current, t));
      log(CEREMONY_TIMER_ACTIONS.TIMER_PAUSED, {
        agenda: agenda.id,
        remainingSeconds: view.segmentLeft,
      });
    }
    if (fromKey) {
      const what = agenda.segments.length > 1 ? view.segment.label : agenda.short;
      const left = view.segmentLeft;
      const clock = left >= 0 ? `${shortClock(left)} left` : `${shortClock(-left)} over`;
      announce(`Timer ${pausing ? "paused" : "started"}. ${what}: ${clock}.`);
    }
    setNow(t);
    return true;
  };

  /** Next speaker, or Skip speaker: the turn is recorded (with Undo) and the next one begins. */
  const passTurn = (skipped: boolean): boolean => {
    const current = useTimerSession.getState().run;
    const speaker = view?.speakers?.current;
    if (!agenda || !current || current.finished || !speaker) return false;
    const t = Date.now();
    const next = endTurn(current, speaker, speaker.shareSeconds, skipped, t);
    const who = shortName(speaker.name);
    stepWithUndo(skipped ? `Skipped ${who}` : `${who}'s turn ended`, current, next);
    setNow(t);
    sonify("rotate");
    const up = runView(next, agenda, speakers, t).speakers?.current;
    const then = up ? `Next: ${up.name}, ${shortClock(up.shareSeconds)}.` : "Everyone has spoken.";
    announce(skipped ? `Skipped ${speaker.name}. ${then}` : then);
    return true;
  };

  const nextSegment = (): boolean => {
    const current = useTimerSession.getState().run;
    if (!agenda || !current || current.finished) return false;
    const t = Date.now();
    const speaker = view?.speakers?.current;
    const next = advanceSegment(
      current,
      agenda.segments.length,
      t,
      speaker ? { speaker, shareSeconds: speaker.shareSeconds } : undefined
    );
    const seg = agenda.segments[next.index];
    stepWithUndo(
      next.finished ? `Finished the ${agenda.label}` : `Moved on to ${seg.label}`,
      current,
      next
    );
    setNow(t);
    if (next.finished) {
      // Once per run, when the ceremony ends (each segment's time-up is
      // `finish`): this is what pays ceremony-finished XP.
      sonify("complete");
      announce(runVerdict(runReport(next, agenda, t)));
    } else {
      sonify("rotate");
      announce(
        `Segment ${next.index + 1} of ${agenda.segments.length}: ${seg.label}, ${durationText(seg.seconds)}.`
      );
    }
    return true;
  };

  useTimerShortcuts((shortcut: Shortcut) => {
    if (shortcut === "toggle") return toggle(true);
    if (shortcut === "next-speaker") return passTurn(false);
    if (shortcut === "skip-speaker") return passTurn(true);
    return nextSegment();
  });

  // Undo brings back the meeting together with the agenda it belongs to, as
  // this render shows them. A ref shared across confirmations would hand an
  // older toast's Undo a later run, under whichever agenda is on screen.
  const shownSession: TimerSession = { agendaId, run };
  const restart = agenda && (
    <ResetButton
      label="Start over"
      title={`Start the ${agenda.label} over?`}
      description="The time spent so far is cleared and the timer goes back to the first segment, ready to start."
      confirmLabel="Start over"
      doneLabel="Cleared the timer"
      onReset={() => {
        setRun(null);
        log(CEREMONY_TIMER_ACTIONS.TIMER_RESET, { agenda: agenda.id });
      }}
      onUndo={() => setSession(shownSession)}
    />
  );

  // ---------------------------------------------------------------------------
  // The agenda
  // ---------------------------------------------------------------------------

  /** Pick an agenda. Leaving a meeting in progress clears its run, with Undo. */
  const pickAgenda = (id: AgendaId) => {
    const before = useTimerSession.getState();
    if (before.agendaId === id) return;
    const picked = agendas.find((a) => a.id === id);
    if (before.run) {
      const snapshot = { agendaId: before.agendaId, run: before.run };
      undoable({
        label: `Switched to ${picked?.label ?? "another agenda"}`,
        description: "The meeting in progress was cleared.",
        apply: () => setSession({ agendaId: id, run: null }),
        revert: () => setSession(snapshot),
      });
    } else {
      setSession({ agendaId: id, run: null });
    }
    log(CEREMONY_TIMER_ACTIONS.PRESET_CHANGED, {
      agenda: id,
      minutes: picked ? agendaSeconds(picked) / 60 : 0,
    });
  };

  const saveAgenda = (segments: Segment[]) => {
    if (!agenda) return;
    setSaved(agenda.id, toSaved(agenda.id, segments, sprintLength));
  };

  // Undo puts back the rows this agenda had in the render that confirmed the
  // reset, so resetting two agendas in a row undoes each one's own edits.
  const shownRows: SavedSegment[] | undefined = agenda ? saved[agenda.id] : undefined;
  const resetDefaults = () => {
    if (agenda) setSaved(agenda.id, undefined);
  };
  const restoreDefaults = () => {
    if (agenda) setSaved(agenda.id, shownRows);
  };

  /** Turn-taking for the segment that's on: an edit to the agenda like any other. */
  const setTurns = (on: boolean) => {
    if (!agenda || !view) return;
    const segments = agenda.segments.map((s, i) => (i === view.index ? { ...s, speakers: on } : s));
    setSaved(agenda.id, toSaved(agenda.id, segments, sprintLength));
    const current = useTimerSession.getState().run;
    if (on && current) setRun(restartTurns(current, Date.now()));
  };

  // ---------------------------------------------------------------------------
  // Speakers
  // ---------------------------------------------------------------------------

  const addSpeaker = (name: string) => {
    // Someone joining a round while nobody is up (nobody in it yet, or
    // everyone has spoken) starts their turn now, not from the start of the
    // segment or the end of the last turn.
    const current = useTimerSession.getState().run;
    if (current && !current.finished && view?.segment.speakers && !view.speakers?.current) {
      setRun(restartTurns(current, Date.now()));
    }
    // Someone on the team keeps their roster id, as "Load team" does.
    const member = findRosterMember(useWorkspaceStore.getState().teamMembers ?? [], name);
    setSpeakers((list) => {
      const id = member && !list.some((p) => p.id === member.id) ? member.id : crypto.randomUUID();
      return [...list, { id, name }];
    });
  };

  /** A speaker who leaves mid-turn hands the clock to the next one from now. */
  const handOver = (leaving: (p: Participant) => boolean) => {
    const current = useTimerSession.getState().run;
    const speaker = view?.speakers?.current;
    if (current && !current.finished && speaker && leaving(speaker)) {
      setRun(restartTurns(current, Date.now()));
    }
  };

  const removeSpeaker = (speaker: Participant) => {
    const index = speakers.findIndex((p) => p.id === speaker.id);
    if (index < 0) return;
    undoable({
      label: `Removed “${shortName(speaker.name)}”`,
      apply: () => {
        handOver((p) => p.id === speaker.id);
        setSpeakers((list) => list.filter((p) => p.id !== speaker.id));
      },
      // Back in their place, unless they were added again meanwhile.
      revert: () =>
        setSpeakers((list) => {
          if (list.some((p) => p.id === speaker.id || nameKey(p.name) === nameKey(speaker.name))) {
            return list;
          }
          const next = [...list];
          next.splice(Math.min(index, next.length), 0, speaker);
          return next;
        }),
    });
  };

  // Everyone on the Team page who isn't in the order yet, at the end with
  // their roster id. Only adds, so it needs no Undo: each person can be
  // removed (with Undo) like any other speaker.
  const loadTeam = () => {
    const additions = rosterParticipantsToAdd(
      speakers,
      useWorkspaceStore.getState().teamMembers ?? []
    );
    if (additions.length === 0) {
      toast("Everyone on the team is already in the list.");
      return;
    }
    setSpeakers((list) => [...list, ...additions]);
  };

  // ---------------------------------------------------------------------------
  // Example
  // ---------------------------------------------------------------------------

  // Offered only on an untouched timer: no agenda picked and nobody added.
  const untouched = !agenda && speakers.length === 0;
  const loadExample = () => {
    const example = buildExample();
    setSession({ agendaId: example.agendaId, run: null });
    setSpeakers((list) => [...list, ...example.participants]);
  };

  // Removes the example speakers. With none of the team's own left and no
  // meeting started, it also goes back to the blank timer the example was
  // loaded into, where "Load an example" is offered again.
  const clearExample = () => {
    handOver((p) => isExampleId(p.id));
    const kept = speakers.filter((p) => !isExampleId(p.id));
    setSpeakers(() => kept);
    if (kept.length === 0 && !useTimerSession.getState().run) {
      setSession({ agendaId: null, run: null });
    }
  };

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------

  const report = useMemo(
    () => (run && agenda ? runReport(run, agenda, now) : null),
    [run, agenda, now]
  );
  const markdown = useMemo(
    () => toMarkdown({ agenda, speakers, report }),
    [agenda, speakers, report]
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const multi = (agenda?.segments.length ?? 0) > 1;
  // Where focus goes once Finish has switched itself off.
  const summaryRef = useRef<HTMLParagraphElement>(null);

  return (
    <ToolPageWrapper
      toolId="ceremony-timer"
      title="Ceremony Timer"
      description="Run a ceremony to its agenda: a time-box for each segment, fair turns for every speaker, and planned against actual at the end."
      category="Ceremonies"
    >
      {hasExampleItems(speakers) && <ExampleNotice onClear={clearExample} />}
      <ActionRow>
        <ExportButton filename="ceremony-agenda" markdown={markdown} />
      </ActionRow>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          {agenda && view ? (
            <>
              <TimerFace
                agenda={agenda}
                view={view}
                canStart={canStart}
                onToggle={() => toggle(false)}
                onNextSpeaker={() => passTurn(false)}
                onSkipSpeaker={() => passTurn(true)}
                onNextSegment={() => nextSegment()}
                restart={restart}
                summaryRef={summaryRef}
                chime={chime}
                onChime={(on) => useTimerSettings.setState({ chime: on })}
              />
              {!view.started && (
                <p className="text-sm font-medium text-text">
                  {planVerdict(agenda, speakers.length)}
                </p>
              )}
              {view.finished && report && <RunSummary report={report} verdictRef={summaryRef} />}
              <AgendaCard
                agenda={agenda}
                view={view}
                onSave={saveAgenda}
                onResetDefaults={resetDefaults}
                onRestore={restoreDefaults}
              />
            </>
          ) : (
            <EmptyState
              icon={Timer}
              action={untouched ? <LoadExampleButton onLoad={loadExample} /> : undefined}
            >
              {untouched
                ? "Pick an agenda to run a ceremony to time, or load an example: a Daily Scrum for five speakers."
                : "Pick an agenda to run a ceremony to time."}
            </EmptyState>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <AgendaPicker agendas={agendas} selected={agendaId} onPick={pickAgenda} />
          <SpeakersCard
            speakers={speakers}
            plan={view && !view.finished ? view.speakers : null}
            started={Boolean(view?.started)}
            turns={
              agenda && view && !view.finished
                ? {
                    label: multi
                      ? `Speakers take turns in ${view.segment.label}`
                      : "Speakers take turns",
                    checked: view.segment.speakers,
                    onChange: setTurns,
                  }
                : null
            }
            locked={Boolean(view?.running)}
            onAdd={addSpeaker}
            onRemove={removeSpeaker}
            onLoadTeam={loadTeam}
          />
        </div>
      </div>
    </ToolPageWrapper>
  );
}
