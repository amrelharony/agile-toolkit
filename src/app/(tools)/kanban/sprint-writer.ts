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
import type { Sprint, Story, StoryStatus } from "@/lib/stores/workspace-types";
import { setStoryBlocked, setStoryStatus } from "@/lib/sprints/store";
import { withStoryBlocked, withStoryStatus } from "@/lib/sprints/story-status";

export interface SprintBoardWriter {
  /** The story as stored right now. */
  story(id: string): Story | undefined;
  /** Move a story, stamping its flow times and history (`setStoryStatus`). */
  setStatus(id: string, status: StoryStatus): void;
  setBlocked(id: string, blocked: boolean): void;
  /** Set or clear (empty name) who is working on it. */
  setOwner(id: string, owner: string): void;
  /** Put a story back as given (an Undo). */
  restore(story: Story): void;
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
  restore: (story) => useWorkspaceStore.getState().upsertStory(story),
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
    restore: (story) => update(story.id, () => story),
  };
}
