/**
 * Team Mood Tracker — tool-local actions.
 *
 * Category: Outcomes & Pulse (squad S6)
 * Agent surface: tool.mood_tracker.*
 * Backing CRUD : workspace.mood_entry.* (named check-ins), workspace.mood_pulse.*
 *                (anonymous pulses) and workspace.mood_tracker_doc.* (the
 *                settings singleton, MOOD_TRACKER_ID).
 *
 *   1. list_state   — the window's average, faces, check-ins and the
 *                     low-mood streak, as the page shows them.
 *   2. record       — a person's check-in for a day (one per person per day).
 *   3. record_pulse — an anonymous pulse: how many picked each face.
 *   4. remove       — a person's check-in for a day.
 *   5. remove_pulse — a pulse.
 *
 * Every number comes from lib/team/mood, which the page, the retro's facts
 * and Sprint Comparison share: named check-ins and pulse answers count the
 * same, the average shows from MIN_SAMPLE.average check-ins (null, never 0,
 * below that), and a streak is the team's, never a person's. In the
 * anonymous mode nothing per person is returned or recorded.
 */

import { z } from "zod";
import { nanoid } from "nanoid";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  serverDeleteEntity,
  serverGetEntity,
  serverListEntities,
  serverUpsertEntity,
} from "../server-store";
import { todayLocalISO } from "@/lib/utils/formatters";
import {
  MOOD_PULSE_KIND,
  MOOD_TRACKER_ID,
  MOOD_TRACKER_KIND,
  type MoodEntry,
  type MoodPulse,
  type MoodTrackerDoc,
  type TeamMember,
} from "@/lib/stores/workspace-types";
import { addDays, dayOf } from "@/lib/impediments/model";
import {
  MOOD_NOTE_MAX,
  MOOD_WINDOW_DAYS,
  checkInFor,
  checkPulseCounts,
  lowMoodStreak,
  moodDateProblem,
  moodMode,
  moodSummary,
  realEntries,
  realPulses,
  streakLinks,
  upsertCheckIn,
  type MoodScore,
} from "@/lib/team/mood";

const KIND_MOOD = "workspace:moodEntry";
const KIND_TEAM = "workspace:teamMember";

const ws = () => useWorkspaceStore.getState();

interface MoodStore {
  entries(): Promise<MoodEntry[]>;
  pulses(): Promise<MoodPulse[]>;
  settings(): Promise<MoodTrackerDoc | null>;
  roster(): Promise<TeamMember[]>;
  putEntry(e: MoodEntry): Promise<void>;
  removeEntry(id: string): Promise<void>;
  putPulse(p: MoodPulse): Promise<void>;
  removePulse(id: string): Promise<void>;
}

const browserStore: MoodStore = {
  entries: async () => ws().moodEntries ?? [],
  pulses: async () => ws().moodPulses ?? [],
  settings: async () => (ws().moodTrackerDocs ?? []).find((d) => d.id === MOOD_TRACKER_ID) ?? null,
  roster: async () => ws().teamMembers ?? [],
  putEntry: async (e) => ws().upsertMoodEntry(e),
  removeEntry: async (id) => ws().removeMoodEntry(id),
  putPulse: async (p) => ws().upsertMoodPulse(p),
  removePulse: async (id) => ws().removeMoodPulse(id),
};

function serverStore(userId: string): MoodStore {
  return {
    entries: () => serverListEntities<MoodEntry>(userId, KIND_MOOD),
    pulses: () => serverListEntities<MoodPulse>(userId, MOOD_PULSE_KIND),
    settings: async () =>
      (await serverGetEntity<MoodTrackerDoc>(userId, MOOD_TRACKER_KIND, MOOD_TRACKER_ID)) ?? null,
    roster: () => serverListEntities<TeamMember>(userId, KIND_TEAM),
    putEntry: async (e) => {
      await serverUpsertEntity<MoodEntry>(userId, KIND_MOOD, e);
    },
    removeEntry: (id) => serverDeleteEntity(userId, KIND_MOOD, id),
    putPulse: async (p) => {
      await serverUpsertEntity<MoodPulse>(userId, MOOD_PULSE_KIND, p);
    },
    removePulse: (id) => serverDeleteEntity(userId, MOOD_PULSE_KIND, id),
  };
}

/* ── list_state ─────────────────────────────────────────────────────── */

const round2 = (n: number) => Math.round(n * 100) / 100;

async function listState(store: MoodStore, days: number) {
  const [entries, pulses, settings, roster] = await Promise.all([
    store.entries(),
    store.pulses(),
    store.settings(),
    store.roster(),
  ]);
  const mode = moodMode(settings);
  const end = todayLocalISO();
  const start = addDays(end, -(days - 1));
  const summary = moodSummary(entries, pulses, start, end);
  const streak = lowMoodStreak(entries, pulses, end, { windowDays: days });
  const inWindow = realEntries(entries).filter((e) => {
    const d = dayOf(e.date);
    return d !== null && d >= start && d <= end;
  });
  const byMember =
    mode === "named"
      ? Array.from(
          inWindow.reduce((map, e) => {
            const m = map.get(e.memberId) ?? { sum: 0, count: 0 };
            map.set(e.memberId, { sum: m.sum + e.score, count: m.count + 1 });
            return map;
          }, new Map<string, { sum: number; count: number }>())
        ).map(([memberId, m]) => ({
          memberId,
          name: roster.find((r) => r.id === memberId)?.name ?? null,
          average: round2(m.sum / m.count),
          count: m.count,
        }))
      : [];
  const pulsesInWindow = realPulses(pulses).filter((p) => p.date >= start && p.date <= end);
  return {
    mode,
    window: { start, end, days },
    average: summary.average,
    checkIns: summary.checkIns,
    // Kept under the name the action always returned.
    total: summary.checkIns,
    people: summary.people,
    anonymous: summary.anonymous ?? 0,
    daysWithCheckIns: summary.days,
    distribution: summary.distribution,
    byMember,
    pulses: pulsesInWindow.map((p) => ({
      id: p.id,
      date: p.date,
      counts: p.counts,
      source: p.source,
    })),
    streak,
    // The page's rule: the run counts as sent when a saved streak overlaps it.
    streakSent: streak ? (streakLinks(settings, streak) ?? []).length > 0 : false,
  };
}

registry.register({
  id: "tool.mood_tracker.list_state",
  toolId: "tool.mood_tracker",
  name: "list_state",
  category: "read",
  description: `Summarise team mood over the last days, as the page shows it. Params: {days?: 1-90 (default ${MOOD_WINDOW_DAYS})}. Returns {mode: named|anonymous, window: {start, end, days}, average: 1-5 to one decimal | null (null below 3 check-ins; never 0), checkIns (named check-ins plus anonymous pulse answers), total (= checkIns), people (who checked in by name), anonymous (pulse answers), daysWithCheckIns, distribution: {1..5 counts}, byMember: {memberId, name, average, count}[] (named mode only; [] when anonymous), pulses: {id, date, counts, source}[], streak: {start, end, runStart (its first low day, which may be before the window), days, average, checkIns} | null (the team's current run of days averaging 2.5 or less, from 3 such days, each with 3 or more check-ins), streakSent (already raised at the retro: a sent streak overlaps the run)}. Placeholder and example rows are left out.`,
  paramsSchema: z.object({ days: z.number().int().min(1).max(90).optional() }),
  handler: (params) => listState(browserStore, params.days ?? MOOD_WINDOW_DAYS),
  mcpHandler: (params, ctx) => listState(serverStore(ctx.userId), params.days ?? MOOD_WINDOW_DAYS),
});

/* ── record ─────────────────────────────────────────────────────────── */

const recordParams = z.object({
  memberId: z.string().describe("A team member's id (the Team page roster)."),
  score: z.number().int().min(1).max(5).describe("1 rough … 5 great."),
  note: z.string().max(MOOD_NOTE_MAX).optional(),
  date: z
    .string()
    .optional()
    .describe(
      "YYYY-MM-DD the check-in is for (backfill a past day; never a future one). Default today."
    ),
});

/**
 * The latest day a check-in or pulse may be for. In the browser, today; on
 * the server, whose day (UTC on a typical deploy) isn't the user's, the day
 * after it, so a user ahead of UTC can log their own today.
 */
const latestDay = (today: string, onServer: boolean) => (onServer ? addDays(today, 1) : today);

async function record(store: MoodStore, params: z.infer<typeof recordParams>, onServer: boolean) {
  const today = todayLocalISO();
  const date = params.date ?? today;
  const dateProblem = moodDateProblem(date, latestDay(today, onServer));
  if (dateProblem) return { added: false, reason: dateProblem };
  const [settings, roster, entries] = await Promise.all([
    store.settings(),
    store.roster(),
    store.entries(),
  ]);
  if (moodMode(settings) === "anonymous") {
    return {
      added: false,
      reason:
        "The team checks in anonymously, so named check-ins aren't recorded. Use record_pulse with the counts instead.",
    };
  }
  if (!roster.some((m) => m.id === params.memberId)) {
    return { added: false, reason: `No team member with id "${params.memberId}" on the roster.` };
  }
  const { entry, replaced } = upsertCheckIn(
    entries,
    { memberId: params.memberId, date, score: params.score as MoodScore, note: params.note },
    { id: `mood_${nanoid(8)}`, today, now: new Date().toISOString() }
  );
  await store.putEntry(entry);
  return { added: true, id: entry.id, date, replaced: replaced !== null };
}

registry.register({
  id: "tool.mood_tracker.record",
  toolId: "tool.mood_tracker",
  name: "record",
  category: "write",
  requiresConfirmation: false,
  description:
    "Record a team member's mood check-in (1 rough … 5 great) for a day: one per person per day, so a second one for the same day replaces it. Params: {memberId (must be on the roster), score (whole number 1-5), note? (≤500), date?: YYYY-MM-DD (a past day backfills; never a future day; pass the user's local date: the default 'today' is the server's (UTC) day over MCP, and the day after it is still accepted)}. Refused in the anonymous mode. Returns {added: true, id, date, replaced} or {added: false, reason}.",
  paramsSchema: recordParams,
  handler: (params) => record(browserStore, params, false),
  mcpHandler: (params, ctx) => record(serverStore(ctx.userId), params, true),
});

/* ── record_pulse ───────────────────────────────────────────────────── */

const pulseParams = z.object({
  date: z
    .string()
    .optional()
    .describe("YYYY-MM-DD the pulse is for (default today; never a future day)."),
  counts: z
    .object({
      1: z.number().int().min(0).max(999).optional(),
      2: z.number().int().min(0).max(999).optional(),
      3: z.number().int().min(0).max(999).optional(),
      4: z.number().int().min(0).max(999).optional(),
      5: z.number().int().min(0).max(999).optional(),
    })
    .describe("How many picked each face, 1 rough … 5 great (blank = 0)."),
});

async function recordPulse(
  store: MoodStore,
  params: z.infer<typeof pulseParams>,
  onServer: boolean
) {
  const today = todayLocalISO();
  const date = params.date ?? today;
  const dateProblem = moodDateProblem(date, latestDay(today, onServer));
  if (dateProblem) return { added: false, reason: dateProblem };
  const checked = checkPulseCounts(params.counts as Partial<Record<string, number>>);
  if (!checked.ok) return { added: false, reason: checked.reason };
  const pulse: MoodPulse = {
    id: `moodPulse_${nanoid(8)}`,
    date,
    counts: checked.counts,
    source: "facilitator",
    createdAt: new Date().toISOString(),
  };
  await store.putPulse(pulse);
  return { added: true, id: pulse.id, answers: checked.total };
}

registry.register({
  id: "tool.mood_tracker.record_pulse",
  toolId: "tool.mood_tracker",
  name: "record_pulse",
  category: "write",
  requiresConfirmation: false,
  description:
    "Record an anonymous team mood pulse, counted by hand: totals only, never who. Params: {date?: YYYY-MM-DD (default today; never a future day; pass the user's local date: over MCP the default is the server's (UTC) day, and the day after it is still accepted), counts: {1..5: how many picked each face}}. Needs at least 3 answers in all (as the page's count entry), so no one's mood can be singled out. Works in either mode. Returns {added: true, id, answers} or {added: false, reason}.",
  paramsSchema: pulseParams,
  handler: (params) => recordPulse(browserStore, params, false),
  mcpHandler: (params, ctx) => recordPulse(serverStore(ctx.userId), params, true),
});

/* ── remove / remove_pulse ──────────────────────────────────────────── */

async function remove(store: MoodStore, memberId: string, date: string) {
  const entry = checkInFor(await store.entries(), memberId, date);
  if (!entry) return { removed: false };
  await store.removeEntry(entry.id);
  return { removed: true, id: entry.id };
}

registry.register({
  id: "tool.mood_tracker.remove",
  toolId: "tool.mood_tracker",
  name: "remove",
  category: "write",
  requiresConfirmation: false,
  description:
    "Remove a team member's check-in for a day. Params: {memberId, date: YYYY-MM-DD}. The page offers Undo; an agent's removal is final, so confirm with the user first. Returns {removed: true, id} or {removed: false} when there is none.",
  paramsSchema: z.object({
    memberId: z.string(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  handler: (params) => remove(browserStore, params.memberId, params.date),
  mcpHandler: (params, ctx) => remove(serverStore(ctx.userId), params.memberId, params.date),
});

async function removePulse(store: MoodStore, id: string) {
  if (!(await store.pulses()).some((p) => p.id === id)) return { removed: false };
  await store.removePulse(id);
  return { removed: true };
}

registry.register({
  id: "tool.mood_tracker.remove_pulse",
  toolId: "tool.mood_tracker",
  name: "remove_pulse",
  category: "write",
  requiresConfirmation: false,
  description:
    "Remove an anonymous pulse by id (from list_state). The page offers Undo; an agent's removal is final, so confirm with the user first. Returns {removed: true} or {removed: false} for an unknown id.",
  paramsSchema: z.object({ id: z.string() }),
  handler: (params) => removePulse(browserStore, params.id),
  mcpHandler: (params, ctx) => removePulse(serverStore(ctx.userId), params.id),
});
