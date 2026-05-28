/**
 * Team Mood Tracker — tool-local actions.
 *
 * Category: Outcomes & Pulse (squad S6)
 * Agent surface: tool.mood_tracker.*
 * Backing CRUD : workspace.mood_entry.* (auto-generated).
 *
 *   1. list_state — average mood + 1–5 distribution + per-member averages,
 *      excluding note-first placeholder rows (which carry no real score).
 *   2. record     — log a mood score for a member (auto id + date).
 *
 * Entity kind "workspace:moodEntry" (camelCase via kindFromToolId) matches
 * the browser sync engine so MCP writes round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverListEntities, serverUpsertEntity } from "../server-store";
import type { MoodEntry } from "@/lib/stores/workspace-types";

const KIND_MOOD = "workspace:moodEntry";

const ws = () => useWorkspaceStore.getState();

const round2 = (n: number) => Math.round(n * 100) / 100;

function summarize(entries: MoodEntry[]) {
  // Placeholder rows (note typed before a face was picked) carry a stand-in
  // score and must be excluded from averages + distribution.
  const real = entries.filter((e) => !e.isPlaceholder);
  const distribution: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const perMember = new Map<string, { sum: number; count: number }>();
  for (const e of real) {
    if (e.score >= 1 && e.score <= 5) distribution[e.score] += 1;
    const m = perMember.get(e.memberId) ?? { sum: 0, count: 0 };
    m.sum += e.score;
    m.count += 1;
    perMember.set(e.memberId, m);
  }
  const sum = real.reduce((a, e) => a + e.score, 0);
  return {
    total: real.length,
    average: real.length ? round2(sum / real.length) : 0,
    distribution,
    byMember: Array.from(perMember.entries()).map(([memberId, m]) => ({
      memberId,
      average: round2(m.sum / m.count),
      count: m.count,
    })),
  };
}

// ──────── tool.mood_tracker.list_state ────────
registry.register({
  id: "tool.mood_tracker.list_state",
  toolId: "tool.mood_tracker",
  name: "list_state",
  category: "read",
  description:
    "Summarise team mood. Returns {total (real entries), average (1–5), distribution: {1..5 counts}, byMember: {memberId, average, count}[]}. Placeholder (note-first) rows are excluded.",
  paramsSchema: z.object({}),
  handler: async () => summarize(ws().moodEntries ?? []),
  mcpHandler: async (_params, ctx) => {
    const items = await serverListEntities<MoodEntry>(ctx.userId, KIND_MOOD);
    return summarize(items);
  },
});

// ──────── tool.mood_tracker.record ────────
registry.register({
  id: "tool.mood_tracker.record",
  toolId: "tool.mood_tracker",
  name: "record",
  category: "write",
  requiresConfirmation: false,
  description:
    "Record a mood score (1 rough … 5 great) for a team member. date defaults to today. Returns {added: true, id}.",
  paramsSchema: z.object({
    memberId: z.string(),
    score: z.number().int().min(1).max(5),
    note: z.string().optional(),
    date: z.string().optional(),
  }),
  handler: async (params) => {
    const entry: MoodEntry = {
      id: crypto.randomUUID(),
      memberId: params.memberId,
      score: params.score as MoodEntry["score"],
      note: params.note,
      date: params.date ?? new Date().toISOString().slice(0, 10),
    };
    ws().upsertMoodEntry(entry);
    return { added: true, id: entry.id };
  },
  mcpHandler: async (params, ctx) => {
    const entry: MoodEntry = {
      id: crypto.randomUUID(),
      memberId: params.memberId,
      score: params.score as MoodEntry["score"],
      note: params.note,
      date: params.date ?? new Date().toISOString().slice(0, 10),
    };
    await serverUpsertEntity<MoodEntry>(ctx.userId, KIND_MOOD, entry);
    return { added: true, id: entry.id };
  },
});
