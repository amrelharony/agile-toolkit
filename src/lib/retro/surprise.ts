/**
 * "Surprise me": a retro plan picked at random, for a team that has run the
 * same format too often. It picks a format from the built-in ones and the
 * team's own, never one of the last three the team used (unless that leaves
 * nothing), plus an opening and a closing activity.
 *
 * The activities are the Ice Breaker's own (lib/constants/icebreakers),
 * named by id and read from there, not copied: a check-in to open, and a
 * short round to close. Where a check-in closes a retro, the line saying so
 * is ours.
 *
 * Pure: the caller passes the formats, the boards and a random source (the
 * agent's verb passes a seeded one, so its tests are stable).
 */

import { icebreakers, type IceBreaker } from "@/lib/constants/icebreakers";
import { retroFormats, type RetroFormat } from "@/lib/constants/retro-formats";
import type { RetroBoard } from "@/lib/stores/workspace-types";
import type { RetroFacts } from "./facts";
import { pastRetros } from "@/app/(tools)/retro/archive";
import { pick, type Rng } from "@/lib/utils/random";

/** How many of the latest retros' formats a surprise avoids. */
export const SURPRISE_AVOID_RECENT = 3;

/** Ice Breaker activities that open a retro: a quick check-in on now or the sprint. */
export const OPENING_ACTIVITY_IDS = [
  "q-7", // One Word Check-In
  "a-2", // Emoji Check-In
  "q-10", // Peak and Pit
  "ag-2", // Sprint Retrospective Warm-Up
  "c-1", // Six-Word Memoir
  "c-9", // Meme of the Sprint
  "ag-11", // Sprint Theme Song
  "c-2", // Draw Your Mood
] as const;

/** Ice Breaker activities that close one: how people leave, briefly. */
export const CLOSING_ACTIVITY_IDS = [
  "a-7", // Gratitude Round
  "q-7", // One Word Check-In, as a check-out
  "a-2", // Emoji Check-In, as a check-out
  "c-1", // Six-Word Memoir, about the retro
  "c-3", // Haiku Challenge
  "ag-3", // Scrum Values Discussion
] as const;

/** Our own line for a check-in that closes the retro instead. */
const CLOSING_LINES: Readonly<Record<string, string>> = {
  "q-7": "As a check-out: one word each for how you leave this retro.",
  "a-2": "As a check-out: one emoji each for how you leave this retro.",
  "c-1": "Six words each about this retro or the sprint ahead.",
};

export type ActivityRole = "opening" | "closing";

export interface RetroActivity {
  /** The Ice Breaker activity's id. */
  id: string;
  name: string;
  /** What to do, in a line: the Ice Breaker's own description, or our check-out line. */
  line: string;
  minutes: number;
  role: ActivityRole;
}

function asActivity(ib: IceBreaker, role: ActivityRole): RetroActivity {
  return {
    id: ib.id,
    name: ib.name,
    line: (role === "closing" ? CLOSING_LINES[ib.id] : undefined) ?? ib.description,
    minutes: ib.timeMinutes,
    role,
  };
}

/** The activity with this id in `role`, or null when it isn't one the role offers. */
export function retroActivity(id: string, role: ActivityRole): RetroActivity | null {
  const ids: readonly string[] = role === "opening" ? OPENING_ACTIVITY_IDS : CLOSING_ACTIVITY_IDS;
  if (!ids.includes(id)) return null;
  const ib = icebreakers.find((i) => i.id === id);
  return ib ? asActivity(ib, role) : null;
}

/** Every activity a role offers (those the Ice Breaker still has). */
export function retroActivities(role: ActivityRole): RetroActivity[] {
  const ids: readonly string[] = role === "opening" ? OPENING_ACTIVITY_IDS : CLOSING_ACTIVITY_IDS;
  return ids.flatMap((id) => {
    const a = retroActivity(id, role);
    return a ? [a] : [];
  });
}

/** The formats of the latest `n` retros, newest first, without repeats. */
export function recentFormatIds(
  boards: readonly RetroBoard[],
  n: number = SURPRISE_AVOID_RECENT
): string[] {
  const out: string[] = [];
  for (const b of pastRetros(boards).slice(0, n)) {
    const id = b.format?.id;
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * The team's own formats as past retros kept them (a custom format's
 * board carries its columns), newest first, one per id. The agent, which
 * can't read this browser's saved formats, offers these.
 */
export function formatsFromBoards(boards: readonly RetroBoard[]): RetroFormat[] {
  const builtIn = new Set(retroFormats.map((f) => f.id));
  const out: RetroFormat[] = [];
  for (const b of pastRetros(boards)) {
    const f = b.format;
    if (!f?.id || builtIn.has(f.id) || out.some((o) => o.id === f.id)) continue;
    if (!Array.isArray(f.columns) || f.columns.length === 0) continue;
    out.push(f);
  }
  return out;
}

/** `formats` with each id once, first one kept. */
export function uniqueFormats(formats: readonly RetroFormat[]): RetroFormat[] {
  const seen = new Set<string>();
  return formats.filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true)));
}

/**
 * The formats a surprise picks from: every one but those in `recent`. When
 * that leaves none (a team with only the recent ones), all of them.
 */
export function surpriseCandidates(
  formats: readonly RetroFormat[],
  recent: readonly string[]
): RetroFormat[] {
  const all = uniqueFormats(formats);
  const fresh = all.filter((f) => !recent.includes(f.id));
  return fresh.length > 0 ? fresh : all;
}

export interface SurprisePlan {
  format: RetroFormat;
  opening: RetroActivity;
  closing: RetroActivity;
  /** The recent formats it stayed away from. */
  avoided: string[];
}

export interface SurpriseOptions {
  formats: readonly RetroFormat[];
  /** Formats of the latest retros (`recentFormatIds`). */
  recent: readonly string[];
  rng?: Rng;
  /** The plan shown before, so "Shuffle again" changes the format when it can. */
  previous?: Pick<SurprisePlan, "format" | "opening" | "closing"> | null;
}

/**
 * A plan: a format from the candidates (another than `previous`'s when
 * there is one), an opening, and a closing that isn't the same activity.
 * Null when there is no format at all.
 */
export function surprisePlan({
  formats,
  recent,
  rng,
  previous,
}: SurpriseOptions): SurprisePlan | null {
  const candidates = surpriseCandidates(formats, recent);
  const avoided = uniqueFormats(formats)
    .filter((f) => recent.includes(f.id) && !candidates.some((c) => c.id === f.id))
    .map((f) => f.id);
  const format = pick(candidates, {
    rng,
    exclude: (f) => candidates.length > 1 && f.id === previous?.format.id,
  });
  if (!format) return null;
  const openings = retroActivities("opening");
  const closings = retroActivities("closing");
  const opening =
    pick(openings, {
      rng,
      exclude: (a) => openings.length > 1 && a.id === previous?.opening.id,
    }) ?? openings[0];
  const closing =
    pick(closings, {
      rng,
      exclude: (a) =>
        a.id === opening?.id || (closings.length > 2 && a.id === previous?.closing.id),
    }) ?? closings[0];
  if (!opening || !closing) return null;
  return { format, opening, closing, avoided };
}

/**
 * The plan with another format (Amr's pick): the same opening and closing.
 * Null when `formatId` isn't one of `formats`.
 */
export function withPlanFormat(
  plan: SurprisePlan,
  formats: readonly RetroFormat[],
  formatId: string
): SurprisePlan | null {
  const format = formats.find((f) => f.id === formatId);
  return format ? { ...plan, format } : null;
}

/* ── What Amr reads (retro.surprise_plan) ──────────────────────────── */

/** The sprint as retro.surprise_plan takes it. */
export interface SurpriseSprintInput {
  name: string;
  goal: "met" | "partly" | "not-met" | "unknown";
  committed: number;
  completed: number;
  sayDo: "met" | "close" | "missed" | "over" | "unknown";
  mood: number | null;
  ended: boolean;
  facts: string[];
}

/**
 * The sprint's facts as the task takes them: the numbers suggestFormat
 * reads, and the board's fact lines ("Sprint goal: …") as text, capped.
 */
export function surpriseSprintInput(
  facts: Pick<
    RetroFacts,
    "sprintName" | "goalOutcome" | "committed" | "completed" | "sayDo" | "mood"
  >,
  ended: boolean,
  lines: readonly string[] = []
): SurpriseSprintInput {
  const clamp = (n: number) => Math.max(0, Math.min(100000, Number.isFinite(n) ? n : 0));
  const mood = facts.mood.average;
  return {
    name: facts.sprintName.slice(0, 120) || "The sprint",
    goal: facts.goalOutcome?.met ?? "unknown",
    committed: clamp(facts.committed),
    completed: clamp(facts.completed),
    sayDo: facts.sayDo?.grade ?? "unknown",
    mood: typeof mood === "number" && mood >= 1 && mood <= 5 ? mood : null,
    ended,
    facts: lines.slice(0, 12).map((l) => l.slice(0, 300)),
  };
}

/** A format as the task takes it: id, name, a description and its column names, capped. */
export function surpriseFormatInput(f: RetroFormat): {
  id: string;
  name: string;
  description: string;
  columns: string[];
} {
  return {
    id: f.id.slice(0, 64),
    name: (f.name || "Retro").slice(0, 120),
    description: (f.description ?? "").slice(0, 300),
    columns: f.columns.slice(0, 12).map((c) => c.label.slice(0, 60)),
  };
}
