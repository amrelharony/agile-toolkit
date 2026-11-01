/**
 * Story drafts kept on this device as they're typed, so a dropped signal or a
 * reload never costs any text. One per story number, and one for a story that
 * doesn't have a number yet.
 *
 * Storage can throw or come back empty (private windows, blocked site data), so
 * every access is wrapped and a failure just means no draft.
 *
 * The key sits under the `agile-toolkit:` prefix, so "Clear data on this browser"
 * removes it, and lib/data/backup.ts leaves it out of backups: it can hold
 * unreleased stories.
 */

import { toStoredPanels, type StoredPanel } from "./story-input";
import type { DialogueLine } from "./types";

const PREFIX = "agile-toolkit:comics:draft:";
export const NEW_STORY_KEY = "new";

export type DraftKey = number | typeof NEW_STORY_KEY;

export interface StoryDraft {
  title: string;
  lesson: string;
  squadQuestion: string;
  /** As typed: names separated by commas. */
  cast: string;
  themes: string[];
  /** As typed, in the datetime-local format. */
  release: string;
  panels: StoredPanel[];
  sharePath: string | null;
  /** The server copy this draft started from, to notice it changed since. */
  baseUpdatedAt: string | null;
}

export function draftStorageKey(key: DraftKey): string {
  return `${PREFIX}${key}`;
}

const isString = (v: unknown): v is string => typeof v === "string";

function parse(raw: string): StoryDraft | null {
  const value = JSON.parse(raw) as Record<string, unknown> | null;
  if (!value || typeof value !== "object") return null;
  return {
    title: isString(value.title) ? value.title : "",
    lesson: isString(value.lesson) ? value.lesson : "",
    squadQuestion: isString(value.squadQuestion) ? value.squadQuestion : "",
    cast: isString(value.cast) ? value.cast : "",
    themes: Array.isArray(value.themes) ? value.themes.filter(isString) : [],
    release: isString(value.release) ? value.release : "",
    panels: toStoredPanels(value.panels),
    sharePath: isString(value.sharePath) ? value.sharePath : null,
    baseUpdatedAt: isString(value.baseUpdatedAt) ? value.baseUpdatedAt : null,
  };
}

export function loadDraft(key: DraftKey): StoryDraft | null {
  try {
    const raw = localStorage.getItem(draftStorageKey(key));
    return raw ? parse(raw) : null;
  } catch {
    return null;
  }
}

/** False if it couldn't be kept, so the page can say so. */
export function saveDraft(key: DraftKey, draft: StoryDraft): boolean {
  try {
    localStorage.setItem(draftStorageKey(key), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(key: DraftKey): void {
  try {
    localStorage.removeItem(draftStorageKey(key));
  } catch {
    // Nothing kept, nothing to clear.
  }
}

/** Every story with a draft on this device. */
export function listDraftKeys(): DraftKey[] {
  try {
    const keys: DraftKey[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const name = localStorage.key(i);
      if (!name?.startsWith(PREFIX)) continue;
      const rest = name.slice(PREFIX.length);
      if (rest === NEW_STORY_KEY) keys.push(NEW_STORY_KEY);
      else if (/^\d+$/.test(rest)) keys.push(Number(rest));
    }
    return keys;
  } catch {
    return [];
  }
}

/** What's typed for one panel in the review queue, not saved yet. */
export interface ReviewDraft {
  alt: string;
  dialogue: DialogueLine[];
  /** The description on the server when this was typed, to notice it moved on. */
  baseAlt: string;
}

export function reviewDraftKey(ep: number, index: number): string {
  return `agile-toolkit:comics:draft-review:${ep}:${index}`;
}

/**
 * Null if there's none, or if it was typed over another description: reordering
 * the queue moves stories between numbers, so it may belong to another panel now.
 */
export function loadReviewDraft(ep: number, index: number, alt: string): ReviewDraft | null {
  try {
    const raw = localStorage.getItem(reviewDraftKey(ep, index));
    if (!raw) return null;
    const value = JSON.parse(raw) as Record<string, unknown> | null;
    if (!value || !isString(value.alt) || value.baseAlt !== alt) return null;
    const [panel] = toStoredPanels([{ dialogue: value.dialogue }]);
    return { alt: value.alt, dialogue: panel.dialogue, baseAlt: alt };
  } catch {
    return null;
  }
}

export function saveReviewDraft(ep: number, index: number, draft: ReviewDraft): boolean {
  try {
    localStorage.setItem(reviewDraftKey(ep, index), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function clearReviewDraft(ep: number, index: number): void {
  try {
    localStorage.removeItem(reviewDraftKey(ep, index));
  } catch {
    // Nothing kept, nothing to clear.
  }
}

const OPEN_KEY = "agile-toolkit:comics:draft-open";

/** Which form was open, so a reload lands back on it. Null when none was. */
export function rememberOpenStory(key: DraftKey | null): void {
  try {
    if (key === null) localStorage.removeItem(OPEN_KEY);
    else localStorage.setItem(OPEN_KEY, String(key));
  } catch {
    // A reload just lands on the list instead.
  }
}

export function readOpenStory(): DraftKey | null {
  try {
    const raw = localStorage.getItem(OPEN_KEY);
    if (raw === NEW_STORY_KEY) return NEW_STORY_KEY;
    return raw && /^\d+$/.test(raw) ? Number(raw) : null;
  } catch {
    return null;
  }
}
