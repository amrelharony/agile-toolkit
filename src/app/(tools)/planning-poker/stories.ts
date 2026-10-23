/**
 * Planning Poker: adding, editing and deleting stories in the queue.
 *
 * Pure session updaters for `onUpdateSession`, so the host's edits reach
 * the room through the usual `setSession` broadcast. The caps match what
 * `isValidSession` accepts: a story past them would make every guest drop
 * the whole session.
 */

import type { Validation } from "@/lib/utils/form";
import type { Session, Story } from "./types";

/** Longest story title `isValidSession` accepts. */
export const STORY_TITLE_MAX = 500;
/** Longest story description `isValidSession` accepts. */
export const STORY_DESCRIPTION_MAX = 5000;
/** Most stories `isValidSession` accepts. */
export const MAX_STORIES = 500;

export const QUEUE_FULL = `The story queue is full (${MAX_STORIES} stories).`;

/** The host's add-story form, as typed. */
export interface StoryDraft {
  title: string;
  description: string;
}

export const EMPTY_STORY_DRAFT: StoryDraft = { title: "", description: "" };

/**
 * Check a new story. Enter on an empty title used to do nothing at all;
 * now it says so, and so does a full queue (that was a toast, away from
 * the box being typed in).
 */
export function validateStory(d: StoryDraft, storyCount: number): Validation<StoryDraft, "title"> {
  const title = d.title.trim();
  if (!title) return { ok: false, errors: { title: "Enter a story title." } };
  if (storyCount >= MAX_STORIES) return { ok: false, errors: { title: QUEUE_FULL } };
  return { ok: true, values: { title, description: d.description.trim() } };
}

/** A story with no estimate yet. Title and description are trimmed and capped. */
export function newStory(title: string, description?: string): Story {
  const desc = description?.trim().slice(0, STORY_DESCRIPTION_MAX);
  return {
    id: crypto.randomUUID(),
    title: title.trim().slice(0, STORY_TITLE_MAX),
    ...(desc ? { description: desc } : {}),
    finalEstimate: null,
  };
}

/** Stories added to the end of the queue, as many as still fit. */
export function appendStories(s: Session, added: Story[]): Session {
  const room = Math.max(0, MAX_STORIES - s.stories.length);
  if (room === 0 || added.length === 0) return s;
  return { ...s, stories: [...s.stories, ...added.slice(0, room)] };
}

/** A story's new title and description. "" (or none) removes the description. */
export function editStory(
  s: Session,
  id: string,
  next: { title: string; description?: string }
): Session {
  const title = next.title.trim().slice(0, STORY_TITLE_MAX);
  if (!title) return s;
  const description = next.description?.trim().slice(0, STORY_DESCRIPTION_MAX);
  return {
    ...s,
    stories: s.stories.map((st) => {
      if (st.id !== id) return st;
      const edited: Story = { ...st, title, description };
      if (!description) delete edited.description;
      return edited;
    }),
  };
}

/**
 * The queue without story `id`. The story being estimated stays current.
 * Deleting the current story drops its round (votes and reveal), and the
 * story after it (or before it, at the end) becomes current.
 */
export function removeStory(s: Session, id: string): Session {
  const idx = s.stories.findIndex((st) => st.id === id);
  if (idx === -1) return s;
  const stories = s.stories.filter((_, i) => i !== idx);
  if (idx < s.currentStoryIdx) return { ...s, stories, currentStoryIdx: s.currentStoryIdx - 1 };
  if (idx > s.currentStoryIdx) return { ...s, stories };
  return {
    ...s,
    stories,
    currentStoryIdx: Math.min(idx, Math.max(0, stories.length - 1)),
    revealed: false,
    participants: s.participants.map((p) => (p.vote === null ? p : { ...p, vote: null })),
  };
}

/**
 * Undo for `removeStory`: the story back at `index` (or the end, if the
 * queue is shorter now). The current story stays current, unless the one
 * restored was current and nobody has voted on its replacement yet: then it
 * is current again. Its old votes don't come back.
 */
export function restoreStory(
  s: Session,
  story: Story,
  index: number,
  wasCurrent: boolean
): Session {
  if (s.stories.some((st) => st.id === story.id)) return s;
  if (s.stories.length >= MAX_STORIES) return s;
  const at = Math.min(Math.max(0, index), s.stories.length);
  const stories = [...s.stories.slice(0, at), story, ...s.stories.slice(at)];
  const roundUntouched = !s.revealed && s.participants.every((p) => p.vote === null);
  if (wasCurrent && roundUntouched) return { ...s, stories, currentStoryIdx: at };
  const shift = s.stories.length > 0 && at <= s.currentStoryIdx;
  return { ...s, stories, currentStoryIdx: s.currentStoryIdx + (shift ? 1 : 0) };
}
