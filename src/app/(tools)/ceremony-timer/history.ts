/**
 * Speaking time across runs: each finished meeting's report is kept (the
 * last HISTORY_MAX of them), and each person's share of the speaking time
 * is averaged over the last few meetings that had rounds of turns.
 *
 * A share is a person's spoken seconds over everyone's in that meeting, so
 * a long meeting and a short one count the same. The even share is one
 * over the number of people who took a turn (a skip counts as taking
 * part), averaged over the same meetings, so a person who joined only the
 * small meetings isn't measured against the big ones. Pure: reports in,
 * shares out. Names stay on the page; the export only names people when
 * the facilitator chooses to (./markdown.ts).
 */

import { nameKey } from "@/lib/team/names";
import type { RunReport, SegmentReport, TurnReport } from "./run";

/** The most finished meetings kept. */
export const HISTORY_MAX = 20;

/** How many recent meetings the speaking-time view can average. */
export const SHARE_RUN_CHOICES = [3, 5, 10, 20] as const;
export type ShareRuns = (typeof SHARE_RUN_CHOICES)[number];
export const DEFAULT_SHARE_RUNS: ShareRuns = 5;

/** Caps on what one kept report holds, so a hand-edited store can't grow it. */
const MAX_SEGMENTS = 20;
const MAX_TURNS = 60;
const TEXT_MAX = 200;
const DAY_SECONDS = 24 * 3600;

/** One finished meeting, as the summary showed it. */
export interface KeptRun {
  id: string;
  /** Epoch ms when it finished. */
  at: number;
  report: RunReport;
}

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const secs = (v: unknown): number =>
  num(v) ? Math.min(DAY_SECONDS, Math.max(0, Math.round(v))) : 0;
const text = (v: unknown): string => (typeof v === "string" ? v.trim().slice(0, TEXT_MAX) : "");

function normalizeTurn(raw: unknown): TurnReport | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  const name = text(t.name);
  if (!name) return null;
  return {
    name,
    plannedSeconds: secs(t.plannedSeconds),
    actualSeconds: secs(t.actualSeconds),
    skipped: t.skipped === true,
  };
}

function normalizeSegment(raw: unknown): SegmentReport | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  return {
    label: text(s.label),
    plannedSeconds: secs(s.plannedSeconds),
    actualSeconds: num(s.actualSeconds) ? secs(s.actualSeconds) : null,
    current: false,
    turns: (Array.isArray(s.turns) ? s.turns : [])
      .slice(0, MAX_TURNS)
      .map(normalizeTurn)
      .filter((t): t is TurnReport => t !== null),
  };
}

/** A kept report the page can use, or null. */
export function normalizeReport(raw: unknown): RunReport | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const label = text(r.label);
  if (!label || !Array.isArray(r.segments)) return null;
  const segments = r.segments
    .slice(0, MAX_SEGMENTS)
    .map(normalizeSegment)
    .filter((s): s is SegmentReport => s !== null);
  return {
    label,
    short: text(r.short) || label,
    finished: true,
    plannedSeconds: secs(r.plannedSeconds),
    actualSeconds: secs(r.actualSeconds),
    segments,
  };
}

/** The stored history made safe to use: each id once, oldest first, the last HISTORY_MAX. */
export function normalizeHistory(raw: unknown): KeptRun[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: KeptRun[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const k = item as Record<string, unknown>;
    if (typeof k.id !== "string" || !k.id || k.id.length > 60 || seen.has(k.id) || !num(k.at)) {
      continue;
    }
    const report = normalizeReport(k.report);
    if (!report) continue;
    seen.add(k.id);
    out.push({ id: k.id, at: k.at, report });
  }
  return out.sort((a, b) => a.at - b.at).slice(-HISTORY_MAX);
}

/** A finished run's report, ready to keep: nothing about it is "so far" any more. */
export function keptRunOf(report: RunReport, at: number, id: string): KeptRun {
  return {
    id,
    at,
    report: {
      ...report,
      finished: true,
      segments: report.segments.slice(0, MAX_SEGMENTS).map((s) => ({
        ...s,
        current: false,
        turns: s.turns.slice(0, MAX_TURNS),
      })),
    },
  };
}

/** The history with `kept` added, the oldest dropped past HISTORY_MAX. */
export function withKeptRun(history: readonly KeptRun[], kept: KeptRun): KeptRun[] {
  return [...history.filter((k) => k.id !== kept.id), kept].slice(-HISTORY_MAX);
}

export function isShareRuns(value: unknown): value is ShareRuns {
  return SHARE_RUN_CHOICES.includes(value as ShareRuns);
}

/** Every turn a meeting recorded, across its rounds. */
const turnsOf = (report: RunReport): TurnReport[] => report.segments.flatMap((s) => s.turns);

/** Whether a meeting had a round in which somebody spoke. */
export function hadTurns(report: RunReport): boolean {
  return turnsOf(report).some((t) => !t.skipped && t.actualSeconds > 0);
}

export interface PersonShare {
  /** nameKey of the name: the same person across meetings. */
  key: string;
  /** The name as the latest meeting had it. */
  name: string;
  /** Meetings they took a turn in (or skipped one), of those averaged. */
  runs: number;
  /** Their average share of the speaking time, 0–1. */
  share: number;
  /** The average even share in those meetings, 0–1. */
  even: number;
}

export interface SpeakingShares {
  /** Meetings averaged: the last `lastN` with turns. */
  runs: number;
  people: PersonShare[];
}

/** Each person's average share of the speaking time over the last `lastN` meetings with turns. */
export function speakingShares(history: readonly KeptRun[], lastN: number): SpeakingShares {
  const n = Math.max(1, Math.floor(lastN));
  const runs = history.filter((k) => hadTurns(k.report)).slice(-n);
  const people = new Map<string, { name: string; runs: number; share: number; even: number }>();
  for (const { report } of runs) {
    const turns = turnsOf(report);
    const spoken = new Map<string, { name: string; seconds: number }>();
    for (const t of turns) {
      const key = nameKey(t.name);
      if (!key) continue;
      const cur = spoken.get(key) ?? { name: t.name, seconds: 0 };
      if (!t.skipped) cur.seconds += t.actualSeconds;
      cur.name = t.name;
      spoken.set(key, cur);
    }
    const total = Array.from(spoken.values()).reduce((s, p) => s + p.seconds, 0);
    if (total <= 0 || spoken.size === 0) continue;
    const even = 1 / spoken.size;
    for (const [key, p] of Array.from(spoken)) {
      const acc = people.get(key) ?? { name: p.name, runs: 0, share: 0, even: 0 };
      acc.name = p.name;
      acc.runs += 1;
      acc.share += p.seconds / total;
      acc.even += even;
      people.set(key, acc);
    }
  }
  return {
    runs: runs.length,
    people: Array.from(people)
      .map(([key, p]) => ({
        key,
        name: p.name,
        runs: p.runs,
        share: p.share / p.runs,
        even: p.even / p.runs,
      }))
      .sort((a, b) => b.share - a.share || a.name.localeCompare(b.name)),
  };
}

/** A share as a whole percentage: "23%". */
export function percent(share: number): string {
  return `${Math.round(Math.max(0, share) * 100)}%`;
}

/**
 * The shares in one sentence with no names in it, for an export that
 * leaves names out: "Over the last 5 meetings with turns, 6 people spoke;
 * shares ran from 9% to 28% of the speaking time (an even share was about 17%)."
 */
export function anonymousSharesText(shares: SpeakingShares): string {
  const { runs, people } = shares;
  if (runs === 0 || people.length === 0) return "No meetings with turns kept yet.";
  const meetings = runs === 1 ? "the last meeting" : `the last ${runs} meetings`;
  if (people.length === 1) return `Over ${meetings} with turns, 1 person spoke.`;
  const min = Math.min(...people.map((p) => p.share));
  const max = Math.max(...people.map((p) => p.share));
  const even = people.reduce((s, p) => s + p.even, 0) / people.length;
  return `Over ${meetings} with turns, ${people.length} people spoke; shares ran from ${percent(min)} to ${percent(max)} of the speaking time (an even share was about ${percent(even)}).`;
}
