"use client";

import { X, Sparkles, AlertTriangle } from "lucide-react";
import type { ClusterResult } from "@/lib/whiteboard/cluster-bridge";
import type { BoardInsight } from "@/lib/analytics/board-insights";
import type { WhiteboardObject } from "@/lib/stores/workspace-types";
import { AiBrainstormSection } from "./ai-brainstorm-section";
import { AiClusterSummarize } from "./ai-cluster-summarize";
import { AiCatchupSection } from "./ai-catchup-section";
import { AiSelectionActions, type ActionItem } from "./ai-selection-actions";
import { AiMindMapSection, type MindMapTreeNode } from "./ai-mind-map-section";

interface Props {
  boardId: string;
  selection: readonly string[];
  clusters: readonly ClusterResult[];
  insights: readonly BoardInsight[];
  /** Live object list — used to resolve cluster member ids to their
   * texts when the user runs cluster summarisation. */
  objects: readonly WhiteboardObject[];
  onSelectCluster: (objectIds: string[]) => void;
  onClose: () => void;
  /** Called when the brainstorm action produces new sticky texts.
   * Parent creates the actual board objects (positions + ids). */
  onApplyStickies: (texts: string[]) => void;
  /** Called when cluster summarisation completes. The cluster carries
   * its bbox so the parent can drop the summary sticky at the right
   * position. */
  onApplyClusterSummary: (cluster: ClusterResult, text: string) => void;
  /** Called when translate/rewrite completes. Map keys are object ids,
   * values are the new text. Parent picks the right field per type
   * (sticky.content vs frame.label vs card.title etc.). */
  onApplyTextUpdates: (updates: Record<string, string>) => void;
  /** Called when extract-action-items completes. Parent drops a
   * column of cards on the canvas with these titles + owners. */
  onApplyActionItems: (items: readonly ActionItem[]) => void;
  /** Called when AI mind-map generation completes. Parent builds the
   * mindMapNode hierarchy + auto-layout. */
  onApplyMindMapTree: (root: MindMapTreeNode) => void;
}

const CLUSTER_COLORS = ["#00f0ff", "#a78bfa", "#34d399", "#f59e0b", "#f87171", "#60a5fa"];

export function AIInsightsPanel({
  boardId,
  selection,
  clusters,
  insights,
  objects,
  onSelectCluster,
  onClose,
  onApplyStickies,
  onApplyClusterSummary,
  onApplyTextUpdates,
  onApplyActionItems,
  onApplyMindMapTree,
}: Props) {
  // Pre-build a Map<id, object> so each cluster's summarize button
  // can resolve its members in O(1) without re-walking the full
  // object list. Cheap; rebuilt only when objects identity changes.
  const objectsById = new Map<string, WhiteboardObject>();
  for (const o of objects) objectsById.set(o.id, o);
  return (
    <div
      className="fixed right-3 top-20 bottom-3 w-[min(20rem,calc(100vw-1.5rem))] z-30 bg-surface border border-border rounded-lg shadow-xl flex flex-col pr-safe pb-safe"
      data-canvas-export-ignore="true"
    >
      <div className="flex items-center justify-between p-3 border-b border-border">
        <h3 className="text-sm font-semibold text-text flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-accent" />
          AI Insights
        </h3>
        <button
          onClick={onClose}
          aria-label="Close AI insights"
          className="text-sub hover:text-text min-touch-coarse inline-flex items-center justify-center"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-auto overscroll-contain-strict p-3 space-y-4">
        <AiCatchupSection boardId={boardId} />

        <AiSelectionActions
          selection={selection}
          onApplyTextUpdates={onApplyTextUpdates}
          onApplyActionItems={onApplyActionItems}
        />

        <AiBrainstormSection onApplyStickies={onApplyStickies} />

        <AiMindMapSection onApplyTree={onApplyMindMapTree} />

        <section>
          <h4 className="text-xs uppercase tracking-wider text-sub mb-2">Detected clusters</h4>
          {clusters.length === 0 ? (
            <p className="text-xs text-sub italic">
              Add at least 4 stickies to detect clusters automatically.
            </p>
          ) : (
            <ul className="space-y-2">
              {clusters.map((c) => {
                const color = CLUSTER_COLORS[c.id % CLUSTER_COLORS.length];
                const memberObjects = c.objectIds
                  .map((id) => objectsById.get(id))
                  .filter((o): o is WhiteboardObject => !!o);
                return (
                  <li key={c.id} className="space-y-1.5">
                    <button
                      type="button"
                      onClick={() => onSelectCluster(c.objectIds)}
                      className="w-full flex items-center justify-between p-2 rounded border border-border bg-surface-deep hover:bg-accent/5 text-left"
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ background: color }}
                          aria-hidden="true"
                        />
                        <span className="text-xs text-text font-medium">Cluster {c.id + 1}</span>
                      </span>
                      <span className="text-xs text-sub font-mono">
                        {c.objectIds.length} item{c.objectIds.length === 1 ? "" : "s"}
                      </span>
                    </button>
                    <AiClusterSummarize
                      cluster={c}
                      memberObjects={memberObjects}
                      onApplySummary={onApplyClusterSummary}
                    />
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-xs text-sub italic mt-2">
            Click a cluster to select its objects, or Summarize to distil it into a single sticky.
          </p>
        </section>

        <section>
          <h4 className="text-xs uppercase tracking-wider text-sub mb-2 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-warning" />
            Board hygiene
          </h4>
          {insights.length === 0 ? (
            <p className="text-xs text-success">No anti-patterns detected. Board is healthy.</p>
          ) : (
            <ul className="space-y-2">
              {insights.map((i) => (
                <li key={i.id} className="text-xs border border-border bg-surface-deep rounded p-2">
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="text-text font-medium">{i.title}</span>
                    <span
                      // Higher-contrast palette — see canvas-client for
                      // rationale. Was text-*-300 on bg-*-500/20.
                      className={`text-xs uppercase font-bold px-1 py-0.5 rounded ${
                        i.severity === "critical"
                          ? "bg-danger/10 text-danger"
                          : i.severity === "warn"
                            ? "bg-warning/10 text-warning"
                            : "bg-accent/10 text-accent"
                      }`}
                    >
                      {i.severity}
                    </span>
                  </div>
                  <p className="text-sub">{i.detail}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
