"use client";

import type { Camera } from "@/lib/geometry/bbox";
import type { WhiteboardObject, WhiteboardCard, WhiteboardCommentThread } from "@/lib/stores/workspace-types";
import type { ClusterResult } from "@/lib/whiteboard/cluster-bridge";
import type { ActionItem } from "./ai-selection-actions";
import type { BoardInsight } from "@/lib/analytics/board-insights";
import { MiniMap } from "./mini-map";
import { AIInsightsPanel } from "./ai-insights-panel";
import { CommentDrawer } from "./comment-drawer";
import { CardDetailModal } from "./card-detail-modal";

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
    showMiniMap, objects, camera, size, setCamera,
    boardId, selection,
    showAIPanel, clusters, insights, setSelection, setShowAIPanel,
    onApplyAiStickies, onApplyClusterSummary,
    onApplyTextUpdates, onApplyActionItems,
    activeCommentThread, setActiveCommentThreadId,
    cardDetailId, setCardDetailId, objectsById, onPatchStyles,
  } = props;

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
        />
      )}

      {activeCommentThread && (
        <CommentDrawer
          thread={activeCommentThread}
          onClose={() => setActiveCommentThreadId(null)}
        />
      )}

      {cardDetailId && (() => {
        const o = objectsById.get(cardDetailId);
        if (!o || o.type !== "card") return null;
        return (
          <CardDetailModal
            // `key` forces React to remount the modal whenever the
            // focused card changes, so its useState form fields
            // re-initialise from the new `card` prop. Without this a
            // Cmd+E swap between cards would keep the previous card's
            // in-progress form state.
            key={cardDetailId}
            card={o as WhiteboardCard}
            onPatch={(id, patch) => onPatchStyles([{ id, patch }])}
            onClose={() => setCardDetailId(null)}
          />
        );
      })()}
    </>
  );
}
