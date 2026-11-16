/**
 * The Ceremony Timer's agendas: each ceremony as a run of timed segments
 * (the retro's five phases, 1-2-4-All's rounds), with the total taken from
 * the team's cadence and split across the segments by weight.
 *
 * The team can change a built-in agenda (names, lengths, rounds of turns,
 * and which segments it has, in what order) and save any agenda under a
 * name of its own. Pure: the team's edits come in as saved segments, a
 * layout and named agendas (./store.ts), and the sprint length as a
 * number, so the maths is testable without a store.
 */

import { ceremonyTimeboxMinutes, type CeremonyKind } from "@/lib/sprints/cadence";

/** The built-in agendas. */
export type AgendaId =
  | "daily"
  | "planning"
  | "refinement"
  | "review"
  | "retro"
  | "one-two-four-all"
  | "custom";

/** An agenda the team saved under a name: "saved-" and a short random id. */
export type SavedAgendaId = `saved-${string}`;

/** Any agenda the timer runs: a built-in one or one the team saved. */
export type AgendaKey = AgendaId | SavedAgendaId;

/** One timed part of an agenda, as the timer runs it. */
export interface Segment {
  /** Stable within its agenda: saved edits and a run's records key on it. */
  id: string;
  label: string;
  /** Whole seconds, never negative; 0 only for a Custom time-box not set yet. */
  seconds: number;
  /** Speakers take turns (round-robin) in this segment. */
  speakers: boolean;
  /** What happens in it, one sentence. */
  hint: string;
}

export interface Agenda {
  id: AgendaKey;
  /** "Sprint Retrospective" */
  label: string;
  /** "Retro": for the docked timer and the verdict. */
  short: string;
  segments: Segment[];
  /** The team changed it from the defaults. */
  edited: boolean;
  /** One the team saved under a name: it can be renamed and deleted, never reset. */
  saved?: boolean;
}

/**
 * A segment of a built-in agenda as the team saved it; anything missing
 * falls back to the default. A segment the team added (`added`) has no
 * default, so it carries its own name and length, and its hint if it has
 * one.
 */
export interface SavedSegment {
  id: string;
  label?: string;
  minutes?: number;
  speakers?: boolean;
  added?: boolean;
  hint?: string;
}

export type SavedAgendas = Partial<Record<AgendaId, SavedSegment[]>>;

/**
 * Per built-in agenda, the ids of its segments in the order the team set,
 * once they added, removed or reordered any. Absent means every built-in
 * segment, in the built-in order.
 */
export type AgendaLayouts = Partial<Record<AgendaId, string[]>>;

/** A segment of a named agenda: everything it needs, nothing follows the cadence. */
export interface NamedAgendaSegment {
  id: string;
  label: string;
  minutes: number;
  speakers: boolean;
  hint?: string;
}

/** An agenda the team saved under a name. */
export interface NamedAgenda {
  id: SavedAgendaId;
  name: string;
  segments: NamedAgendaSegment[];
}

interface SegmentTemplate {
  id: string;
  label: string;
  /** Share of the total, relative to the agenda's other segments. */
  weight: number;
  speakers?: boolean;
  hint: string;
}

interface AgendaTemplate {
  id: AgendaId;
  label: string;
  short: string;
  /** The ceremony whose timebox (from the cadence) sets the total. */
  kind?: CeremonyKind;
  /** The total when there is no ceremony behind it; Custom has none. */
  minutes?: number;
  segments: SegmentTemplate[];
}

/** No segment, and no agenda, runs longer than a working day. */
export const MAX_AGENDA_MINUTES = 480;

/** The shortest segment the editor accepts. */
export const MIN_SEGMENT_MINUTES = 0.5;

/** The most segments an agenda holds. */
export const MAX_SEGMENTS = 20;

/** The most agendas the team can save under a name. */
export const MAX_NAMED_AGENDAS = 30;

/** The longest agenda name and segment name. */
export const AGENDA_NAME_MAX = 80;
export const SEGMENT_LABEL_MAX = 80;

/** The longest hint a segment keeps. */
export const SEGMENT_HINT_MAX = 200;

export const SAVED_AGENDA_PREFIX = "saved-";
const SAVED_ID = /^saved-[a-z0-9-]{1,40}$/;
const SEGMENT_ID = /^[a-z0-9-]{1,60}$/;

/**
 * The built-in agendas, in the order the picker lists them. Weights give
 * round numbers at the default lengths: a two-week sprint's 90-minute retro
 * splits 10 / 30 / 20 / 20 / 10, its 4-hour planning 48 / 96 / 96.
 */
const TEMPLATES: readonly AgendaTemplate[] = [
  {
    id: "daily",
    label: "Daily Scrum",
    short: "Daily Scrum",
    kind: "daily",
    segments: [
      {
        id: "round",
        label: "Round the team",
        weight: 1,
        speakers: true,
        hint: "Each developer: progress toward the Sprint Goal, the plan for today, and anything in the way.",
      },
    ],
  },
  {
    id: "planning",
    label: "Sprint Planning",
    short: "Planning",
    kind: "planning",
    segments: [
      {
        id: "why",
        label: "Why: the Sprint Goal",
        weight: 1,
        hint: "Why is this sprint valuable? Agree the Sprint Goal with the Product Owner.",
      },
      {
        id: "what",
        label: "What: pick the work",
        weight: 2,
        hint: "Which backlog items can be Done this sprint, given the team's capacity?",
      },
      {
        id: "how",
        label: "How: plan the work",
        weight: 2,
        hint: "How will the chosen work get done? Break the first items into tasks.",
      },
    ],
  },
  {
    id: "refinement",
    label: "Backlog Refinement",
    short: "Refinement",
    kind: "refinement",
    segments: [
      {
        id: "look-ahead",
        label: "Look ahead",
        weight: 1,
        hint: "Walk through the stories at the top of the backlog.",
      },
      {
        id: "clarify",
        label: "Clarify and split",
        weight: 2,
        hint: "Ask questions, add acceptance criteria, split what is too big.",
      },
      { id: "estimate", label: "Estimate", weight: 2, hint: "Size the stories that are clear." },
      {
        id: "ready",
        label: "Check readiness",
        weight: 1,
        hint: "Which stories meet the Definition of Ready for the next planning?",
      },
    ],
  },
  {
    id: "review",
    label: "Sprint Review",
    short: "Review",
    kind: "review",
    segments: [
      {
        id: "demo",
        label: "Demo",
        weight: 3,
        hint: "Show what was Done this sprint, against the Sprint Goal.",
      },
      {
        id: "feedback",
        label: "Feedback",
        weight: 2,
        hint: "Hear from the stakeholders and note what should change.",
      },
      {
        id: "next",
        label: "What's next",
        weight: 1,
        hint: "Look at the backlog, timeline and budget ahead.",
      },
    ],
  },
  {
    id: "retro",
    label: "Sprint Retrospective",
    short: "Retro",
    kind: "retro",
    segments: [
      {
        id: "set-the-stage",
        label: "Set the stage",
        weight: 1,
        hint: "Welcome everyone and agree the focus of this retro.",
      },
      {
        id: "gather-data",
        label: "Gather data",
        weight: 3,
        hint: "Build a shared picture of the sprint: events, facts, feelings.",
      },
      {
        id: "generate-insights",
        label: "Generate insights",
        weight: 2,
        hint: "Ask why things happened and look for patterns.",
      },
      {
        id: "decide",
        label: "Decide what to do",
        weight: 2,
        hint: "Pick one or two actions, each with an owner.",
      },
      {
        id: "close",
        label: "Close",
        weight: 1,
        hint: "Recap the actions and thank everyone.",
      },
    ],
  },
  {
    id: "one-two-four-all",
    label: "1-2-4-All",
    short: "1-2-4-All",
    minutes: 12,
    segments: [
      { id: "one", label: "1: alone", weight: 1, hint: "Think about the question in silence." },
      { id: "two", label: "2: in pairs", weight: 2, hint: "Build on each other's ideas." },
      {
        id: "four",
        label: "4: in fours",
        weight: 4,
        hint: "Notice the similarities and differences.",
      },
      {
        id: "all",
        label: "All: whole group",
        weight: 5,
        hint: "Each group shares one idea that stood out.",
      },
    ],
  },
  {
    id: "custom",
    label: "Custom time-box",
    short: "Time-box",
    segments: [
      {
        id: "timebox",
        label: "Time-box",
        weight: 1,
        hint: "One shared time-box for any meeting.",
      },
    ],
  },
];

const TEMPLATE_BY_ID = new Map(TEMPLATES.map((t) => [t.id, t]));

export const AGENDA_IDS: readonly AgendaId[] = TEMPLATES.map((t) => t.id);

export function isAgendaId(value: unknown): value is AgendaId {
  return typeof value === "string" && TEMPLATE_BY_ID.has(value as AgendaId);
}

export function isSavedAgendaId(value: unknown): value is SavedAgendaId {
  return typeof value === "string" && SAVED_ID.test(value);
}

/** A built-in agenda's id or a saved one's (whether that one still exists is the store's to say). */
export function isAgendaKey(value: unknown): value is AgendaKey {
  return isAgendaId(value) || isSavedAgendaId(value);
}

/** A fresh id for an agenda saved under a name. */
export function newSavedAgendaId(random: () => number = Math.random): SavedAgendaId {
  return `${SAVED_AGENDA_PREFIX}${randomTail(random)}`;
}

/** A fresh id for a segment the team adds, none of `taken`. */
export function newSegmentId(taken: Iterable<string>, random: () => number = Math.random): string {
  const used = new Set(taken);
  for (;;) {
    const id = `seg-${randomTail(random)}`;
    if (!used.has(id)) return id;
  }
}

function randomTail(random: () => number): string {
  let out = "";
  for (let i = 0; i < 8; i++)
    out += "abcdefghijkmnpqrstuvwxyz23456789"[Math.floor(random() * 32) % 32];
  return out;
}

/** Text cut to `max` characters, ending in "…" when it was longer. */
function capText(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/**
 * `totalSeconds` split by `weights` into whole seconds that add up exactly.
 *
 * The parts are whole minutes when the total allows it (each part at least
 * one), else half minutes, else seconds; the rounding goes to the largest
 * remainders (ties to the heavier weight, then the earlier part), so a
 * 60-minute retro reads 7 / 20 / 13 / 13 / 7 rather than drifting to 61.
 * Weights that aren't positive numbers count as equal shares.
 */
export function splitSeconds(totalSeconds: number, weights: readonly number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const total = Number.isFinite(totalSeconds) ? Math.max(0, Math.round(totalSeconds)) : 0;
  const clean = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const sum = clean.reduce((a, b) => a + b, 0);
  const w = sum > 0 ? clean : clean.map(() => 1);
  const wSum = sum > 0 ? sum : n;

  const unit = [60, 30, 1].find((u) => total % u === 0 && total / u >= n) ?? 1;
  const units = Math.round(total / unit);
  const raw = w.map((x) => (x / wSum) * units);
  const parts = raw.map(Math.floor);
  let left = units - parts.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, rem: r - Math.floor(r), weight: w[i] }))
    .sort((a, b) => b.rem - a.rem || b.weight - a.weight || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % n, left--) parts[order[k].i] += 1;

  // A light segment can round to nothing: give it a unit from the largest.
  if (units >= n) {
    for (let i = 0; i < n; i++) {
      if (parts[i] > 0) continue;
      const donor = parts.indexOf(Math.max(...parts));
      parts[donor] -= 1;
      parts[i] += 1;
    }
  }
  return parts.map((p) => p * unit);
}

/** The agenda's length in minutes before the team edits it: 0 for Custom. */
export function defaultMinutes(id: AgendaId, sprintLengthDays: number): number {
  const t = TEMPLATE_BY_ID.get(id);
  if (!t) return 0;
  if (t.kind) return ceremonyTimeboxMinutes(t.kind, sprintLengthDays);
  return t.minutes ?? 0;
}

function defaultSegments(t: AgendaTemplate, sprintLengthDays: number): Segment[] {
  const seconds = splitSeconds(
    defaultMinutes(t.id, sprintLengthDays) * 60,
    t.segments.map((s) => s.weight)
  );
  return t.segments.map((s, i) => ({
    id: s.id,
    label: s.label,
    seconds: seconds[i] ?? 0,
    speakers: s.speakers === true,
    hint: s.hint,
  }));
}

/** A saved length in minutes the timer can run: positive, at most a working day. */
function savedSeconds(minutes: unknown): number | null {
  const m = Number(minutes);
  if (typeof minutes !== "number" || !Number.isFinite(m) || m <= 0) return null;
  const seconds = Math.round(Math.min(m, MAX_AGENDA_MINUTES) * 60);
  return seconds > 0 ? seconds : null;
}

/** A segment name read from storage: trimmed and capped, or null when blank. */
function savedLabel(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? capText(value, SEGMENT_LABEL_MAX) : null;
}

function savedHint(value: unknown): string {
  return typeof value === "string" ? capText(value, SEGMENT_HINT_MAX) : "";
}

/**
 * The agenda as the timer runs it: the built-in segments, with each one's
 * saved label, length and turn-taking where the team changed them, any
 * segments the team added, in the order the team set (`layouts`). Saved
 * rows are matched by segment id; rows for segments the agenda doesn't
 * have, and values that can't be used (hand-edited storage), are ignored.
 * A layout that names no segment the agenda has leaves the built-in order.
 */
export function resolveAgenda(
  id: AgendaId,
  saved: SavedAgendas | null | undefined,
  sprintLengthDays: number,
  layouts?: AgendaLayouts | null
): Agenda {
  const t = TEMPLATE_BY_ID.get(id) ?? TEMPLATE_BY_ID.get("custom")!;
  const rows = Array.isArray(saved?.[t.id]) ? (saved?.[t.id] as unknown[]) : [];
  const byId = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (typeof r.id === "string" && !byId.has(r.id)) byId.set(r.id, r);
  }
  let edited = false;
  const builtIn = defaultSegments(t, sprintLengthDays).map((seg) => {
    const row = byId.get(seg.id);
    if (!row) return seg;
    const label = savedLabel(row.label) ?? seg.label;
    const seconds = savedSeconds(row.minutes) ?? seg.seconds;
    const speakers = typeof row.speakers === "boolean" ? row.speakers : seg.speakers;
    if (label !== seg.label || seconds !== seg.seconds || speakers !== seg.speakers) edited = true;
    return { ...seg, label, seconds, speakers };
  });

  // Segments the team added: each needs its own id, name and length.
  const builtInIds = new Set(builtIn.map((s) => s.id));
  const added: Segment[] = [];
  for (const [segId, row] of Array.from(byId)) {
    if (row.added !== true || builtInIds.has(segId) || !SEGMENT_ID.test(segId)) continue;
    const label = savedLabel(row.label);
    const seconds = savedSeconds(row.minutes);
    if (!label || seconds === null) continue;
    added.push({
      id: segId,
      label,
      seconds,
      speakers: row.speakers === true,
      hint: savedHint(row.hint),
    });
  }

  let segments = [...builtIn, ...added];
  const layout = layouts?.[t.id];
  if (Array.isArray(layout) && layout.length > 0) {
    const pool = new Map(segments.map((s) => [s.id, s]));
    const ordered: Segment[] = [];
    for (const segId of layout) {
      const seg = typeof segId === "string" ? pool.get(segId) : undefined;
      if (!seg) continue;
      ordered.push(seg);
      pool.delete(segId);
    }
    if (ordered.length > 0) segments = ordered;
  }
  segments = segments.slice(0, MAX_SEGMENTS);
  if (segments.length !== builtIn.length || segments.some((s, i) => s.id !== builtIn[i].id)) {
    edited = true;
  }
  return { id: t.id, label: t.label, short: t.short, segments, edited };
}

/** A named agenda as the timer runs it. */
export function resolveNamedAgenda(named: NamedAgenda): Agenda {
  return {
    id: named.id,
    label: named.name,
    short: named.name,
    segments: named.segments.map((s) => ({
      id: s.id,
      label: s.label,
      seconds: Math.round(s.minutes * 60),
      speakers: s.speakers,
      hint: s.hint ?? "",
    })),
    edited: false,
    saved: true,
  };
}

/** Every built-in agenda, resolved, then the team's named ones in the order they were saved. */
export function allAgendas(
  saved: SavedAgendas | null | undefined,
  sprintLengthDays: number,
  layouts?: AgendaLayouts | null,
  named?: readonly NamedAgenda[] | null
): Agenda[] {
  return [
    ...AGENDA_IDS.map((id) => resolveAgenda(id, saved, sprintLengthDays, layouts)),
    ...(named ?? []).map(resolveNamedAgenda),
  ];
}

/**
 * What the team's edit stores: for each built-in segment, only what differs
 * from the default (an empty list when nothing does), and every segment the
 * team added in full. A length left alone keeps following the cadence, so a
 * team that renames "Gather data" still gets a shorter retro when it moves
 * to one-week sprints.
 */
export function toSaved(
  id: AgendaId,
  segments: readonly Segment[],
  sprintLengthDays: number
): SavedSegment[] {
  const defaults = new Map(
    resolveAgenda(id, null, sprintLengthDays).segments.map((s) => [s.id, s])
  );
  const out: SavedSegment[] = [];
  for (const s of segments) {
    const d = defaults.get(s.id);
    if (!d) {
      out.push({
        id: s.id,
        added: true,
        label: s.label,
        minutes: s.seconds / 60,
        ...(s.speakers ? { speakers: true } : {}),
        ...(s.hint ? { hint: s.hint } : {}),
      });
      continue;
    }
    const row: SavedSegment = { id: s.id };
    if (s.label !== d.label) row.label = s.label;
    if (s.seconds !== d.seconds) row.minutes = s.seconds / 60;
    if (s.speakers !== d.speakers) row.speakers = s.speakers;
    if (Object.keys(row).length > 1) out.push(row);
  }
  return out;
}

/**
 * The order to store for a built-in agenda's segments: their ids, once
 * they differ from the built-in segments in the built-in order (one was
 * added, removed or moved); undefined while they don't.
 */
export function layoutOf(
  id: AgendaId,
  segments: readonly Pick<Segment, "id">[]
): string[] | undefined {
  const t = TEMPLATE_BY_ID.get(id);
  const defaults = t ? t.segments.map((s) => s.id) : [];
  const ids = segments.map((s) => s.id);
  const same = ids.length === defaults.length && ids.every((x, i) => x === defaults[i]);
  return same ? undefined : ids;
}

/** A named agenda holding `segments`, as they are now (lengths no longer follow the cadence). */
export function namedAgendaFrom(
  id: SavedAgendaId,
  name: string,
  segments: readonly Segment[]
): NamedAgenda {
  return {
    id,
    name: capText(name, AGENDA_NAME_MAX),
    segments: segments.slice(0, MAX_SEGMENTS).map((s) => ({
      id: s.id,
      label: capText(s.label, SEGMENT_LABEL_MAX),
      minutes: s.seconds / 60,
      speakers: s.speakers,
      ...(s.hint ? { hint: capText(s.hint, SEGMENT_HINT_MAX) } : {}),
    })),
  };
}

/**
 * The named agendas made safe to use (synced or hand-edited storage can
 * hold anything): a known id shape, each id once, a name, and at least one
 * segment with a name and a usable length. At most MAX_NAMED_AGENDAS.
 */
export function normalizeNamedAgendas(raw: unknown): NamedAgenda[] {
  if (!Array.isArray(raw)) return [];
  const out: NamedAgenda[] = [];
  const ids = new Set<string>();
  for (const item of raw) {
    if (out.length >= MAX_NAMED_AGENDAS) break;
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (!isSavedAgendaId(r.id) || ids.has(r.id)) continue;
    const name =
      typeof r.name === "string" && r.name.trim() ? capText(r.name, AGENDA_NAME_MAX) : "";
    if (!name) continue;
    const segIds = new Set<string>();
    const segments: NamedAgendaSegment[] = [];
    for (const row of Array.isArray(r.segments) ? r.segments : []) {
      if (segments.length >= MAX_SEGMENTS) break;
      if (!row || typeof row !== "object") continue;
      const s = row as Record<string, unknown>;
      const label = savedLabel(s.label);
      const seconds = savedSeconds(s.minutes);
      if (typeof s.id !== "string" || !SEGMENT_ID.test(s.id) || segIds.has(s.id)) continue;
      if (!label || seconds === null) continue;
      segIds.add(s.id);
      const hint = savedHint(s.hint);
      segments.push({
        id: s.id,
        label,
        minutes: seconds / 60,
        speakers: s.speakers === true,
        ...(hint ? { hint } : {}),
      });
    }
    if (segments.length === 0) continue;
    ids.add(r.id);
    out.push({ id: r.id, name, segments });
  }
  return out;
}

/** The stored layouts, keeping built-in agendas only and segment ids that could be real. */
export function normalizeLayouts(raw: unknown): AgendaLayouts {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: AgendaLayouts = {};
  for (const [id, ids] of Object.entries(raw as Record<string, unknown>)) {
    if (!isAgendaId(id) || !Array.isArray(ids)) continue;
    const clean = Array.from(
      new Set(ids.filter((x): x is string => typeof x === "string" && SEGMENT_ID.test(x)))
    ).slice(0, MAX_SEGMENTS);
    if (clean.length > 0) out[id] = clean;
  }
  return out;
}

/**
 * A built-in agenda's segments split over `minutes` by its own weights, with
 * its hints: what the agenda would be for a meeting that long. For a draft
 * built from a template (Facilitator Timers' agenda without AI).
 */
export function templateSegments(id: AgendaId, minutes: number): Segment[] {
  const t = TEMPLATE_BY_ID.get(id) ?? TEMPLATE_BY_ID.get("custom")!;
  const total = Math.max(0, Math.min(MAX_AGENDA_MINUTES, Number.isFinite(minutes) ? minutes : 0));
  const seconds = splitSeconds(
    total * 60,
    t.segments.map((s) => s.weight)
  );
  return t.segments.map((s, i) => ({
    id: s.id,
    label: s.label,
    seconds: seconds[i] ?? 0,
    speakers: s.speakers === true,
    hint: s.hint,
  }));
}

/** A built-in agenda's name: "Sprint Retrospective". */
export function agendaLabel(id: AgendaId): string {
  return TEMPLATE_BY_ID.get(id)?.label ?? "Custom time-box";
}

export function agendaSeconds(agenda: Pick<Agenda, "segments">): number {
  return agenda.segments.reduce((sum, s) => sum + s.seconds, 0);
}

/**
 * `?agenda=retro` (a link from elsewhere in the toolkit), when it names an
 * agenda: a built-in one, or one the team saved (the page checks it is still
 * there).
 */
export function readAgendaParam(search: string): AgendaKey | null {
  const value = new URLSearchParams(search).get("agenda");
  return isAgendaKey(value) ? value : null;
}

/* -------------------------------------------------------------------------- */
/*  Formatting                                                                 */
/* -------------------------------------------------------------------------- */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A planned length for labels: "45 s", "6 min 30 s", "15 min", "1 h 30 min", "4 h". */
export function durationText(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h === 0) return sec ? `${m} min ${sec} s` : `${m} min`;
  const rest = Math.round((s - h * 3600) / 60);
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

/** A time inside a sentence, minutes unpadded: "0:42", "9:30", "1:02:05". */
export function shortClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** A difference in words: "42 seconds", "1 minute", "7 minutes". */
export function minutesText(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return plural(s, "second");
  return plural(Math.round(s / 60), "minute");
}

/** Minutes as the editor shows them: "10", "6.5". */
export function minutesValue(seconds: number): string {
  const m = Math.round((seconds / 60) * 100) / 100;
  return String(m);
}
