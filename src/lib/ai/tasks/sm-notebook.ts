/**
 * The Scrum Master Notebook's AI tasks, browser-safe half (the prompts are in
 * `sm-notebook.server.ts`):
 *
 *   - `sm-notebook.weekly_summary`: a week's notes (at most 60, each cut to
 *     800 characters by weeklyInput) → a short summary, up to 5 patterns and
 *     up to 5 toolkit tools to try. The tools come back as registry ids;
 *     the page and Amr's actions keep only the ids getToolById knows
 *     (lib/notebook/tools resolveSuggestedTools), so a model's guess never
 *     becomes a link. Without AI: the counts and the repeated themes.
 *   - `sm-notebook.tag`: one note → up to 5 tags. Without AI: the notebook's
 *     own tags the note mentions, then keyword themes.
 *
 * Nothing here writes: the page shows the answer, and the person keeps what
 * they choose through the workspace store.
 */

import { z } from "zod";
import { defineAiTask, type AiTaskInput } from "../define-task";
import { NOTE_BODY_MAX, NOTE_TAGS_MAX, NOTE_TITLE_MAX } from "@/lib/notebook/model";
import {
  WEEKLY_BODY_MAX,
  WEEKLY_EVENT_MAX,
  WEEKLY_MAX_NOTES,
  WEEKLY_PATTERNS_MAX,
  WEEKLY_PATTERN_MAX,
  WEEKLY_SUMMARY_MAX,
  WEEKLY_TAGS_MAX,
  WEEKLY_TAG_MAX,
  WEEKLY_TITLE_MAX,
  WEEKLY_TOOLS_MAX,
  WEEKLY_TOOL_MAX,
  WEEKLY_WHY_MAX,
  weeklyFallback,
} from "@/lib/notebook/summary";
import { keywordTags } from "@/lib/notebook/themes";

const Day = z
  .string()
  .max(10)
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

/* ── weekly_summary ───────────────────────────────────────────────── */

const weeklyNote = z.object({
  date: Day,
  title: z.string().max(WEEKLY_TITLE_MAX).optional(),
  body: z.string().trim().min(1).max(WEEKLY_BODY_MAX),
  tags: z.array(z.string().max(WEEKLY_TAG_MAX)).max(WEEKLY_TAGS_MAX),
  event: z.string().max(WEEKLY_EVENT_MAX).optional(),
  linkedTool: z.string().max(WEEKLY_TOOL_MAX).optional(),
});

const weeklyInputSchema = z.object({
  weekStart: Day,
  notes: z.array(weeklyNote).min(1).max(WEEKLY_MAX_NOTES),
});

const weeklyOutputSchema = z.object({
  summary: z.string().trim().min(1).max(WEEKLY_SUMMARY_MAX),
  patterns: z.array(z.string().trim().min(1).max(WEEKLY_PATTERN_MAX)).max(WEEKLY_PATTERNS_MAX),
  tools: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(60),
        why: z.string().trim().min(1).max(WEEKLY_WHY_MAX),
      })
    )
    .max(WEEKLY_TOOLS_MAX),
});

export const notebookWeeklySummaryTask = defineAiTask({
  id: "sm-notebook.weekly_summary",
  toolId: "sm-notebook",
  tier: "full",
  effort: "low",
  maxTokens: 6144,
  input: weeklyInputSchema,
  output: weeklyOutputSchema,
  fallback: weeklyFallback,
  sample: {
    weekStart: "2026-11-09",
    notes: [
      {
        date: "2026-11-09",
        title: "Waiting on the payments sandbox",
        body: "Second day the payments story is blocked on sandbox access. The team waits instead of asking.",
        tags: ["blockers"],
        event: "daily-scrum",
        linkedTool: "impediments",
      },
      {
        date: "2026-11-10",
        body: "The two newest developers gave one-line updates while the same two people talked for most of it.",
        tags: ["participation"],
        event: "daily-scrum",
      },
      {
        date: "2026-11-11",
        title: "Estimates swing widely",
        body: "Two stories got 3 and 13. The gap came from different ideas of the test work.",
        tags: ["estimation"],
        event: "refinement",
      },
      {
        date: "2026-11-12",
        body: "The API change from the other team landed late again; two stories are blocked on their release.",
        tags: ["blockers", "dependencies"],
        event: "daily-scrum",
      },
    ],
  },
});

/* ── tag ──────────────────────────────────────────────────────────── */

/** A note's text a tag suggestion reads, at most. */
export const TAG_BODY_MAX = 2000;
/** The notebook's tags it may reuse, at most (most used first). */
export const TAG_KNOWN_MAX = 40;
/** Each tag sent, at most; longer ones aren't sent. */
export const TAG_SENT_MAX = 60;
/** The answer: at most 5 tags of at most 40 characters. */
export const TAG_SUGGEST_MAX = 5;
export const TAG_SUGGEST_LEN = 40;

const tagInputSchema = z.object({
  title: z.string().max(NOTE_TITLE_MAX).optional(),
  body: z.string().trim().min(1).max(TAG_BODY_MAX),
  known: z.array(z.string().max(TAG_SENT_MAX)).max(TAG_KNOWN_MAX),
  current: z.array(z.string().max(TAG_SENT_MAX)).max(NOTE_TAGS_MAX),
});

const tagOutputSchema = z.object({
  tags: z.array(z.string().trim().min(1).max(TAG_SUGGEST_LEN)).max(TAG_SUGGEST_MAX),
});

export const notebookTagTask = defineAiTask({
  id: "sm-notebook.tag",
  toolId: "sm-notebook",
  tier: "flash",
  effort: "low",
  maxTokens: 4096,
  input: tagInputSchema,
  output: tagOutputSchema,
  fallback: ({ title, body, known, current }) => ({
    tags: keywordTags(`${title ?? ""}\n${body}`, { known, current, max: TAG_SUGGEST_MAX }).filter(
      (t) => t.length <= TAG_SUGGEST_LEN
    ),
  }),
  sample: {
    title: "Quiet Daily Scrum",
    body: "Two people gave one-line updates again and nobody asked them anything. The payments story is still blocked on sandbox access.",
    known: ["blockers", "participation", "estimation"],
    current: [],
  },
});

/**
 * The tag task's input for a note being written: its title and text cut to
 * the caps, the tags it has, and the notebook's tags (most used first) that
 * fit. The text is required: with none, there is nothing to tag.
 */
export function notebookTagInput(
  note: { title?: string; body: string; tags: readonly string[] },
  known: readonly string[]
): AiTaskInput<typeof notebookTagTask> {
  const fit = (tags: readonly string[], max: number) =>
    tags.filter((t) => t.length <= TAG_SENT_MAX).slice(0, max);
  const title = note.title?.trim().slice(0, NOTE_TITLE_MAX);
  return {
    ...(title ? { title } : {}),
    body: note.body.trim().slice(0, Math.min(TAG_BODY_MAX, NOTE_BODY_MAX)),
    known: fit(known, TAG_KNOWN_MAX),
    current: fit(note.tags, NOTE_TAGS_MAX),
  };
}
