/**
 * The Scrum Master Notebook's AI tasks, the lite half pages import (no zod;
 * the defs, with their schemas, are `sm-notebook.ts` and load on first AI
 * use): the tag caps, the tag task's input builder, both fallbacks and one
 * ref per task.
 */

import { lazyAiTask } from "../task-ref";
import { NOTE_BODY_MAX, NOTE_TAGS_MAX, NOTE_TITLE_MAX } from "@/lib/notebook/model";
import { weeklyFallback } from "@/lib/notebook/summary";
import { keywordTags } from "@/lib/notebook/themes";
import type {
  NotebookTagInput,
  NotebookTagOutput,
  NotebookWeeklyInput,
  NotebookWeeklyOutput,
} from "./sm-notebook";
export type {
  NotebookTagInput,
  NotebookTagOutput,
  NotebookWeeklyInput,
  NotebookWeeklyOutput,
} from "./sm-notebook";

/* ── weekly_summary ───────────────────────────────────────────────── */

// Without AI: the counts and the repeated themes (lib/notebook/summary `weeklyFallback`).
export const notebookWeeklySummaryTask = lazyAiTask<NotebookWeeklyInput, NotebookWeeklyOutput>(
  { id: "sm-notebook.weekly_summary", toolId: "sm-notebook", fallback: weeklyFallback },
  () => import("./sm-notebook").then((m) => m.notebookWeeklySummaryTask)
);

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

/** Tags without AI: the notebook's own tags the note mentions, then keyword themes. */
export const notebookTagFallback = ({
  title,
  body,
  known,
  current,
}: NotebookTagInput): NotebookTagOutput => ({
  tags: keywordTags(`${title ?? ""}\n${body}`, { known, current, max: TAG_SUGGEST_MAX }).filter(
    (t) => t.length <= TAG_SUGGEST_LEN
  ),
});

export const notebookTagTask = lazyAiTask<NotebookTagInput, NotebookTagOutput>(
  { id: "sm-notebook.tag", toolId: "sm-notebook", fallback: notebookTagFallback },
  () => import("./sm-notebook").then((m) => m.notebookTagTask)
);

/**
 * The tag task's input for a note being written: its title and text cut to
 * the caps, the tags it has, and the notebook's tags (most used first) that
 * fit. The text is required: with none, there is nothing to tag.
 */
export function notebookTagInput(
  note: { title?: string; body: string; tags: readonly string[] },
  known: readonly string[]
): NotebookTagInput {
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
