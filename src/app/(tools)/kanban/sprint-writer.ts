/**
 * Where the Sprint board's changes go. The board writes the shared stories,
 * which the cockpit, Burndown, the standup and agents read; the example
 * board writes an in-memory copy, so a visitor can move stories around
 * without one example story reaching their sprint.
 *
 * Both read the story at the moment they write (never a render's copy that
 * may be stale), as lib/sprints/store.ts does.
 */

import { createStore, type StoreApi } from "zustand/vanilla";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { BlockSpell, Sprint, Story, StoryStatus } from "@/lib/stores/workspace-types";
import { setStoryBlocked, setStoryDodCheck, setStoryStatus } from "@/lib/sprints/store";
import { withStoryBlocked, withStoryStatus } from "@/lib/sprints/story-status";
import { withStoryDodCheck } from "@/lib/dod/model";
import { withSpellNote, type SpellNote } from "@/lib/flow/block-stamps";

export interface SprintBoardWriter {
  /** The story as stored right now. */
  story(id: string): Story | undefined;
  /** Move a story, stamping its flow times and history (`setStoryStatus`). */
  setStatus(id: string, status: StoryStatus): void;
  setBlocked(id: string, blocked: boolean): void;
  /** Set or clear (empty name) who is working on it. */
  setOwner(id: string, owner: string): void;
  /** Tick or untick a Definition-of-Done criterion on its card (`setStoryDodCheck`). */
  setDodCheck(id: string, criterionId: string, checked: boolean): void;
  /** Put a story back as given (an Undo). */
  restore(story: Story): void;
  /**
   * Write why it is blocked on one of its blocked spells (`withSpellNote`:
   * the open one by default; a block from before tracking gets one from
   * now). False when nothing was written.
   */
  setBlockNote(id: string, note: SpellNote, opts?: { spellFrom?: string; at?: string }): boolean;
  /** Put its blocked spells back as they were (an Undo of a note). */
  setBlockLog(id: string, log: BlockSpell[] | undefined): void;
}

/** `story` with `log` as its blocked spells, or none. */
function withBlockLog(story: Story, log: BlockSpell[] | undefined): Story {
  const next: Story = { ...story };
  if (log === undefined) delete next.blockLog;
  else next.blockLog = log;
  return next;
}

/** `story` with `owner` set, or without one for a blank name. */
export function withOwner(story: Story, owner: string): Story {
  const name = owner.trim();
  if ((story.owner ?? "") === name) return story;
  const next: Story = { ...story };
  if (name) next.owner = name;
  else delete next.owner;
  return next;
}

const liveStory = (id: string) => useWorkspaceStore.getState().stories.find((s) => s.id === id);

/** The shared workspace. Moves go only through `setStoryStatus`. */
export const liveSprintWriter: SprintBoardWriter = {
  story: liveStory,
  setStatus: (id, status) => {
    setStoryStatus(id, status);
  },
  setBlocked: (id, blocked) => {
    setStoryBlocked(id, blocked);
  },
  setOwner: (id, owner) => {
    const current = liveStory(id);
    if (!current) return;
    const next = withOwner(current, owner);
    if (next !== current) useWorkspaceStore.getState().upsertStory(next);
  },
  setDodCheck: (id, criterionId, checked) => {
    setStoryDodCheck(id, criterionId, checked);
  },
  restore: (story) => useWorkspaceStore.getState().upsertStory(story),
  setBlockNote: (id, note, opts) => {
    const current = liveStory(id);
    if (!current) return false;
    const next = withSpellNote(current, note, opts);
    if (!next || next === current) return false;
    // The log differs from the stored one, so the store keeps it as written.
    useWorkspaceStore.getState().upsertStory(next);
    return true;
  },
  setBlockLog: (id, log) => {
    const current = liveStory(id);
    if (current) useWorkspaceStore.getState().upsertStory(withBlockLog(current, log));
  },
};

export interface ExampleBoardState {
  sprint: Sprint;
  stories: Story[];
}

export type ExampleBoardStore = StoreApi<ExampleBoardState>;

/** An in-memory copy of the example board, alive while the preview is open. */
export function createExampleBoardStore(initial: ExampleBoardState): ExampleBoardStore {
  return createStore<ExampleBoardState>(() => ({
    sprint: { ...initial.sprint },
    stories: initial.stories.map((s) => ({ ...s })),
  }));
}

/** The example's writer: the same stamps as the live one, and nothing leaves memory. */
export function exampleSprintWriter(store: ExampleBoardStore): SprintBoardWriter {
  const update = (id: string, change: (s: Story) => Story) =>
    store.setState((st) => ({
      stories: st.stories.map((s) => (s.id === id ? change(s) : s)),
    }));
  return {
    story: (id) => store.getState().stories.find((s) => s.id === id),
    setStatus: (id, status) => update(id, (s) => withStoryStatus(s, status)),
    setBlocked: (id, blocked) => update(id, (s) => withStoryBlocked(s, blocked)),
    setOwner: (id, owner) => update(id, (s) => withOwner(s, owner)),
    setDodCheck: (id, criterionId, checked) =>
      update(id, (s) => withStoryDodCheck(s, criterionId, checked, new Date().toISOString())),
    restore: (story) => update(story.id, () => story),
    setBlockNote: (id, note, opts) => {
      const current = store.getState().stories.find((s) => s.id === id);
      const next = current ? withSpellNote(current, note, opts) : null;
      if (!next || next === current) return false;
      update(id, () => next);
      return true;
    },
    setBlockLog: (id, log) => update(id, (s) => withBlockLog(s, log)),
  };
}
