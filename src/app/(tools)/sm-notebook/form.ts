/**
 * The notebook's note form: the draft as typed, the check before saving and
 * the note it saves. A note needs its text and a day that has happened; the
 * title, tags, event and linked tool are optional. The caps are the
 * workspace schema's (lib/notebook/model), so a note the page saved is one
 * an agent can update. Text left as an agent saved it (a longer tag, an
 * event the page doesn't list, a day stamped by the server) is kept while
 * it is unchanged.
 */

import type { NotebookEntry } from "@/lib/stores/workspace-types";
import type { FormErrors, Validation } from "@/lib/utils/form";
import {
  NOTE_BODY_MAX,
  NOTE_EVENT_MAX,
  NOTE_TAGS_MAX,
  NOTE_TAG_MAX,
  NOTE_TITLE_MAX,
  isDay,
  normTags,
  parseTags,
} from "@/lib/notebook/model";
import { linkableTool } from "@/lib/notebook/tools";
import { bodyWithTemplate, type NoteTemplate } from "@/lib/notebook/templates";

export interface NoteDraft {
  /** YYYY-MM-DD; can be backdated. */
  date: string;
  title: string;
  body: string;
  /** "blockers, participation", as typed. */
  tags: string;
  /** An event id, or "" for none. */
  event: string;
  /** A tool id, or "" for none. */
  linkedTool: string;
}

export type NoteField = keyof NoteDraft;

export interface NoteValues {
  date: string;
  title: string | undefined;
  body: string;
  tags: string[];
  event: string | undefined;
  linkedTool: string | undefined;
}

export const emptyNoteDraft = (today: string): NoteDraft => ({
  date: today,
  title: "",
  body: "",
  tags: "",
  event: "",
  linkedTool: "",
});

/** A saved note as a draft. A linked tool the registry doesn't know starts as none. */
export const noteDraftFrom = (e: NotebookEntry): NoteDraft => ({
  date: e.date,
  title: e.title ?? "",
  body: e.body,
  tags: (e.tags ?? []).join(", "),
  event: e.event ?? "",
  linkedTool: linkableTool(e.linkedTool)?.id ?? "",
});

/** The draft with a template's prompts in the text, its tags added, and its event and tool where none is set. */
export function draftWithTemplate(d: NoteDraft, t: NoteTemplate): NoteDraft {
  const tags = normTags([...parseTags(d.tags), ...t.tags]);
  return {
    ...d,
    body: bodyWithTemplate(d.body, t),
    tags: tags.join(", "),
    event: d.event || t.event || "",
    linkedTool: d.linkedTool || t.linkedTool || "",
  };
}

/** The draft's tags with `tag` added (once). */
export function draftWithTag(d: NoteDraft, tag: string): NoteDraft {
  return { ...d, tags: normTags([...parseTags(d.tags), tag]).join(", ") };
}

const tooLong = (max: number) => `Keep it to ${max} characters or fewer.`;

/** Why a typed day can't be the note's, or null. A saved day left as it is stays valid. */
export function noteDayError(day: string, today: string, kept?: string): string | null {
  if (kept !== undefined && day === kept) return null;
  if (!day.trim()) return "Pick the day the note is about.";
  if (!isDay(day)) return "Pick a date from the calendar.";
  if (day > today) return "It can't be about a day that hasn't happened yet.";
  return null;
}

/** Check a note. `stored` is the saved note when editing. */
export function validateNote(
  d: NoteDraft,
  today: string,
  stored?: NotebookEntry
): Validation<NoteValues, NoteField> {
  const errors: FormErrors<NoteField> = {};
  const body = d.body.trim();
  const title = d.title.trim();
  const event = d.event.trim();
  const tags = parseTags(d.tags);
  const keptTags = new Set(normTags(stored?.tags ?? []));

  if (!body) errors.body = "Write what you saw or tried.";
  else if (body.length > NOTE_BODY_MAX && body !== stored?.body.trim()) {
    errors.body = tooLong(NOTE_BODY_MAX);
  }
  if (title.length > NOTE_TITLE_MAX && title !== (stored?.title ?? "").trim()) {
    errors.title = tooLong(NOTE_TITLE_MAX);
  }
  const dayError = noteDayError(d.date, today, stored?.date);
  if (dayError) errors.date = dayError;
  if (tags.length > NOTE_TAGS_MAX) {
    errors.tags = `Keep it to ${NOTE_TAGS_MAX} tags or fewer.`;
  } else if (tags.some((t) => t.length > NOTE_TAG_MAX && !keptTags.has(t))) {
    errors.tags = `Keep each tag to ${NOTE_TAG_MAX} characters or fewer.`;
  }
  if (event.length > NOTE_EVENT_MAX && event !== (stored?.event ?? "").trim()) {
    errors.event = tooLong(NOTE_EVENT_MAX);
  }
  const tool = d.linkedTool ? linkableTool(d.linkedTool) : undefined;
  if (d.linkedTool && !tool) errors.linkedTool = "Pick a tool from the list.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: {
      date: d.date,
      title: title || undefined,
      body,
      tags,
      event: event || undefined,
      linkedTool: tool?.id,
    },
  };
}

/** The note saved with checked values; other keys (where it was sent, its times) are kept. */
export function applyNoteValues(e: NotebookEntry, v: NoteValues, now: string): NotebookEntry {
  const next: NotebookEntry = { ...e, date: v.date, body: v.body, tags: v.tags, updatedAt: now };
  if (!next.createdAt) next.createdAt = now;
  for (const key of ["title", "event", "linkedTool"] as const) {
    const value = v[key];
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return next;
}

/** Whether saving `v` would change `e` (its times aside). */
export function noteChanged(e: NotebookEntry, v: NoteValues): boolean {
  return (
    e.date !== v.date ||
    e.body !== v.body ||
    (e.title ?? undefined) !== v.title ||
    (e.event ?? undefined) !== v.event ||
    (e.linkedTool ?? undefined) !== v.linkedTool ||
    normTags(e.tags ?? []).join("\u0000") !== v.tags.join("\u0000")
  );
}
