"use client";

import { useEffect } from "react";
import type { Camera } from "@/lib/geometry/bbox";
import type {
  WhiteboardObject,
  WhiteboardCard,
  WhiteboardCommentThread,
} from "@/lib/stores/workspace-types";
import type { ClusterResult } from "@/lib/whiteboard/cluster-bridge";
import type { ActionItem } from "./ai-selection-actions";
import type { MindMapTreeNode } from "./ai-mind-map-section";
import type { BoardInsight } from "@/lib/analytics/board-insights";
import { MiniMap } from "./mini-map";
import { AIInsightsPanel } from "./ai-insights-panel";
import { CommentDrawer } from "./comment-drawer";
import { CardDetailModal } from "./card-detail-modal";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { toast } from "@/lib/utils/toast";
import { isSprintBoard, liveContainerOf, liveLockNote } from "../lib/live-boards";
import { writeLiveCardEdit } from "../lib/live-card-writer";

/**
 * Side-panel + modal cluster: MiniMap, AI Insights drawer, Comment
 * drawer, and the Card Detail modal.
 *
 * Each renders conditionally. They share no behaviour beyond "open
 * one at a time" — bundled into one subcomponent purely to keep the
 * parent's render JSX shorter and to keep all the "panels and
 * modals" code in one place.
 *
 * Card detail uses `key={cardDetailId}` so React remounts whenever
 * the focused card changes — without that, its useState form fields
 * would keep the previous card's in-progress edits when the user
 * Cmd+E's between cards.
 */
export function CanvasModals(props: {
  // MiniMap
  showMiniMap: boolean;
  objects: readonly WhiteboardObject[];
  camera: Camera;
  size: { w: number; h: number };
  setCamera: (cam: Camera) => void;
  // AI Insights
  boardId: string;
  selection: readonly string[];
  showAIPanel: boolean;
  clusters: readonly ClusterResult[];
  insights: readonly BoardInsight[];
  setSelection: (ids: string[]) => void;
  setShowAIPanel: (v: boolean) => void;
  onApplyAiStickies: (texts: string[]) => void;
  onApplyClusterSummary: (cluster: ClusterResult, text: string) => void;
  onApplyTextUpdates: (updates: Record<string, string>) => void;
  onApplyActionItems: (items: readonly ActionItem[]) => void;
  onApplyMindMapTree: (root: MindMapTreeNode) => void;
  // Comment drawer
  activeCommentThread: WhiteboardCommentThread | null;
  setActiveCommentThreadId: (id: string | null) => void;
  // Card detail modal
  cardDetailId: string | null;
  setCardDetailId: (id: string | null) => void;
  objectsById: ReadonlyMap<string, WhiteboardObject>;
  onPatchStyles: (entries: { id: string; patch: Partial<WhiteboardObject> }[]) => void;
}) {
  const {
    showMiniMap,
    objects,
    camera,
    size,
    setCamera,
    boardId,
    selection,
    showAIPanel,
    clusters,
    insights,
    setSelection,
    setShowAIPanel,
    onApplyAiStickies,
    onApplyClusterSummary,
    onApplyTextUpdates,
    onApplyActionItems,
    onApplyMindMapTree,
    activeCommentThread,
    setActiveCommentThreadId,
    cardDetailId,
    setCardDetailId,
    objectsById,
    onPatchStyles,
  } = props;

  // A live card that can't be edited here (a story map card, a closed
  // sprint's card) says where to change it instead of opening a form
  // whose Save would do nothing.
  const sprints = useWorkspaceStore((s) => s.sprints);
  const detailBoard = cardDetailId ? liveContainerOf(cardDetailId, objectsById) : null;
  const lockNote = detailBoard ? liveLockNote(detailBoard, sprints) : null;
  useEffect(() => {
    if (!lockNote) return;
    toast.info(lockNote);
    setCardDetailId(null);
  }, [lockNote, setCardDetailId]);

  return (
    <>
      {showMiniMap && (
        <MiniMap
          objects={objects}
          camera={camera}
          viewportSize={size}
          onPan={(wx, wy) => {
            // Centre camera on the clicked world point.
            setCamera({
              x: wx - size.w / 2 / camera.zoom,
              y: wy - size.h / 2 / camera.zoom,
              zoom: camera.zoom,
            });
          }}
        />
      )}

      {showAIPanel && (
        <AIInsightsPanel
          boardId={boardId}
          selection={selection}
          clusters={clusters}
          insights={insights}
          objects={objects}
          onSelectCluster={(ids) => setSelection(ids)}
          onClose={() => setShowAIPanel(false)}
          onApplyStickies={onApplyAiStickies}
          onApplyClusterSummary={onApplyClusterSummary}
          onApplyTextUpdates={onApplyTextUpdates}
          onApplyActionItems={onApplyActionItems}
          onApplyMindMapTree={onApplyMindMapTree}
        />
      )}

      {activeCommentThread && (
        <CommentDrawer
          thread={activeCommentThread}
          onClose={() => setActiveCommentThreadId(null)}
        />
      )}

      {cardDetailId &&
        !lockNote &&
        (() => {
          const o = objectsById.get(cardDetailId);
          if (!o || o.type !== "card") return null;
          const card = o as WhiteboardCard;
          const live = liveContainerOf(card.id, objectsById);
          const sprintCard = live !== null && isSprintBoard(live);
          return (
            <CardDetailModal
              // `key` forces React to remount the modal whenever the
              // focused card changes, so its useState form fields
              // re-initialise from the new `card` prop. Without this a
              // Cmd+E swap between cards would keep the previous card's
              // in-progress form state.
              key={cardDetailId}
              card={card}
              // A Sprint board card's title, points, assignee and status
              // are its story's: they're saved there, the rest on the card.
              onPatch={(id, patch) => {
                const own = sprintCard
                  ? (writeLiveCardEdit(
                      card,
                      patch as Partial<WhiteboardCard>
                    ) as Partial<WhiteboardObject>)
                  : patch;
                if (Object.keys(own).length > 0) onPatchStyles([{ id, patch: own }]);
              }}
              onClose={() => setCardDetailId(null)}
              linkNote={
                sprintCard
                  ? "This card shows a story in the sprint: its title, points, assignee and status are saved to the story."
                  : undefined
              }
            />
          );
        })()}
    </>
  );
}
