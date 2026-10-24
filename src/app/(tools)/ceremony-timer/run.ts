/**
 * One run of an agenda: which segment is on, whose turn it is, and the time
 * each took. Pure functions over a plain `Run`, so the session store
 * (./store.ts) can keep it across navigation and reloads.
 *
 * All the timing hangs off one "active" clock: milliseconds the meeting has
 * been running, pauses left out. It is anchored to the wall clock (`since`),
 * so tab throttling and laptop sleep don't make it drift (the reason the old
 * timer moved to `endsAt`), and every start, turn and segment is a reading
 * of that one clock. Pausing stops it; nothing else needs adjusting.
 */

import type { DockedTimer } from "@/lib/timer/dock-timer";
import type { Agenda, AgendaId, Segment } from "./agenda";
import { speakerPlan, type Participant, type SpeakerPlan, type Turn } from "./speakers";

export interface SegmentRun {
  /** Active-clock ms when the segment began. */
  startMs: number;
  /** Active-clock ms when it ended; absent while it is on. */
  endMs?: number;
  /** Finished turns, in speaking order. */
  turns: Turn[];
  /** Active-clock ms when the current speaker's turn began. */
  turnStartMs: number;
}

export interface Run {
  agendaId: AgendaId;
  /** The segment that is on (the last one once finished). */
  index: number;
  /** One record per segment reached, in agenda order. */
  segments: SegmentRun[];
  /** Active ms counted up to `since`. */
  baseMs: number;
  /** Epoch ms when the clock last started; null while paused. */
  since: number | null;
  finished: boolean;
}

/** The active clock at `now`, in ms. */
export function activeMs(run: Run, now: number): number {
  return run.baseMs + (run.since === null ? 0 : Math.max(0, now - run.since));
}

/** A run of `agendaId` at its first segment, running from `now` or paused at zero. */
export function startRun(agendaId: AgendaId, now: number, running = true): Run {
  return {
    agendaId,
    index: 0,
    segments: [{ startMs: 0, turns: [], turnStartMs: 0 }],
    baseMs: 0,
    since: running ? now : null,
    finished: false,
  };
}

export function resumeRun(run: Run, now: number): Run {
  if (run.finished || run.since !== null) return run;
  return { ...run, since: now };
}

export function pauseRun(run: Run, now: number): Run {
  if (run.since === null) return run;
  return { ...run, baseMs: activeMs(run, now), since: null };
}

function current(run: Run): SegmentRun {
  return run.segments[run.index] ?? { startMs: 0, turns: [], turnStartMs: 0 };
}

function withCurrent(run: Run, patch: Partial<SegmentRun>): Run {
  const segments = run.segments.slice();
  segments[run.index] = { ...current(run), ...patch };
  return { ...run, segments };
}

/**
 * The current speaker's turn ends (Next speaker) or is passed over (Skip
 * speaker): it is recorded with the time it took and the share it had, and
 * the next speaker's turn begins on the same clock reading.
 */
export function endTurn(
  run: Run,
  speaker: Participant,
  shareSeconds: number,
  skipped: boolean,
  now: number
): Run {
  if (run.finished) return run;
  const seg = current(run);
  const at = activeMs(run, now);
  const turn: Turn = {
    speakerId: speaker.id,
    name: speaker.name,
    spentMs: Math.max(0, at - seg.turnStartMs),
    shareSeconds,
    skipped,
  };
  return withCurrent(run, { turns: [...seg.turns, turn], turnStartMs: at });
}

/**
 * The current segment ends and the next begins; after the last one the run
 * is finished and its clock stops. A speaker cut off mid-turn (they had
 * spoken for a second or more) keeps that turn in the record.
 */
export function advanceSegment(
  run: Run,
  segmentCount: number,
  now: number,
  openTurn?: { speaker: Participant; shareSeconds: number }
): Run {
  if (run.finished) return run;
  const at = activeMs(run, now);
  let next = run;
  if (openTurn && at - current(run).turnStartMs >= 1000) {
    next = endTurn(run, openTurn.speaker, openTurn.shareSeconds, false, now);
  }
  next = withCurrent(next, { endMs: at });
  if (run.index + 1 < segmentCount) {
    return {
      ...next,
      index: run.index + 1,
      segments: [...next.segments, { startMs: at, turns: [], turnStartMs: at }],
    };
  }
  return { ...next, baseMs: at, since: null, finished: true };
}

/**
 * The turn clock starts again from now: turn-taking switched on part-way
 * through a segment, the speaker who was up left, or someone joined while
 * nobody was up. The time before still counts against the segment (runView
 * reads it from `turnStartMs`), so the shares cover only what is left.
 */
export function restartTurns(run: Run, now: number): Run {
  if (run.finished) return run;
  return withCurrent(run, { turnStartMs: activeMs(run, now) });
}

/* -------------------------------------------------------------------------- */
/*  What the timer shows                                                       */
/* -------------------------------------------------------------------------- */

export type SegmentState = "done" | "current" | "next";

export interface SegmentLine {
  segment: Segment;
  index: number;
  state: SegmentState;
  /** Seconds spent (done), so far (current) or 0 (not reached). */
  spentSeconds: number;
}

export interface RunView {
  started: boolean;
  running: boolean;
  finished: boolean;
  /** The segment that is on (the first before the start). */
  index: number;
  segment: Segment;
  /** Seconds spent in it so far. */
  segmentSpent: number;
  /** Seconds left in it; negative once it runs over. */
  segmentLeft: number;
  totalPlanned: number;
  totalSpent: number;
  /** Seconds left of the whole agenda; negative once it runs over. */
  totalLeft: number;
  /**
   * How far the meeting is behind (positive) or ahead of (negative) the
   * agenda: the time spent against what the agenda had planned up to here.
   */
  drift: number;
  lines: SegmentLine[];
  /** Turn-taking in the current segment, when it has speakers to take turns. */
  speakers: SpeakerPlan | null;
}

const secondsOf = (ms: number) => Math.max(0, Math.floor(ms / 1000));

/**
 * Everything the timer face, the agenda list and the speaker queue show,
 * from the run (or none yet) at `now`.
 */
export function runView(
  run: Run | null,
  agenda: Agenda,
  order: readonly Participant[],
  now: number
): RunView {
  const segs = agenda.segments;
  const index = Math.min(run?.index ?? 0, Math.max(0, segs.length - 1));
  const at = run ? activeMs(run, now) : 0;
  const lines: SegmentLine[] = segs.map((segment, i) => {
    const rec = run?.segments[i];
    const state: SegmentState =
      run && (i < index || (i === index && run.finished))
        ? "done"
        : i === index && run
          ? "current"
          : "next";
    const spentMs = !rec ? 0 : (rec.endMs ?? at) - rec.startMs;
    return { segment, index: i, state, spentSeconds: secondsOf(spentMs) };
  });

  const segment = segs[index];
  const rec = run?.segments[index];
  const segmentSpent = lines[index]?.spentSeconds ?? 0;
  const totalPlanned = segs.reduce((s, x) => s + x.seconds, 0);
  const totalSpent = secondsOf(at);
  const plannedSoFar =
    segs.slice(0, index).reduce((s, x) => s + x.seconds, 0) +
    Math.min(segmentSpent, segment?.seconds ?? 0);
  const drift = run ? totalSpent - plannedSoFar : 0;

  let speakers: SpeakerPlan | null = null;
  if (segment?.speakers && order.length > 0) {
    const turnSpent = rec && !run?.finished ? secondsOf(at - rec.turnStartMs) : 0;
    // Everything in the segment before this turn is gone, not only the
    // finished turns: minutes before turn-taking began, or the unfinished
    // turn of a speaker who left.
    const used = rec ? Math.max(0, rec.turnStartMs - rec.startMs) / 1000 : 0;
    speakers = speakerPlan(segment.seconds, order, rec?.turns ?? [], turnSpent, used);
  }

  return {
    started: run !== null,
    running: Boolean(run && run.since !== null && !run.finished),
    finished: Boolean(run?.finished),
    index,
    segment,
    segmentSpent,
    segmentLeft: (segment?.seconds ?? 0) - segmentSpent,
    totalPlanned,
    totalSpent,
    totalLeft: totalPlanned - totalSpent,
    drift,
    lines,
    speakers,
  };
}

/* -------------------------------------------------------------------------- */
/*  The end summary                                                            */
/* -------------------------------------------------------------------------- */

export interface TurnReport {
  name: string;
  plannedSeconds: number;
  actualSeconds: number;
  skipped: boolean;
}

export interface SegmentReport {
  label: string;
  plannedSeconds: number;
  /** null for a segment the run never reached. */
  actualSeconds: number | null;
  /** The segment still on: its actual time is "so far". */
  current: boolean;
  turns: TurnReport[];
}

export interface RunReport {
  label: string;
  short: string;
  finished: boolean;
  plannedSeconds: number;
  actualSeconds: number;
  segments: SegmentReport[];
}

/** Planned against actual, per segment and per turn, for the summary and the export. */
export function runReport(run: Run, agenda: Agenda, now: number): RunReport {
  const view = runView(run, agenda, [], now);
  return {
    label: agenda.label,
    short: agenda.short,
    finished: run.finished,
    plannedSeconds: view.totalPlanned,
    actualSeconds: view.totalSpent,
    segments: view.lines.map((line) => ({
      label: line.segment.label,
      plannedSeconds: line.segment.seconds,
      actualSeconds: run.segments[line.index] ? line.spentSeconds : null,
      current: !run.finished && line.index === run.index,
      turns: (run.segments[line.index]?.turns ?? []).map((t) => ({
        name: t.name,
        plannedSeconds: t.shareSeconds,
        actualSeconds: Math.round(t.spentMs / 1000),
        skipped: t.skipped,
      })),
    })),
  };
}

/* -------------------------------------------------------------------------- */
/*  The docked timer                                                           */
/* -------------------------------------------------------------------------- */

/**
 * What the shell's docked timer shows while the facilitator is on another
 * page: the current segment counting down. Null once there is nothing to
 * show (no run, or it finished).
 */
export function dockFor(
  run: Run | null,
  agenda: Agenda,
  href: string,
  now: number
): DockedTimer | null {
  if (!run || run.finished) return null;
  const view = runView(run, agenda, [], now);
  if (!view.segment) return null;
  const left = Math.max(
    0,
    view.segment.seconds * 1000 - (activeMs(run, now) - (run.segments[view.index]?.startMs ?? 0))
  );
  const label =
    agenda.segments.length > 1 ? `${agenda.short} · ${view.segment.label}` : agenda.short;
  return {
    label,
    href,
    totalSeconds: view.segment.seconds,
    endsAt: view.running ? now + left : null,
    pausedRemaining: Math.ceil(left / 1000),
  };
}

/**
 * The run brought in line with the docked timer after the facilitator comes
 * back from another page, where they may have paused, resumed or stopped
 * it. The dock only knows the current segment's countdown, so that is what
 * is read back:
 *
 * - running: the clock is set so the segment ends when the dock's does
 *   (any pause taken in the dock drops out);
 * - paused with time left: the run pauses where the dock did;
 * - paused at zero: that is the dock stopping itself at "Time's up", which
 *   it does while the meeting carries on into overtime, so the run is kept;
 * - gone (Stop in the dock): a running run pauses now and keeps its record.
 *
 * The segment's length is the one the dock counted down (`totalSeconds`),
 * not the agenda as the page resolves it: on a full page load the first
 * render sees the default cadence rather than the team's, and a one-week
 * team's retro would have its clock moved by the two-week lengths.
 *
 * Differences under a second are rounding, not a change, and are ignored.
 * The dock only shows how it is now, so a pause taken in it and later
 * resumed or stopped leaves no trace here; followDock applies those as they
 * happen while the page is closed.
 */
export function reconcileWithDock(run: Run, dock: DockedTimer | null, now: number): Run {
  if (run.finished) return run;
  if (!dock) return pauseRun(run, now);
  const startMs = run.segments[run.index]?.startMs ?? 0;

  const planned = Math.max(0, dock.totalSeconds) * 1000;
  const close = (a: number, b: number) => Math.abs(a - b) < 1000;
  if (dock.endsAt !== null) {
    const target = startMs + planned - (dock.endsAt - now);
    if (run.since !== null && close(activeMs(run, now), target)) return run;
    return { ...run, baseMs: Math.max(0, target), since: now };
  }
  if (dock.pausedRemaining > 0) {
    const target = startMs + planned - dock.pausedRemaining * 1000;
    if (run.since === null && close(run.baseMs, target)) return run;
    return { ...run, baseMs: Math.max(0, target), since: null };
  }
  return run;
}

/**
 * The run after one change to the docked timer made while the page is
 * closed, applied as it happens: a pause there pauses the meeting, a resume
 * resumes it, and Stop pauses it where it was. The dock stopping itself at
 * "Time's up" changes nothing, since the meeting carries on into overtime.
 * Without this, a coffee break taken in the dock counted as meeting time
 * whenever the dock had been resumed or closed by the time the facilitator
 * came back.
 */
export function followDock(
  run: Run,
  before: DockedTimer,
  after: DockedTimer | null,
  now: number
): Run {
  if (run.finished) return run;
  if (!after) return pauseRun(run, now);
  const wasRunning = before.endsAt !== null;
  const isRunning = after.endsAt !== null;
  if (wasRunning && !isRunning && after.pausedRemaining > 0) return pauseRun(run, now);
  if (!wasRunning && isRunning) return resumeRun(run, now);
  return run;
}

/**
 * A docked timer left by the timer before agendas (a single countdown), as
 * a run of the Custom time-box with that length, so a meeting in progress
 * during the update carries on where it was.
 */
export function runFromLegacyDock(dock: DockedTimer, now: number): Run {
  const total = Math.max(0, dock.totalSeconds) * 1000;
  const left =
    dock.endsAt !== null
      ? Math.max(0, dock.endsAt - now)
      : Math.max(0, dock.pausedRemaining) * 1000;
  const run = startRun("custom", now, dock.endsAt !== null && left > 0);
  return { ...run, baseMs: Math.max(0, total - left) };
}
