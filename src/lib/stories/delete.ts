/**
 * Deleting a story from the shared workspace, in a way Undo can take back
 * whole (as `removeSprintWithSeries` does for a sprint). The store's
 * `removeStory` also unpins the Canvas cards and voting widgets that pointed
 * at the story; putting only the story back would leave those unlinked, and
 * the story at the end of the list instead of its place.
 *
 * Hand-offs need nothing here: a retro action or review comment whose story
 * is gone reads as "not sent" again (lib/handoffs/registry.ts `liveLink`),
 * and as sent once more when Undo brings the story back under the same id.
 */

import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Story, WhiteboardObject } from "@/lib/stores/workspace-types";

interface CanvasLink {
  id: string;
  sourceRef?: WhiteboardObject["sourceRef"];
  /** A voting widget's story. */
  storyId?: string;
}

/** The Canvas objects `removeStory` unpins from story `id`, with what they held. */
function canvasLinks(objects: readonly WhiteboardObject[] | undefined, id: string): CanvasLink[] {
  const links: CanvasLink[] = [];
  for (const o of objects ?? []) {
    const pinned =
      (o.sourceRef?.tool === "backlog" || o.sourceRef?.tool === "story") &&
      o.sourceRef.entityId === id;
    const voting = o.type === "voting" && o.storyId === id;
    if (!pinned && !voting) continue;
    links.push({
      id: o.id,
      ...(pinned ? { sourceRef: o.sourceRef } : {}),
      ...(voting ? { storyId: id } : {}),
    });
  }
  return links;
}

/**
 * Delete story `id`. Returns how to put it back, or null when there is no
 * such story. The undo returns the story to its place in the stored order
 * (the backlog and the sprint lists keep that order between equal ranks),
 * exactly as it was: written straight into the list, so no new "joined the
 * sprint" stamp is added to a story that had none. It then re-links the
 * Canvas objects the delete unpinned, where they are still on a board and
 * still unlinked. Nothing happens if the story is back already.
 */
export function deleteStoryKeepingUndo(id: string): (() => void) | null {
  const ws = useWorkspaceStore.getState();
  const index = ws.stories.findIndex((s) => s.id === id);
  if (index < 0) return null;
  const story: Story = ws.stories[index];
  const links = canvasLinks(ws.whiteboardObjects, id);
  ws.removeStory(id);

  return () => {
    if (useWorkspaceStore.getState().stories.some((s) => s.id === id)) return;
    useWorkspaceStore.setState((s) => {
      const stories = [...s.stories];
      stories.splice(Math.min(index, stories.length), 0, story);
      return { stories };
    });
    if (links.length === 0) return;
    const at = new Date().toISOString();
    const objects = useWorkspaceStore.getState().whiteboardObjects ?? [];
    const relinked = links.flatMap((link) => {
      const o = objects.find((x) => x.id === link.id);
      if (!o) return [];
      const next: WhiteboardObject = { ...o };
      let changed = false;
      if (link.sourceRef && !o.sourceRef) {
        next.sourceRef = link.sourceRef;
        changed = true;
      }
      if (link.storyId && next.type === "voting" && !next.storyId) {
        next.storyId = link.storyId;
        changed = true;
      }
      // version + updatedAt bump so peers accept the change (last write wins).
      return changed ? [{ ...next, version: o.version + 1, updatedAt: at }] : [];
    });
    if (relinked.length > 0) useWorkspaceStore.getState().upsertWhiteboardObjects(relinked);
  };
}
