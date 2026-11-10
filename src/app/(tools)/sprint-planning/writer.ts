/**
 * Where Sprint Planning's changes go. The page writes the shared sprint and
 * stories; the example plan writes an in-memory copy, so a visitor can tick
 * stories in, fill to capacity and carry over without one fake story or
 * sprint reaching the workspace (fake finished sprints would feed velocity,
 * the dashboard and agents).
 *
 * Both writers read the stories at the moment they write (never a render's
 * copy that may be stale), as lib/sprints/store.ts does.
 */

import { createStore, type StoreApi } from "zustand/vanilla";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint, Story, StoryStatus } from "@/lib/stores/workspace-types";
import { setStoryStatus, updateSprint } from "@/lib/sprints/store";
import { withStoryStatus } from "@/lib/sprints/story-status";
import { deleteStoryKeepingUndo } from "@/lib/stories/delete";

export interface PlanningWriter {
  /** The stories as stored right now. */
  stories(): Story[];
  upsertStory(story: Story): void;
  /**
   * Add several new stories in one write (a paste, an import). Each write
   * saves the whole workspace again, so 200 stories one at a time is 200
   * saves of everything, and a frozen page on a phone.
   */
  upsertStories(stories: readonly Story[]): void;
  /** Take back the stories this page just made (the Undo of a paste or an import), in one write. */
  removeStories(ids: readonly string[]): void;
  /**
   * Delete a story the user chose to delete. Returns how to put it back
   * exactly, in its place in the stored order (null: there is no such story).
   */
  deleteStory(id: string): (() => void) | null;
  /** Move a story to `status`, stamping its flow times (`setStoryStatus`). */
  setStatus(id: string, status: StoryStatus): void;
  updateSprint(id: string, patch: Partial<Omit<Sprint, "id">>): void;
}

/** The shared workspace: what the cockpit, Burndown and agents read. */
export const liveWriter: PlanningWriter = {
  stories: () => useWorkspaceStore.getState().stories,
  upsertStory: (story) => useWorkspaceStore.getState().upsertStory(story),
  // Stamped and cleaned as a single upsert is (the store's batch does both).
  upsertStories: (stories) => useWorkspaceStore.getState().bulkUpsertStories([...stories]),
  // With the Canvas links to each cleared, as the store clears them for one.
  removeStories: (ids) => useWorkspaceStore.getState().removeStories(ids),
  // With the Canvas cards pinned to it, which the Undo re-links.
  deleteStory: (id) => deleteStoryKeepingUndo(id),
  setStatus: (id, status) => {
    setStoryStatus(id, status);
  },
  updateSprint: (id, patch) => {
    updateSprint(id, patch);
  },
};

export interface ExamplePlanningState {
  sprints: Sprint[];
  stories: Story[];
}

export type ExampleStore = StoreApi<ExamplePlanningState>;

/** An in-memory copy of the example, alive while the preview is open. */
export function createExampleStore(initial: ExamplePlanningState): ExampleStore {
  return createStore<ExamplePlanningState>(() => ({
    sprints: initial.sprints.map((s) => ({ ...s })),
    stories: initial.stories.map((s) => ({ ...s })),
  }));
}

const replaceById = <T extends { id: string }>(list: readonly T[], item: T): T[] =>
  list.some((x) => x.id === item.id)
    ? list.map((x) => (x.id === item.id ? item : x))
    : [...list, item];

/** The example's writer: same stamps as the live one, nothing leaves memory. */
export function exampleWriter(store: ExampleStore): PlanningWriter {
  return {
    stories: () => store.getState().stories,
    upsertStory: (story) => store.setState((s) => ({ stories: replaceById(s.stories, story) })),
    upsertStories: (stories) =>
      store.setState((s) => ({
        stories: stories.reduce<Story[]>((list, story) => replaceById(list, story), s.stories),
      })),
    removeStories: (ids) =>
      store.setState((s) => ({ stories: s.stories.filter((x) => !ids.includes(x.id)) })),
    deleteStory: (id) => {
      const index = store.getState().stories.findIndex((x) => x.id === id);
      if (index < 0) return null;
      const story = store.getState().stories[index];
      store.setState((s) => ({ stories: s.stories.filter((x) => x.id !== id) }));
      return () =>
        store.setState((s) => {
          if (s.stories.some((x) => x.id === id)) return s;
          const stories = [...s.stories];
          stories.splice(Math.min(index, stories.length), 0, story);
          return { stories };
        });
    },
    setStatus: (id, status) =>
      store.setState((s) => ({
        stories: s.stories.map((x) => (x.id === id ? withStoryStatus(x, status) : x)),
      })),
    updateSprint: (id, patch) =>
      store.setState((s) => ({
        sprints: s.sprints.map((x) => (x.id === id ? { ...x, ...patch } : x)),
      })),
  };
}

/**
 * Put a story in `sprintId` (none: the backlog) with `status`. The status
 * change goes through `setStatus`, so started and done times are stamped
 * the way the board and the agents stamp them.
 */
export function placeStory(
  writer: PlanningWriter,
  id: string,
  sprintId: string | undefined,
  status: StoryStatus
): void {
  const current = writer.stories().find((s) => s.id === id);
  if (!current) return;
  if (current.sprintId !== sprintId) {
    const next: Story = { ...current };
    if (sprintId) next.sprintId = sprintId;
    else delete next.sprintId;
    writer.upsertStory(next);
  }
  writer.setStatus(id, status);
}

/** Put stories back exactly as they were (an Undo after a bulk move). */
export function restoreStories(writer: PlanningWriter, before: readonly Story[]): void {
  for (const story of before) writer.upsertStory(story);
}
