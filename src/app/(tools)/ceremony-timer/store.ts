"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createPersistedStore } from "@/lib/stores/create-persisted-store";
import { nameKey } from "@/lib/team/use-team-roster";
import { useDockTimer } from "@/lib/timer/dock-timer";
import {
  isAgendaId,
  isAgendaKey,
  type AgendaKey,
  type AgendaLayouts,
  type NamedAgenda,
  type SavedAgendas,
} from "./agenda";
import { DEFAULT_SHARE_RUNS, isShareRuns, type KeptRun, type ShareRuns } from "./history";
import { followDock, type Run, type SegmentRun } from "./run";
import type { Participant, Turn } from "./speakers";

export { normalizeLayouts, normalizeNamedAgendas } from "./agenda";
export { normalizeHistory } from "./history";

/**
 * The Ceremony Timer's two stores.
 *
 * - Settings (`agile-toolkit:ceremony-timer`, synced like other tool
 *   stores): the team's edits to each agenda (and the order of its
 *   segments), the agendas saved by name, the speaking order, the opt-in
 *   chime, and the finished meetings kept for speaking time across runs.
 *   The timer kept nothing between visits before agendas, so there is no
 *   older shape to read; every field is normalised on the way out because
 *   a synced or hand-edited value can hold anything.
 * - Session (sessionStorage, per tab like the docked timer): the agenda on
 *   screen and the run in progress, so leaving the page or reloading keeps
 *   the meeting where it was, and a new tab starts fresh.
 *
 * Both skip hydration at load and are rehydrated by the page on mount, so
 * the server render and the first client render agree.
 */

export interface TimerSettings {
  /** Per agenda, the team's segments; absent means the defaults. */
  agendas: SavedAgendas;
  /** Per built-in agenda, its segments' order once the team changed which it has. */
  layouts: AgendaLayouts;
  /** Agendas saved under a name, in the order they were saved. */
  named: NamedAgenda[];
  /** The speaking order for rounds of turns. */
  speakers: Participant[];
  /** Chime (and vibrate) when time is up. Off unless the team turns it on. */
  chime: boolean;
  /** Finished meetings, oldest first, for speaking time across runs. */
  history: KeptRun[];
  /** How many recent meetings with turns the speaking-time view averages. */
  shareRuns: ShareRuns;
  /** Name people in the export's speaking-time section. Off unless the facilitator turns it on. */
  exportNames: boolean;
}

export const SETTINGS_INITIAL: TimerSettings = {
  agendas: {},
  layouts: {},
  named: [],
  speakers: [],
  chime: false,
  history: [],
  shareRuns: DEFAULT_SHARE_RUNS,
  exportNames: false,
};

/** The stored choice of how many meetings to average, or the default. */
export function normalizeShareRuns(raw: unknown): ShareRuns {
  return isShareRuns(raw) ? raw : DEFAULT_SHARE_RUNS;
}

export const useTimerSettings = createPersistedStore<TimerSettings>(
  "ceremony-timer",
  SETTINGS_INITIAL
);

/**
 * The speaking order made safe to use: rows with an id and a name, each id
 * and each name (any case) once, names trimmed.
 */
export function normalizeSpeakers(raw: unknown): Participant[] {
  if (!Array.isArray(raw)) return [];
  const ids = new Set<string>();
  const names = new Set<string>();
  const out: Participant[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const { id, name } = row as Record<string, unknown>;
    if (typeof id !== "string" || !id || typeof name !== "string") continue;
    const key = nameKey(name);
    if (!key || ids.has(id) || names.has(key)) continue;
    ids.add(id);
    names.add(key);
    out.push({ id, name: name.trim() });
  }
  return out;
}

/** The saved agenda edits, keeping only agendas the timer knows. */
export function normalizeAgendas(raw: unknown): SavedAgendas {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: SavedAgendas = {};
  for (const [id, rows] of Object.entries(raw as Record<string, unknown>)) {
    if (isAgendaId(id) && Array.isArray(rows)) out[id] = rows;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/*  Session                                                                    */
/* -------------------------------------------------------------------------- */

export interface TimerSession {
  /** The agenda on screen; null until one is picked. A saved one may since have been deleted. */
  agendaId: AgendaKey | null;
  /** The run of that agenda, once started. */
  run: Run | null;
}

export const SESSION_KEY = "agile-toolkit:ceremony-timer:session";

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function normalizeTurn(raw: unknown): Turn | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  if (typeof t.speakerId !== "string" || !num(t.spentMs)) return null;
  return {
    speakerId: t.speakerId,
    name: typeof t.name === "string" ? t.name : "",
    spentMs: Math.max(0, t.spentMs),
    shareSeconds: num(t.shareSeconds) ? Math.max(0, t.shareSeconds) : 0,
    skipped: t.skipped === true,
  };
}

function normalizeSegmentRun(raw: unknown): SegmentRun | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  if (!num(s.startMs)) return null;
  return {
    startMs: s.startMs,
    ...(num(s.endMs) ? { endMs: s.endMs } : {}),
    turns: (Array.isArray(s.turns) ? s.turns : [])
      .map(normalizeTurn)
      .filter((t): t is Turn => t !== null),
    turnStartMs: num(s.turnStartMs) ? s.turnStartMs : s.startMs,
  };
}

/** A stored run the timer can carry on with, or null. */
export function normalizeRun(raw: unknown): Run | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isAgendaKey(r.agendaId) || !Array.isArray(r.segments) || !num(r.baseMs)) return null;
  const segments = r.segments.map(normalizeSegmentRun);
  if (segments.length === 0 || segments.some((s) => s === null)) return null;
  const index = Number.isInteger(r.index)
    ? Math.min(Math.max(0, r.index as number), segments.length - 1)
    : segments.length - 1;
  return {
    agendaId: r.agendaId,
    index,
    segments: segments as SegmentRun[],
    baseMs: Math.max(0, r.baseMs),
    since: num(r.since) ? r.since : null,
    finished: r.finished === true,
  };
}

export function normalizeSession(raw: unknown): TimerSession {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const agendaId = isAgendaKey(r.agendaId) ? r.agendaId : null;
  const run = normalizeRun(r.run);
  return { agendaId, run: run && run.agendaId === agendaId ? run : null };
}

export const useTimerSession = create<TimerSession>()(
  persist((): TimerSession => ({ agendaId: null, run: null }), {
    name: SESSION_KEY,
    storage: createJSONStorage(() => sessionStorage),
    skipHydration: true,
    merge: (persisted, current) => ({ ...current, ...normalizeSession(persisted) }),
  })
);

let stopFollowing: (() => void) | null = null;

/**
 * While the page is closed, the docked timer is the only control the
 * facilitator has, and the dock only keeps its own countdown: a pause taken
 * there and later resumed, or ended with Stop, leaves nothing for the page
 * to read on return. So each pause, resume or Stop made in the dock (the one
 * whose link is `href`) is applied to the session's run as it happens; see
 * followDock. The page turns this on when it unmounts and off when it
 * mounts, where it reconciles with the dock instead. A full reload on
 * another page drops the subscription; the reconcile still covers what the
 * dock shows on return.
 */
export function followDockWhileAway(on: boolean, href: string): void {
  stopFollowing?.();
  stopFollowing = null;
  if (!on) return;
  stopFollowing = useDockTimer.subscribe((state, prev) => {
    const before = prev.timer?.href === href ? prev.timer : null;
    if (!before || state.timer === prev.timer) return;
    const after = state.timer?.href === href ? state.timer : null;
    const { run } = useTimerSession.getState();
    if (!run) return;
    const next = followDock(run, before, after, Date.now());
    if (next !== run) useTimerSession.setState({ run: next });
  });
}
