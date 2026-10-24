"use client";

import { useId, useMemo } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SprintPicker } from "@/components/sprints/sprint-picker";
import type { Rect } from "@/lib/geometry/bbox";
import { CANVAS_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { emitSignal } from "@/lib/signals/signal-bus";
import { isExampleSprintId } from "@/lib/sprints/example";
import { pickDefaultSprint, useSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint, WhiteboardObject } from "@/lib/stores/workspace-types";
import { undoable } from "@/lib/utils/undoable";
import { isClosedSprint } from "../../kanban/sprint-view";
import {
  liveChildrenOf,
  livePlacement,
  mapCardCount,
  newSprintBoard,
  newStoryMapBoard,
  reconcileLiveBoards,
  sprintStories,
  storyMapDoc,
} from "../lib/live-boards";

type LiveKind = "sprint-board" | "story-map";

const ENTRIES: { id: LiveKind; name: string; description: string }[] = [
  {
    id: "sprint-board",
    name: "Sprint board",
    description:
      "A card for each story in the sprint, in its status column. Drag a card to another column to move the story: Kanban, the Sprint Cockpit and Burndown follow.",
  },
  {
    id: "story-map",
    name: "Story map",
    description:
      "Your story map's steps, slices and cards, read-only here. Change the map in Story Mapper and this board follows.",
  },
];

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What the picked sprint's board will show, under the picker. */
function sprintNote(sprint: Sprint, planned: number): string {
  if (isClosedSprint(sprint)) {
    return `${sprint.name} is ${sprint.status === "cancelled" ? "cancelled" : "completed"}, so its board is read-only.`;
  }
  if (planned === 0) {
    return `No stories planned into ${sprint.name} yet. Their cards appear as you plan them in.`;
  }
  return `${plural(planned, "story", "stories")} in ${sprint.name}.`;
}

/**
 * The template gallery's "Live boards": a Sprint board and a Story map that
 * stay bound to the workspace (see ../lib/live-boards). Adding one places it
 * to the right of the board's content, fills it at once, and offers Undo.
 * Only real sprints are offered: an example preview sprint has no stories
 * of the user's to show.
 */
export function LiveBoardTemplates({
  boardId,
  query,
  onAdded,
}: {
  boardId: string;
  /** The gallery's search text: entries that don't match are hidden. */
  query: string;
  /** Called with the new board's rect, after it is added. */
  onAdded: (rect: Rect) => void;
}) {
  const headingId = useId();
  const sprintNoteId = useId();
  const mapNoteId = useId();
  const { sprints: allSprints, selected, select } = useSelectedSprint();
  const sprints = useMemo(() => allSprints.filter((s) => !isExampleSprintId(s.id)), [allSprints]);
  const sprint =
    selected && !isExampleSprintId(selected.id) ? selected : pickDefaultSprint(sprints, null);
  const stories = useWorkspaceStore((s) => s.stories);
  const storyMaps = useWorkspaceStore((s) => s.storyMaps);
  const planned = sprint ? sprintStories(sprint.id, stories).length : 0;
  const mapCards = useMemo(() => mapCardCount(storyMapDoc(storyMaps)), [storyMaps]);
  const { log } = useHistoryLogger("canvas");

  const q = query.trim().toLowerCase();
  const shown = ENTRIES.filter(
    (e) => !q || e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q)
  );
  if (shown.length === 0) return null;

  const add = (kind: LiveKind) => {
    if (kind === "sprint-board" && !sprint) return;
    if (kind === "story-map" && mapCards === 0) return;
    const ws = useWorkspaceStore.getState();
    const onBoard = (ws.whiteboardObjects ?? []).filter((o) => o.boardId === boardId);
    const now = new Date().toISOString();
    const { x, y } = livePlacement(onBoard);
    const z = onBoard.reduce((top, o) => Math.max(top, o.z), 0) + 1;
    const container =
      kind === "sprint-board" && sprint
        ? newSprintBoard({ boardId, sprint, x, y, z, now })
        : newStoryMapBoard({ boardId, x, y, z, now });
    // Fill it now rather than on the next reconcile, so the board appears
    // whole. Everything here is new, so it all starts at version 1.
    const plan = reconcileLiveBoards(
      [container],
      { stories: ws.stories, sprints: ws.sprints, storyMaps: ws.storyMaps ?? [] },
      now
    );
    const seeded = new Map<string, WhiteboardObject>([[container.id, container]]);
    for (const o of plan.upsert) seeded.set(o.id, { ...o, version: 1 } as WhiteboardObject);
    const objects = Array.from(seeded.values());
    const placed = seeded.get(container.id) ?? container;

    undoable({
      label:
        kind === "sprint-board" && sprint
          ? `Added the ${sprint.name} board`
          : "Added the story map",
      apply: () => useWorkspaceStore.getState().upsertWhiteboardObjects(objects),
      // The board and every card it has now, including any it gained since.
      revert: () => {
        const st = useWorkspaceStore.getState();
        const children = liveChildrenOf(container.id, st.whiteboardObjects ?? []);
        st.removeWhiteboardObjects([container.id, ...children.map((o) => o.id)]);
      },
    });
    log(CANVAS_ACTIONS.TEMPLATE_APPLIED, { template: kind, count: objects.length });
    emitSignal({
      kind: "whiteboard.templateApplied",
      at: now,
      toolId: "canvas",
      payload: { template: kind, boardId },
    });
    onAdded({ x: placed.x, y: placed.y, w: placed.w, h: placed.h });
  };

  const entry = (id: LiveKind) => shown.find((e) => e.id === id);
  const sprintEntry = entry("sprint-board");
  const mapEntry = entry("story-map");

  return (
    <section aria-labelledby={headingId} className="mb-4">
      <h3 id={headingId} className="text-sm font-semibold text-text">
        Live boards
      </h3>
      <p className="text-xs text-sub mb-2">
        Bound to your sprint and story map, so they never go stale.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {sprintEntry && (
          <div className="border border-border rounded-lg p-4 bg-surface-deep flex flex-col gap-2 min-w-0">
            <div className="font-semibold text-sm text-text">{sprintEntry.name}</div>
            <p className="text-xs text-sub">{sprintEntry.description}</p>
            {sprints.length === 0 ? (
              <p id={sprintNoteId} className="text-xs text-sub">
                No sprints yet.{" "}
                <Link href="/sprint-planning" className="text-accent underline">
                  Plan one in Sprint Planning
                </Link>
              </p>
            ) : (
              <>
                <SprintPicker
                  sprints={sprints}
                  selectedId={sprint?.id}
                  onSelect={select}
                  allowCreate={false}
                />
                {sprint && (
                  <p id={sprintNoteId} className="text-xs text-sub" aria-live="polite">
                    {sprintNote(sprint, planned)}
                  </p>
                )}
              </>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="self-start mt-auto"
              disabled={!sprint}
              aria-describedby={sprintNoteId}
              onClick={() => add("sprint-board")}
            >
              <Plus aria-hidden="true" />
              Add sprint board
            </Button>
          </div>
        )}
        {mapEntry && (
          <div className="border border-border rounded-lg p-4 bg-surface-deep flex flex-col gap-2 min-w-0">
            <div className="font-semibold text-sm text-text">{mapEntry.name}</div>
            <p className="text-xs text-sub">{mapEntry.description}</p>
            <p id={mapNoteId} className="text-xs text-sub">
              {mapCards === 0 ? (
                <>
                  Your story map is empty.{" "}
                  <Link href="/story-mapper" className="text-accent underline">
                    Open Story Mapper
                  </Link>
                </>
              ) : (
                `${plural(mapCards, "story", "stories")} on your map.`
              )}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="self-start mt-auto"
              disabled={mapCards === 0}
              aria-describedby={mapNoteId}
              onClick={() => add("story-map")}
            >
              <Plus aria-hidden="true" />
              Add story map
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
