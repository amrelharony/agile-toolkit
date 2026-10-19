/**
 * Writes to the shared sprints and their series. Each helper reads the
 * workspace at the moment it writes (never a React copy that may be stale),
 * so two tools open in the same tab can't overwrite each other's day.
 */

import { nanoid } from "nanoid";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint, SprintSeries } from "@/lib/stores/workspace-types";
import { seriesFor } from "./series";

/** Apply `update` to the stored series for `sprintId` (or an empty one) and save it. */
export function updateSeries(
  sprintId: string,
  update: (series: SprintSeries) => SprintSeries
): SprintSeries {
  const ws = useWorkspaceStore.getState();
  const next = update(seriesFor(ws.sprintSeries, sprintId));
  ws.upsertSprintSeries({ ...next, id: sprintId });
  return next;
}

/** Patch a stored sprint. Returns the updated sprint, or null if it doesn't exist. */
export function updateSprint(id: string, patch: Partial<Omit<Sprint, "id">>): Sprint | null {
  const ws = useWorkspaceStore.getState();
  const current = ws.sprints.find((s) => s.id === id);
  if (!current) return null;
  const next = { ...current, ...patch };
  ws.upsertSprint(next);
  return next;
}

/** A new sprint id (same shape agents get from `workspace.sprint.create`). */
export function newSprintId(): string {
  return `sprint_${nanoid(8)}`;
}

/** Save a new sprint and return it. */
export function createSprint(fields: Omit<Sprint, "id"> & { id?: string }): Sprint {
  const sprint: Sprint = { ...fields, id: fields.id ?? newSprintId() };
  useWorkspaceStore.getState().upsertSprint(sprint);
  return sprint;
}

/**
 * Remove a sprint and its series together, returning a function that puts
 * everything back (for an Undo toast): the sprint, its series, and the links
 * `removeSprint` cleared, i.e. stories planned into it and canvas cards
 * pointing at it. A link is only restored if nothing re-pointed it since.
 */
export function removeSprintWithSeries(id: string): (() => void) | null {
  const ws = useWorkspaceStore.getState();
  const sprint = ws.sprints.find((s) => s.id === id);
  if (!sprint) return null;
  const series = ws.sprintSeries?.find((s) => s.id === id);
  const storyIds = ws.stories.filter((s) => s.sprintId === id).map((s) => s.id);
  const cardRefs = (ws.whiteboardObjects ?? [])
    .filter((o) => o.sourceRef?.tool === "sprint" && o.sourceRef.entityId === id)
    .map((o) => ({ id: o.id, sourceRef: o.sourceRef }));
  ws.removeSprint(id);
  return () => {
    const now = useWorkspaceStore.getState();
    now.upsertSprint(sprint);
    if (series) now.upsertSprintSeries(series);
    for (const storyId of storyIds) {
      const story = now.stories.find((s) => s.id === storyId);
      if (story && story.sprintId === undefined) now.upsertStory({ ...story, sprintId: id });
    }
    if (cardRefs.length > 0) {
      const at = new Date().toISOString();
      const objects = useWorkspaceStore.getState().whiteboardObjects ?? [];
      const relinked = cardRefs.flatMap(({ id: objectId, sourceRef }) => {
        const o = objects.find((x) => x.id === objectId);
        // version + updatedAt bump so peers accept the change (last write wins).
        return o && !o.sourceRef
          ? [{ ...o, sourceRef, version: o.version + 1, updatedAt: at }]
          : [];
      });
      if (relinked.length > 0) useWorkspaceStore.getState().upsertWhiteboardObjects(relinked);
    }
  };
}
