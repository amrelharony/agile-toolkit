/**
 * Test Sessions' pure model, server-safe: the id prefix the CRUD mints, the
 * lengths and labels, the ten lenses that suggest charters without AI, the
 * form checks, reading stored rows, a note's minutes into its session, the
 * bug a note becomes in Bug Triage, a follow-up charter, and the next
 * steps. The page, Amr's verbs, the AI task's fallback and the next-step
 * rule all use it. Pure: no store, no React, no zod, no "use client"
 * module; every clock function takes `now`.
 */

import type {
  HandoffLink,
  TestCharter,
  TestNoteKind,
  TestSession,
  TestSessionCoverage,
  TestSessionNote,
  TestSessionStatus,
} from "@/lib/stores/workspace-types";
import {
  TEST_NOTE_KINDS,
  TEST_SESSION_COVERAGE,
  TEST_SESSION_STATUSES,
  TOOL_LIST_MAX,
  TOOL_TEXT_MAX,
} from "@/lib/stores/workspace-types";
import type { HandoffSource } from "@/lib/handoffs/types";
import type { NextStep } from "@/lib/tools/next-steps";
import { isExampleId } from "@/lib/utils/example-id";
import type { Validation } from "@/lib/utils/form";

/** Every test session's id starts with this (the workspace.test_session CRUD's). */
export const TEST_SESSION_ID_PREFIX = "tsess_";

/** One minutes range everywhere: the entity, the form and the AI. */
export const SESSION_MINUTES_MIN = 15;
export const SESSION_MINUTES_MAX = 240;
/** The lengths the form offers. */
export const SESSION_LENGTHS = [15, 30, 45, 60, 90, 120] as const;
/** A new session's length when nothing says otherwise. */
export const DEFAULT_SESSION_MINUTES = 60;

/** The length the form offers nearest `minutes` (the shorter one on a tie). */
export function nearestLength(minutes: number): number {
  if (!Number.isFinite(minutes)) return DEFAULT_SESSION_MINUTES;
  let best: number = SESSION_LENGTHS[0];
  for (const l of SESSION_LENGTHS) if (Math.abs(l - minutes) < Math.abs(best - minutes)) best = l;
  return best;
}

/** A whole number of minutes within the range, or null when it isn't a number. */
export function clampMinutes(minutes: unknown): number | null {
  if (typeof minutes !== "number" || !Number.isFinite(minutes)) return null;
  return Math.min(SESSION_MINUTES_MAX, Math.max(SESSION_MINUTES_MIN, Math.round(minutes)));
}

/* ── Labels ──────────────────────────────────────────────────────────── */

export const STATUS_LABEL: Readonly<Record<TestSessionStatus, string>> = {
  planned: "Planned",
  running: "Running",
  done: "Done",
};

export const NOTE_KIND_LABEL: Readonly<Record<TestNoteKind, string>> = {
  note: "Note",
  bug: "Bug",
  question: "Question",
  idea: "Idea",
};

/** Plural, for "2 bugs, 1 question". */
export const NOTE_KIND_PLURAL: Readonly<Record<TestNoteKind, string>> = {
  note: "notes",
  bug: "bugs",
  question: "questions",
  idea: "ideas",
};

export const COVERAGE_LABEL: Readonly<Record<TestSessionCoverage, string>> = {
  all: "All of it",
  most: "Most of it",
  some: "Some of it",
  little: "Very little",
};

/** The charter's three parts, in our own words. */
export const CHARTER_LABEL = {
  target: "Look at…",
  using: "Using…",
  toLearn: "To learn…",
} as const;

/** "Look at checkout, using a saved card, to learn whether …". */
export function charterSentence(charter: TestCharter): string {
  const using = charter.using?.trim();
  const learn = charter.toLearn.trim();
  return [
    `Look at ${charter.target.trim()}`,
    using ? `using ${using}` : "",
    learn ? `to learn ${learn.replace(/[.!?]+$/, "")}` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

/* ── Lenses: charters without AI ─────────────────────────────────────── */

export interface TestLens {
  id: string;
  /** The lens, as a charter's "using". */
  using: string;
  /** What it looks for, as a charter's "to learn". */
  toLearn: string;
  /** Words in a story that make the lens likely to find something. */
  words: readonly string[];
}

/** Ten ways to look at a part of the product, each a charter's "using" and "to learn". */
export const TEST_LENSES: readonly TestLens[] = [
  {
    id: "limits",
    using: "values at and just past the limits",
    toLearn: "what happens at the edges: the smallest, the largest and one past each",
    words: ["limit", "max", "min", "maximum", "minimum", "amount", "length", "size", "range"],
  },
  {
    id: "odd-input",
    using: "odd, empty and wrong input",
    toLearn: "whether it refuses bad input clearly and keeps the good",
    words: ["form", "field", "input", "enter", "type", "upload", "import", "email", "name"],
  },
  {
    id: "interrupted",
    using: "interrupting it halfway and coming back",
    toLearn: "whether work survives a closed tab, a back button or a reload",
    words: ["step", "wizard", "checkout", "draft", "save", "session", "flow", "resume"],
  },
  {
    id: "roles",
    using: "different roles and permissions",
    toLearn: "who can see and change what, and what someone without access sees",
    words: ["admin", "role", "permission", "access", "owner", "share", "private", "user"],
  },
  {
    id: "lots-of-data",
    using: "lots of data",
    toLearn: "how it behaves with long lists, big files and many records",
    words: ["list", "search", "report", "export", "history", "table", "results", "filter"],
  },
  {
    id: "devices",
    using: "other devices and screen sizes",
    toLearn: "whether it works on a phone, a tablet and a wide screen",
    words: ["mobile", "phone", "tablet", "screen", "layout", "responsive", "app", "browser"],
  },
  {
    id: "keyboard",
    using: "only a keyboard and a screen reader",
    toLearn: "whether everyone can reach and understand every control",
    words: ["button", "menu", "dialog", "accessible", "accessibility", "keyboard", "label"],
  },
  {
    id: "network",
    using: "a slow or lost connection",
    toLearn: "what people see while it waits, and what happens when it fails",
    words: ["load", "sync", "offline", "network", "api", "server", "payment", "send"],
  },
  {
    id: "time",
    using: "other dates, times and time zones",
    toLearn: "whether dates read right across midnight, month ends and time zones",
    words: ["date", "time", "schedule", "calendar", "deadline", "due", "expiry", "booking"],
  },
  {
    id: "twice",
    using: "doing it twice, or at the same time in two tabs",
    toLearn: "whether repeats and clashes double anything up or lose a change",
    words: ["pay", "submit", "order", "booking", "edit", "update", "delete", "click"],
  },
];

export interface CharterIdea {
  target: string;
  using: string;
  toLearn: string;
  minutes: number;
  /** Why this one, in a short sentence. */
  why: string;
}

const cut = (v: string, max: number) => {
  const t = v.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

const plainKey = (v: string) => v.toLowerCase().replace(/\s+/g, " ").trim();

/** Words in `text`, lower case, for matching a lens. */
const wordsOf = (text: string) => new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);

/** A Given/When/Then row a story's details hold ("Given …, when …, then …"). */
function gwtRows(details: string): { given: string; when: string; then: string }[] {
  const out: { given: string; when: string; then: string }[] = [];
  const re = /given\s+(.+?)[,;]?\s+when\s+(.+?)[,;]?\s+then\s+(.+?)(?:[.\n]|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(details)) !== null) {
    out.push({ given: m[1].trim(), when: m[2].trim(), then: m[3].trim() });
  }
  return out;
}

export interface CharterAsk {
  /** What to explore (a story's title, or what was typed). */
  target: string;
  /** The story's notes, criteria and Given/When/Then, joined. */
  details?: string;
  /** Risks the story names. */
  risks?: readonly string[];
  /** Past charters' sentences, to skip repeats. */
  past?: readonly string[];
  /** How many, 1–6. */
  count?: number;
}

/**
 * Charters without AI: one per Given/When/Then row first ("Look at <then>
 * when <given> changes"), then the lenses ranked by how many of their words
 * the target, details and risks hold (ties keep the list's order), skipping
 * any a past charter already used. `count` of them (1–6, default 3), each 60
 * minutes. Always at least one.
 */
export function chartersByLenses({
  target,
  details = "",
  risks = [],
  past = [],
  count = 3,
}: CharterAsk): CharterIdea[] {
  const n = Math.min(6, Math.max(1, Math.round(Number.isFinite(count) ? count : 3)));
  const subject = cut(target, TOOL_TEXT_MAX.short) || "this part of the product";
  const pastText = past.map(plainKey).join("\n");
  const out: CharterIdea[] = [];
  const seen = new Set<string>();
  const add = (c: CharterIdea) => {
    const key = plainKey(`${c.target}|${c.using}`);
    if (seen.has(key) || out.length >= n) return;
    seen.add(key);
    out.push(c);
  };

  for (const row of gwtRows(details)) {
    add({
      target: cut(row.then, TOOL_TEXT_MAX.short),
      using: cut(`changes to ${row.given}`, TOOL_TEXT_MAX.short),
      toLearn: cut(`whether it still holds when ${row.given} is different`, 300),
      minutes: DEFAULT_SESSION_MINUTES,
      why: cut(`From the criterion: when ${row.when}`, 200),
    });
  }

  const words = wordsOf([target, details, ...risks].join(" "));
  const ranked = TEST_LENSES.map((lens, i) => ({
    lens,
    i,
    hits: lens.words.filter((w) => words.has(w)).length,
  }))
    .filter(({ lens }) => !pastText.includes(plainKey(lens.using)))
    .sort((a, b) => b.hits - a.hits || a.i - b.i);
  for (const { lens, hits } of ranked) {
    add({
      target: subject,
      using: lens.using,
      toLearn: lens.toLearn,
      minutes: DEFAULT_SESSION_MINUTES,
      why:
        hits > 0
          ? `Its words point here (${lens.words
              .filter((w) => words.has(w))
              .slice(0, 3)
              .join(", ")}).`
          : "A lens worth a look on most work.",
    });
  }
  // Every lens was used before: start the list again rather than offer none.
  if (out.length === 0) {
    const lens = TEST_LENSES[0];
    out.push({
      target: subject,
      using: lens.using,
      toLearn: lens.toLearn,
      minutes: DEFAULT_SESSION_MINUTES,
      why: "A lens worth a look on most work.",
    });
  }
  return out;
}

/* ── Forms ───────────────────────────────────────────────────────────── */

export interface CharterDraft {
  target: string;
  using: string;
  toLearn: string;
  minutes: string;
  tester: string;
  storyId: string;
  area: string;
}

export const EMPTY_CHARTER_DRAFT: CharterDraft = {
  target: "",
  using: "",
  toLearn: "",
  minutes: String(DEFAULT_SESSION_MINUTES),
  tester: "",
  storyId: "",
  area: "",
};

export interface CharterValues {
  charter: TestCharter;
  minutes: number;
  tester?: string;
  storyId?: string;
  area?: string;
}

const oneLine = (v: string) => v.replace(/\s+/g, " ").trim();

/** A session to plan: what to look at and what to learn, a length of 15–240 minutes, within the caps. */
export function validateCharter(
  draft: CharterDraft
): Validation<CharterValues, keyof CharterDraft> {
  const errors: Partial<Record<keyof CharterDraft, string>> = {};
  const target = oneLine(draft.target);
  const using = oneLine(draft.using);
  const toLearn = draft.toLearn.trim();
  const tester = oneLine(draft.tester);
  const area = oneLine(draft.area);
  if (target === "") errors.target = "Say what the session looks at.";
  else if (target.length > TOOL_TEXT_MAX.short) {
    errors.target = `Keep it to ${TOOL_TEXT_MAX.short} characters.`;
  }
  if (using.length > TOOL_TEXT_MAX.short)
    errors.using = `Keep it to ${TOOL_TEXT_MAX.short} characters.`;
  if (toLearn === "") errors.toLearn = "Say what you want to learn.";
  else if (toLearn.length > TOOL_TEXT_MAX.text) {
    errors.toLearn = `Keep it to ${TOOL_TEXT_MAX.text} characters.`;
  }
  const minutes = Number(draft.minutes);
  if (
    draft.minutes.trim() === "" ||
    !Number.isInteger(minutes) ||
    minutes < SESSION_MINUTES_MIN ||
    minutes > SESSION_MINUTES_MAX
  ) {
    errors.minutes = `Pick a length from ${SESSION_MINUTES_MIN} minutes to ${SESSION_MINUTES_MAX / 60} hours.`;
  }
  if (tester.length > TOOL_TEXT_MAX.short)
    errors.tester = `Keep it to ${TOOL_TEXT_MAX.short} characters.`;
  if (area.length > TOOL_TEXT_MAX.short)
    errors.area = `Keep it to ${TOOL_TEXT_MAX.short} characters.`;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: {
      charter: { target, ...(using ? { using } : {}), toLearn },
      minutes,
      ...(tester ? { tester } : {}),
      ...(draft.storyId ? { storyId: draft.storyId } : {}),
      ...(area ? { area } : {}),
    },
  };
}

export interface SplitDraft {
  testing: string;
  bugs: string;
  setup: string;
}

export type SessionSplit = NonNullable<TestSession["split"]>;

/** Where the time went: three whole percents that add up to 100, or all blank for none. */
export function validateSplit(
  draft: SplitDraft
): Validation<SessionSplit | null, keyof SplitDraft | "total"> {
  const keys = ["testing", "bugs", "setup"] as const;
  if (keys.every((k) => draft[k].trim() === "")) return { ok: true, values: null };
  const errors: Partial<Record<keyof SplitDraft | "total", string>> = {};
  const values = {} as SessionSplit;
  for (const k of keys) {
    const raw = draft[k].trim();
    const n = Number(raw);
    if (raw === "" || !Number.isInteger(n) || n < 0 || n > 100) {
      errors[k] = "A whole percent from 0 to 100.";
    } else values[k] = n;
  }
  if (Object.keys(errors).length === 0) {
    const total = values.testing + values.bugs + values.setup;
    if (total !== 100) errors.total = `The three add up to ${total}%: make them 100%.`;
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, values };
}

/* ── Reading stored rows ─────────────────────────────────────────────── */

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === "string" && (list as readonly string[]).includes(v);

const textOf = (v: unknown, max: number): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.trim().slice(0, max);
  return t === "" ? undefined : t;
};

function readLinks(raw: unknown): HandoffLink[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const links = raw.filter(
    (l): l is HandoffLink =>
      !!l &&
      typeof l === "object" &&
      typeof (l as HandoffLink).route === "string" &&
      typeof (l as HandoffLink).targetId === "string" &&
      typeof (l as HandoffLink).at === "string"
  );
  return links.length > 0 ? links : undefined;
}

function readNote(raw: unknown): TestSessionNote | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || r.id === "" || typeof r.at !== "string") return null;
  const text = typeof r.text === "string" ? r.text.slice(0, TOOL_TEXT_MAX.capture) : "";
  const note: TestSessionNote = {
    id: r.id,
    at: r.at,
    kind: isOneOf(TEST_NOTE_KINDS, r.kind) ? r.kind : "note",
    text,
  };
  const sentTo = readLinks(r.sentTo);
  if (sentTo) note.sentTo = sentTo;
  return note;
}

function readSplit(raw: unknown): SessionSplit | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const whole = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100;
  if (!whole(r.testing) || !whole(r.bugs) || !whole(r.setup)) return undefined;
  const split = { testing: r.testing as number, bugs: r.bugs as number, setup: r.setup as number };
  return split.testing + split.bugs + split.setup === 100 ? split : undefined;
}

/**
 * A stored row as the page shows it, or null when it can't be one (no id
 * or no charter target). Unknown values are dropped, a length outside the
 * range is brought into it, and the notes keep their caps.
 */
export function normalizeSession(raw: unknown): TestSession | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || r.id === "") return null;
  const c = (r.charter && typeof r.charter === "object" ? r.charter : {}) as Record<
    string,
    unknown
  >;
  const target = textOf(c.target, TOOL_TEXT_MAX.short);
  if (!target) return null;
  const using = textOf(c.using, TOOL_TEXT_MAX.short);
  const createdAt = typeof r.createdAt === "string" ? r.createdAt : "";
  const session: TestSession = {
    id: r.id,
    charter: {
      target,
      ...(using ? { using } : {}),
      toLearn: textOf(c.toLearn, TOOL_TEXT_MAX.text) ?? "",
    },
    minutes: clampMinutes(r.minutes) ?? DEFAULT_SESSION_MINUTES,
    status: isOneOf(TEST_SESSION_STATUSES, r.status) ? r.status : "planned",
    notes: (Array.isArray(r.notes) ? r.notes : [])
      .map(readNote)
      .filter((n): n is TestSessionNote => n !== null)
      .slice(0, TOOL_LIST_MAX.sessionNotes),
    createdAt,
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : createdAt,
  };
  const tester = textOf(r.tester, TOOL_TEXT_MAX.short);
  const area = textOf(r.area, TOOL_TEXT_MAX.short);
  const debrief = textOf(r.debrief, TOOL_TEXT_MAX.text);
  if (tester) session.tester = tester;
  if (typeof r.storyId === "string" && r.storyId !== "") session.storyId = r.storyId;
  if (area) session.area = area;
  if (typeof r.startedAt === "string") session.startedAt = r.startedAt;
  if (typeof r.endedAt === "string") session.endedAt = r.endedAt;
  if (isOneOf(TEST_SESSION_COVERAGE, r.coverage)) session.coverage = r.coverage;
  const split = readSplit(r.split);
  if (split) session.split = split;
  if (debrief) session.debrief = debrief;
  return session;
}

/** The usable rows, newest first (by when they were planned). */
export function readSessions(raw: readonly unknown[] | undefined): TestSession[] {
  return (raw ?? [])
    .map(normalizeSession)
    .filter((s): s is TestSession => s !== null)
    .map((s, i) => ({ s, i, t: Date.parse(s.createdAt) }))
    .sort((a, b) => {
      const x = Number.isFinite(a.t) ? a.t : -Infinity;
      const y = Number.isFinite(b.t) ? b.t : -Infinity;
      return x === y ? a.i - b.i : y - x;
    })
    .map((x) => x.s);
}

/** The session that is running, if any (the newest when an agent left two). */
export const runningSession = (sessions: readonly TestSession[]): TestSession | undefined =>
  sessions.find((s) => s.status === "running");

/* ── The clock ───────────────────────────────────────────────────────── */

/** When a started session's time runs out (epoch ms), or null before it starts. */
export function sessionEndsAt(session: Pick<TestSession, "startedAt" | "minutes">): number | null {
  const start = session.startedAt ? Date.parse(session.startedAt) : NaN;
  return Number.isFinite(start) ? start + session.minutes * 60_000 : null;
}

/** Whole minutes into its session a note was taken, or null when the session never started. */
export function minutesIn(
  note: Pick<TestSessionNote, "at">,
  session: Pick<TestSession, "startedAt">
): number | null {
  const start = session.startedAt ? Date.parse(session.startedAt) : NaN;
  const at = Date.parse(note.at);
  if (!Number.isFinite(start) || !Number.isFinite(at)) return null;
  return Math.max(0, Math.floor((at - start) / 60_000));
}

/** "12 min in", or "" when the session never started. */
export function minutesInText(
  note: Pick<TestSessionNote, "at">,
  session: Pick<TestSession, "startedAt">
): string {
  const m = minutesIn(note, session);
  return m === null ? "" : `${m} min in`;
}

/** Whole minutes a finished session ran, or null. */
export function minutesRan(session: Pick<TestSession, "startedAt" | "endedAt">): number | null {
  const start = session.startedAt ? Date.parse(session.startedAt) : NaN;
  const end = session.endedAt ? Date.parse(session.endedAt) : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.round((end - start) / 60_000));
}

/* ── Notes and what they become ──────────────────────────────────────── */

/** A new note, stamped `at`, its text cut to the cap. */
export function newNote(kind: TestNoteKind, text: string, id: string, at: string): TestSessionNote {
  return { id, at, kind, text: text.trim().slice(0, TOOL_TEXT_MAX.capture) };
}

/** Whether the session can take another note. */
export const canAddNote = (session: Pick<TestSession, "notes">): boolean =>
  session.notes.length < TOOL_LIST_MAX.sessionNotes;

/** The session's notes of one kind, in the order taken. */
export const notesOfKind = (
  session: Pick<TestSession, "notes">,
  kind: TestNoteKind
): TestSessionNote[] => session.notes.filter((n) => n.kind === kind);

/** How many notes of each kind. */
export function noteCounts(session: Pick<TestSession, "notes">): Record<TestNoteKind, number> {
  const out = { note: 0, bug: 0, question: 0, idea: 0 };
  for (const n of session.notes) out[n.kind] += 1;
  return out;
}

/** The note's first line, cut to a bug title's length. */
function firstLine(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  return line.replace(/\s+/g, " ").trim().slice(0, TOOL_TEXT_MAX.short);
}

/**
 * The bug a note becomes in Bug Triage: its first line as the title, the
 * whole note as what happened, the tester as who found it, the session's
 * area, and a link back to the note in its session.
 */
export function noteToBug(
  note: Pick<TestSessionNote, "id" | "text">,
  session: Pick<TestSession, "id" | "tester" | "area">
): HandoffSource {
  const description = note.text.trim();
  return {
    title: firstLine(note.text),
    ...(description ? { description } : {}),
    ...(session.tester ? { raisedBy: session.tester } : {}),
    ...(session.area ? { area: session.area } : {}),
    sourceRef: { tool: "test-sessions", id: note.id, doc: session.id },
  };
}

/** A follow-up session's charter from a question or an idea: its text as what to look at and learn. */
export function followUpFrom(
  note: Pick<TestSessionNote, "text">,
  session?: Pick<TestSession, "charter">
): TestCharter {
  const full = note.text.trim();
  return {
    target: cut(
      firstLine(note.text) || session?.charter.target || "a follow-up",
      TOOL_TEXT_MAX.short
    ),
    ...(session?.charter.using ? { using: session.charter.using } : {}),
    toLearn: full.slice(0, TOOL_TEXT_MAX.text),
  };
}

/** A note's link to its bug, when it has one (the "bug" route). */
export const bugLinkOf = (note: Pick<TestSessionNote, "sentTo">): HandoffLink | undefined =>
  (note.sentTo ?? []).find((l) => l.route === "bug");

/**
 * The session's bug notes not sent to Bug Triage yet: with no link, or one
 * whose bug is gone (`bugExists`). Notes with blank text are left out.
 */
export function unsentBugNotes(
  session: Pick<TestSession, "notes">,
  bugExists: (id: string) => boolean
): TestSessionNote[] {
  return notesOfKind(session, "bug").filter((n) => {
    if (n.text.trim() === "") return false;
    const link = bugLinkOf(n);
    return !link || !bugExists(link.targetId);
  });
}

/** A new planned session from its values, stamped now. */
export function newSession(values: CharterValues, id: string, now: string): TestSession {
  return {
    id,
    charter: values.charter,
    minutes: values.minutes,
    status: "planned",
    notes: [],
    ...(values.tester ? { tester: values.tester } : {}),
    ...(values.storyId ? { storyId: values.storyId } : {}),
    ...(values.area ? { area: values.area } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

/** The areas past sessions named, most recent first, each once (any case). */
export function pastAreas(sessions: readonly TestSession[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of sessions) {
    const a = s.area?.trim();
    if (!a || seen.has(a.toLowerCase())) continue;
    seen.add(a.toLowerCase());
    out.push(a);
  }
  return out;
}

/* ── Next steps ──────────────────────────────────────────────────────── */

/** What the rule reads from the workspace. */
export interface TestSessionsStepsInput {
  sessions: readonly TestSession[] | undefined;
  /**
   * Bug Triage's bugs, so a note whose bug was deleted counts as not sent.
   * Left out of the slices (not undefined): every link counts as sent.
   */
  bugs?: readonly { id: string }[] | undefined;
}

/** A running session this long past its end is one to finish. */
export const OVERDUE_MS = 24 * 60 * 60 * 1000;

const shortTarget = (t: string, max = 48) =>
  t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;

/**
 * Test Sessions' next steps, given the time now, for the team's own
 * sessions:
 *   1. a done session with bug notes not sent → log them in Bug Triage;
 *   2. a session still running a day past its end → finish or end it.
 */
export function testSessionsSteps(s: TestSessionsStepsInput, now: Date): NextStep[] {
  const sessions = readSessions(s.sessions).filter((x) => !isExampleId(x.id));
  const bugIds = "bugs" in s ? new Set((s.bugs ?? []).map((b) => b.id)) : null;
  const exists = (id: string) => (bugIds ? bugIds.has(id) : true);
  const steps: NextStep[] = [];

  for (const session of sessions) {
    if (session.status !== "done") continue;
    const unsent = unsentBugNotes(session, exists);
    if (unsent.length === 0) continue;
    steps.push({
      id: "test-sessions-bugs",
      label: `Log the ${unsent.length === 1 ? "bug" : `${unsent.length} bugs`} from “${shortTarget(session.charter.target)}”`,
      detail: "Send them to Bug Triage so they get a severity and a place.",
      href: `/test-sessions?session=${encodeURIComponent(session.id)}`,
    });
    break;
  }

  const t = now.getTime();
  const stuck = sessions.find((x) => {
    if (x.status !== "running") return false;
    const end = sessionEndsAt(x);
    return end !== null && t - end > OVERDUE_MS;
  });
  if (stuck) {
    steps.push({
      id: "test-sessions-stuck",
      label: `Finish or end “${shortTarget(stuck.charter.target)}”`,
      detail: "It is still running a day after its time ran out.",
      href: `/test-sessions?session=${encodeURIComponent(stuck.id)}`,
    });
  }
  return steps;
}
