/**
 * Facilitator Timers' settings as they are stored and synced
 * ("agile-toolkit:facilitator-timers"): the timers' lengths, the opt-in
 * chime, the focus sound's choice and volume, whether the soundboard shows
 * while presenting, and the agenda being drafted for the Ceremony Timer.
 *
 * Pure: no store, no browser globals. The browser store (./store.ts)
 * persists them; Amr's list_state reads the synced row through
 * `normalizeSettings` on the MCP server too, where the store and the
 * docked timer (a "use client" module) must not load.
 */

import {
  DEFAULT_BREAK_MINUTES,
  DEFAULT_CRAZY_8S,
  DEFAULT_POMODORO,
  normalizeBreakMinutes,
  normalizeCrazy8s,
  normalizePomodoro,
  type Crazy8sSettings,
  type PomodoroSettings,
} from "./model";
import { isFocusSound, type FocusSound } from "./sounds";

/** One segment of the agenda being drafted, in minutes. */
export interface DraftSegment {
  id: string;
  label: string;
  minutes: number;
  hint: string;
}

export interface AgendaDraftState {
  /** What the meeting is for. */
  goal: string;
  /** How long it runs, in minutes; null until set. */
  minutes: number | null;
  segments: DraftSegment[];
}

export interface FacilitatorSettings {
  pomodoro: PomodoroSettings;
  /** The break screen's length when it is set in minutes. */
  breakMinutes: number;
  crazy8s: Crazy8sSettings;
  /** Chime (and vibrate) when a step's time is up. Off unless turned on. */
  chime: boolean;
  focusSound: FocusSound;
  /** 0–1. */
  focusVolume: number;
  /** Show the soundboard as a small dock while presenting, on any tool. */
  soundboardWhilePresenting: boolean;
  agenda: AgendaDraftState;
}

export const SETTINGS_KEY = "agile-toolkit:facilitator-timers";

export const AGENDA_GOAL_MAX = 280;
export const DRAFT_LABEL_MAX = 60;
export const DRAFT_HINT_MAX = 200;
export const DRAFT_MAX_SEGMENTS = 12;

export const FT_SETTINGS_INITIAL: FacilitatorSettings = {
  pomodoro: DEFAULT_POMODORO,
  breakMinutes: DEFAULT_BREAK_MINUTES,
  crazy8s: DEFAULT_CRAZY_8S,
  chime: false,
  focusSound: "rain",
  focusVolume: 0.5,
  soundboardWhilePresenting: false,
  agenda: { goal: "", minutes: null, segments: [] },
};

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** The draft's segments made safe to use: an id, a name and a length each; ids once. */
export function normalizeDraftSegments(raw: unknown): DraftSegment[] {
  if (!Array.isArray(raw)) return [];
  const ids = new Set<string>();
  const out: DraftSegment[] = [];
  for (const row of raw) {
    if (out.length >= DRAFT_MAX_SEGMENTS) break;
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (typeof r.id !== "string" || !/^[a-z0-9-]{1,60}$/.test(r.id) || ids.has(r.id)) continue;
    const label = text(r.label, DRAFT_LABEL_MAX);
    const minutes = typeof r.minutes === "number" && Number.isFinite(r.minutes) ? r.minutes : 0;
    if (!label || minutes < 0.5 || minutes > 480) continue;
    ids.add(r.id);
    out.push({
      id: r.id,
      label,
      minutes: Math.round(minutes * 2) / 2,
      hint: text(r.hint, DRAFT_HINT_MAX),
    });
  }
  return out;
}

export function normalizeAgendaDraft(raw: unknown): AgendaDraftState {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const minutes =
    typeof r.minutes === "number" &&
    Number.isFinite(r.minutes) &&
    r.minutes >= 5 &&
    r.minutes <= 480
      ? Math.round(r.minutes)
      : null;
  return {
    goal: text(r.goal, AGENDA_GOAL_MAX),
    minutes,
    segments: normalizeDraftSegments(r.segments),
  };
}

/** The stored settings made safe to use (a synced or hand-edited value can hold anything). */
export function normalizeSettings(raw: unknown): FacilitatorSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const volume =
    typeof r.focusVolume === "number" && Number.isFinite(r.focusVolume)
      ? Math.min(1, Math.max(0, r.focusVolume))
      : FT_SETTINGS_INITIAL.focusVolume;
  return {
    pomodoro: normalizePomodoro(r.pomodoro),
    breakMinutes: normalizeBreakMinutes(r.breakMinutes),
    crazy8s: normalizeCrazy8s(r.crazy8s),
    chime: r.chime === true,
    focusSound: isFocusSound(r.focusSound) ? r.focusSound : FT_SETTINGS_INITIAL.focusSound,
    focusVolume: volume,
    soundboardWhilePresenting: r.soundboardWhilePresenting === true,
    agenda: normalizeAgendaDraft(r.agenda),
  };
}
